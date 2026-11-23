// Shared helpers for the bridge: config, key, WhatsApp calls, logging, chat history.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openChatLog } from './lib/chatlog.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
// WHATSAPP_API_BASE exists so the bridge can be tested against a local fake server.
export const BASE = process.env.WHATSAPP_API_BASE || 'https://api.whatsapp.com/agent/v1';

const defaults = {
  ownerName: 'Me', assistantName: 'Claude', agentId: 'claude', dataDir: 'state',
  noticeAfterMinutes: 4, voice: { enabled: false, command: 'python transcribe.py {file}', keepAudio: false },
};
function loadConfig() {
  const file = process.env.BRIDGE_CONFIG || path.join(HERE, 'config.json');
  let user = {};
  if (existsSync(file)) {
    try { user = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
      console.error(`config.json is not valid JSON: ${e.message}`); process.exit(1);
    }
  }
  return { ...defaults, ...user, voice: { ...defaults.voice, ...(user.voice || {}) } };
}
export const config = loadConfig();
export const DATA = path.resolve(HERE, config.dataDir);
mkdirSync(DATA, { recursive: true });

export const STATE_FILE = path.join(DATA, 'state.json');
export const LAST_FROM_FILE = path.join(DATA, 'last-from.txt');
export const REPLIED_FILE = path.join(DATA, 'replied.txt');
const LOG = path.join(DATA, 'bridge.log');

export const chat = openChatLog({
  dir: DATA, agent: config.agentId, owner: config.ownerName, assistant: config.assistantName,
});

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Logs lengths and status codes only. Never message text, never the key.
export function log(line) { try { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); } catch {} }

// The key is read from an environment variable, or from a file in your home folder written by set-key.mjs.
export const KEY_FILE = path.join(os.homedir(), '.whatsapp-bridge', '.env');
function loadToken() {
  if (process.env.WHATSAPP_AGENT_KEY) return process.env.WHATSAPP_AGENT_KEY;
  try {
    for (const line of readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^WHATSAPP_AGENT_KEY=(.*)$/);
      if (m) return m[1].trim();
    }
  } catch {}
  return '';
}
export const TOKEN = loadToken();

export async function api(method, pathAndQuery, body, timeoutMs) {
  const res = await fetch(BASE + pathAndQuery, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 204) return { status: 204, data: null };
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

export async function markRead(id, typing) {
  try {
    const body = { messaging_product: 'whatsapp', status: 'read', message_id: id };
    if (typing) body.typing_indicator = { type: 'text' };
    const r = await api('POST', '/statuses', body, 30_000);
    if (r.status !== 200) log(`statuses status=${r.status}`);
  } catch (e) { log(`statuses error: ${e.name}`); }
}

export const sentId = (r) => r.data?.messages?.[0]?.id ?? r.data?.message_id ?? r.data?.id ?? null;

// Sends one text message (max 4096 characters). Retries only 429 and 503. Records it in chat.jsonl.
export async function sendText(to, body, { via, replyTo } = {}) {
  const payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body } };
  for (let attempt = 0; attempt < 4; attempt++) {
    let r;
    try { r = await api('POST', '/messages', payload, 60_000); } catch (e) {
      log(`send error (unknown if sent): ${e.name}`); // do not retry: it might double-send
      return false;
    }
    if (r.status === 200) {
      log(`sent chars=${body.length}`);
      try {
        chat.append({ source: 'wa', ext: sentId(r), from: config.assistantName, to: config.ownerName, kind: 'text', text: body, ...(via ? { via } : {}), ...(replyTo ? { replyTo } : {}) });
      } catch (e) { log(`chatlog error: ${e.message}`); }
      return true;
    }
    log(`send status=${r.status}`);
    if (r.status === 429 || r.status === 503) { await sleep(2000 * 2 ** attempt); continue; }
    return false;
  }
  return false;
}
