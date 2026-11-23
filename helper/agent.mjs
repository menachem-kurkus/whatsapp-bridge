#!/usr/bin/env node
// WhatsApp Agent Kit: an always-on helper that turns a WhatsApp agent chat (WhatsApp > Settings > Agents) into an
// assistant powered by the AI model you choose (Claude, OpenAI, a local model, or any command line tool).
//
// How it works, in one loop:
//   1. Ask WhatsApp for new messages (long-poll GET /updates; no public server needed, it runs on your own computer).
//   2. For each message: mark it read, show typing dots, save any photo / voice note / file to inbox/<date>/.
//   3. Voice notes are turned into words on your computer first (Whisper), if you have it installed.
//   4. Run ONE job at a time with your chosen model (models.mjs), using INSTRUCTIONS.md as its standing instructions.
//   5. Send the reply, plus any files the model asks to send (a line "SEND_FILE: /path/to/file | caption").
//   6. Every message in and out is written to one running chat history: state/chat.jsonl (see ../CHAT-LOG.md).
//
// API: WhatsApp Agent Platform v1, https://api.whatsapp.com/agent/v1 (Bearer API key from the agent's Chat info).
// Platform rules worth knowing: an agent chat can only message the person who created it; 12 sends/min; 15 polls/min;
// text up to 4096 characters; images up to 5 MB, other media up to 16 MB; updates are kept 30 days.
//
//   node agent.mjs                 run the helper (normally started by launchd, see install-mac.sh)
//   node agent.mjs --try "hello"   run one test job with your model and print the reply, without WhatsApp
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, statSync, openAsBlob, readdirSync, renameSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatlog } from './lib/chatlog.mjs';
import { transcribe } from './lib/transcribe.mjs';
import { askModel } from './models.mjs';

const run = promisify(execFile);
const DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.WA_API_BASE || process.env.WHATSAPP_API_BASE || 'https://api.whatsapp.com/agent/v1';   // WA_API_BASE: only for testing
for (const d of ['state', 'logs', 'inbox']) mkdirSync(path.join(DIR, d), { recursive: true });

// ---------- settings (config.json; copy config.example.json to start) ----------
const CONFIG_FILE = path.join(DIR, 'config.json');
if (!existsSync(CONFIG_FILE)) { console.error('No config.json yet. Copy config.example.json to config.json and fill it in (see README.md).'); process.exit(1); }
const cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
const OWNER = cfg.ownerName || 'Owner';
const AGENT = cfg.agentName || 'Assistant';
const TZ = cfg.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
const JOB_LIMIT_MIN = cfg.jobLimitMinutes ?? 30;       // a job running longer than this is stopped
const ON_IT_AFTER_SEC = cfg.onItAfterSeconds ?? 60;    // one "On it" note if a job is still running after this
const TYPING_EVERY_SEC = 20;                           // typing dots last about 25 s; refresh before they vanish
const MAX_TEXT = 4000;                                 // API cap is 4096

const STATE_FILE = path.join(DIR, 'state', 'state.json');
const LOG = path.join(DIR, 'logs', 'agent.log');
let state = {};
let trying = false;   // --try: test runs never touch the real state file
try { state = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { /* first run */ }
const save = () => { if (!trying) writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); };
const log = (s) => { const l = `${new Date().toISOString()} ${s}`; console.log(l); try { appendFileSync(LOG, l + '\n'); } catch { /* fine */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chat = chatlog(DIR, { owner: OWNER, agent: AGENT });

// ---------- the API key: macOS Keychain first, then the WA_AGENT_KEY environment variable ----------
// The key is never written to a file or a log.
let token = null, tokenMissingLogged = false;
async function getToken() {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await run('security', ['find-generic-password', '-s', cfg.keychainService || 'whatsapp-agent-kit', '-w']);
      if (stdout.trim()) { tokenMissingLogged = false; return stdout.trim(); }
    } catch { /* not saved yet */ }
  }
  if (process.env.WA_AGENT_KEY) return process.env.WA_AGENT_KEY.trim();
  // Windows, Linux or Mac: the key file written by `node ../bridge/set-key.mjs` (also used by the live bridge).
  try {
    for (const line of readFileSync(path.join(os.homedir(), '.whatsapp-bridge', '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^WHATSAPP_AGENT_KEY=(.*)$/);
      if (m && m[1].trim()) { tokenMissingLogged = false; return m[1].trim(); }
    }
  } catch { /* no key file */ }
  if (!tokenMissingLogged) { log('No WhatsApp API key yet. Run ./set-key.sh (Mac) or node ../bridge/set-key.mjs (any system), or set WA_AGENT_KEY. Checking again every minute.'); tokenMissingLogged = true; }
  return null;
}

// ---------- WhatsApp API ----------
class ApiError extends Error { constructor(status, body) { super(`HTTP ${status}${body?.error ? ` code ${body.error.code}: ${body.error.message}` : ''}`); this.status = status; this.body = body; } }
async function api(method, p, { json, form, timeoutMs = 30_000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(p.startsWith('http') ? p : `${BASE}${p}`, {
      method, signal: ctl.signal,
      headers: { Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : form,
    });
    if (res.status === 204) return null;
    const isJson = (res.headers.get('content-type') || '').includes('json');
    const body = isJson ? await res.json().catch(() => null) : res;
    if (!res.ok) throw new ApiError(res.status, isJson ? body : null);
    return body;
  } finally { clearTimeout(timer); }
}
// Retry rules: 2xx = sent. 429, or 503 with code 131016 = not sent, safe to retry. A 500 or a timeout = unknown,
// so we do NOT retry (a retry could send the same message twice).
async function sendWithRetry(payload) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await api('POST', '/messages', { json: payload, timeoutMs: 60_000 }); }
    catch (e) {
      const retry = e.status === 429 || (e.status === 503 && e.body?.error?.code === 131016);
      if (!retry) throw e;
      await sleep(2000 * 2 ** attempt);
    }
  }
  throw new Error('WhatsApp kept refusing the send (rate limit) after 4 tries.');
}
async function sendText(to, text, replyTo) {
  for (let i = 0; i < text.length; i += MAX_TEXT) {
    const part = text.slice(i, i + MAX_TEXT);
    const payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: part } };
    if (replyTo && i === 0) payload.context = { message_id: replyTo };   // shows as a quoted reply on the phone
    let r;
    try { r = await sendWithRetry(payload); }
    catch (e) {
      if (!payload.context || e.status !== 400) throw e;
      delete payload.context; r = await sendWithRetry(payload);          // the quoted message is too old: send plain
    }
    chat.outgoing({ ext: r?.messages?.[0]?.id, text: part });
  }
}
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.3gp': 'video/3gpp',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv', '.md': 'text/plain', '.json': 'text/plain', '.html': 'text/plain', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/opus' };
const LIMITS = { image: 5e6, video: 16e6, audio: 16e6, document: 16e6 };
async function sendFile(to, file, caption) {
  file = file.replace(/^~(?=\/|$)/, os.homedir());
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`WhatsApp can't take ${path.extname(file) || 'that kind of'} files; send it as a PDF, image, text or Office file`);
  const type = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document';
  if (!existsSync(file)) throw new Error(`the file ${path.basename(file)} wasn't there to send`);
  const size = statSync(file).size;
  if (size > LIMITS[type]) throw new Error(`${path.basename(file)} is ${(size / 1e6).toFixed(1)} MB, over WhatsApp's ${LIMITS[type] / 1e6} MB limit for ${type}s`);
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', await openAsBlob(file, { type: mime }), path.basename(file));
  const { id } = await api('POST', '/media', { form, timeoutMs: 120_000 });
  const obj = { id, ...(caption && type !== 'audio' ? { caption: caption.slice(0, 1024) } : {}), ...(type === 'document' ? { filename: path.basename(file) } : {}) };
  const r = await sendWithRetry({ messaging_product: 'whatsapp', to, type, [type]: obj });
  chat.outgoing({ ext: r?.messages?.[0]?.id, kind: type, text: caption, file });
}
async function typing(messageId) {
  try { await api('POST', '/statuses', { json: { messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } } }); }
  catch (e) { log(`typing/read receipt not accepted: ${e.message}`); }
}
async function downloadMedia(m) {
  const media = m[m.type];
  const meta = await api('GET', `/media/${media.id}`);
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`downloading the ${m.type} failed (HTTP ${res.status})`);
  const folder = path.join(DIR, 'inbox', new Date().toISOString().slice(0, 10));
  mkdirSync(folder, { recursive: true });
  const ext = media.filename ? path.extname(media.filename) : (Object.entries(MIME).find(([, v]) => v === (media.mime_type || '').split(';')[0])?.[0] ?? '.bin');
  const name = media.filename ? `${Date.now()}-${media.filename.replace(/[^\w.\- ]/g, '_')}` : `${Date.now()}-${media.voice ? 'voice-note' : m.type}${ext}`;
  const file = path.join(folder, name);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

// ---------- the model ----------
function instructions() {
  let text = '';
  try { text = readFileSync(path.join(DIR, 'INSTRUCTIONS.md'), 'utf8'); } catch { /* none */ }
  return `${text}\n\nYou are ${AGENT}, answering ${OWNER} in WhatsApp. Keep replies short and plain; WhatsApp shows *bold* and _italic_.\n` +
    `To send a file back, put a line on its own: SEND_FILE: /full/path/to/file | optional caption\n` +
    `Files ${OWNER} sends are saved under ${path.join(DIR, 'inbox')}.`;
}
async function runModel(prompt) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  if (state.memoryDate !== today) { state.memory = { history: [] }; state.memoryDate = today; save(); }   // a fresh conversation each day
  const logFile = path.join(DIR, 'logs', `${today}-jobs.log`);
  if (!trying && state.prunedDate !== today) {   // job logs (every prompt and reply) are kept for logDays, then deleted
    state.prunedDate = today;
    const cut = new Date(Date.now() - (cfg.logDays ?? 30) * 86_400_000).toISOString().slice(0, 10);
    for (const f of readdirSync(path.join(DIR, 'logs'))) if (/^\d{4}-\d\d-\d\d-jobs\.log$/.test(f) && f.slice(0, 10) < cut) try { unlinkSync(path.join(DIR, 'logs', f)); } catch { /* fine */ }
  }
  appendFileSync(logFile, `\n=== ${new Date().toISOString()} prompt:\n${prompt}\n`);
  let r;
  try { r = await askModel(cfg.model, { system: instructions(), prompt, memory: state.memory, cwd: DIR, limitMin: JOB_LIMIT_MIN }); }
  catch (e) { r = { ok: false, why: e.message }; }
  save();   // the adapter may have updated state.memory (history, or a session id)
  appendFileSync(logFile, `=== ${r.ok ? 'reply' : 'failed'}:\n${r.ok ? r.text : r.why}\n`);
  return r;
}

// ---------- live mode (optional): an open AI session answers, with the background model as backup ----------
// The session runs `node live-wait.mjs`, which keeps live/heartbeat fresh while it waits. A job is written to
// live/inbox/<id>.json; the wait moves it to live/taken/ and shows it to the session; the session answers with
// `node live-reply.mjs <id> "..."`, which writes live/outbox/<id>.txt. Not picked up in time: the background model answers.
const LIVE = path.join(DIR, 'live');
const liveOn = () => cfg.live?.enabled === true;
function liveReady() {
  try { return Date.now() - Date.parse(JSON.parse(readFileSync(path.join(LIVE, 'heartbeat'), 'utf8')).at) < 120_000; } catch { return false; }
}
async function runLive(prompt, id) {
  if (!liveOn() || trying || !liveReady()) return null;
  for (const d of ['inbox', 'taken', 'outbox']) mkdirSync(path.join(LIVE, d), { recursive: true });
  const safe = String(id).replace(/[^A-Za-z0-9_.-]/g, '_');
  const inFile = path.join(LIVE, 'inbox', `${safe}.json`), takenFile = path.join(LIVE, 'taken', `${safe}.json`), outFile = path.join(LIVE, 'outbox', `${safe}.txt`);
  writeFileSync(inFile, JSON.stringify({ id: safe, at: new Date().toISOString(), prompt }, null, 2));
  log(`live: job ${safe} handed to the open session`);
  const pickupMin = cfg.live?.pickupMinutes ?? 3, start = Date.now();
  while (Date.now() - start < JOB_LIMIT_MIN * 60_000) {
    if (existsSync(outFile)) {
      const text = readFileSync(outFile, 'utf8').trim();
      try { renameSync(outFile, path.join(LIVE, 'taken', `${safe}.reply.txt`)); } catch { /* fine */ }
      log(`live: job ${safe} answered by the session`);
      return { ok: true, text };
    }
    if (existsSync(inFile) && Date.now() - start > pickupMin * 60_000) {
      try { unlinkSync(inFile); } catch { /* taken just now */ }
      if (!existsSync(takenFile)) { log(`live: not picked up in ${pickupMin} min; the background model answers`); return null; }
    }
    await sleep(2000);
  }
  if (existsSync(takenFile)) return { ok: false, why: `the open session took it but didn't answer in ${JOB_LIMIT_MIN} minutes` };
  return null;
}

// ---------- jobs: one at a time; messages that arrive meanwhile are answered together ----------
const queue = [];
let busy = false;
async function enqueue(job) {
  if (queue.some((q) => q.id === job.id)) return;
  queue.push(job);
  if (!busy) void work();
}
async function work() {
  busy = true;
  while (queue.length) {
    const batch = queue.splice(0, queue.length);
    const { to, id: lastId } = batch[batch.length - 1];
    const when = new Date().toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const prompt = `WhatsApp from ${OWNER} (${when}):\n${batch.map((b) => b.text).join('\n')}`;
    log(`job start: ${batch.length} message(s)`);
    await typing(lastId);
    const typingTimer = setInterval(() => typing(lastId), TYPING_EVERY_SEC * 1000);
    const onItTimer = setTimeout(() => sendText(to, 'On it. I will send the result here.').catch(() => {}), ON_IT_AFTER_SEC * 1000);
    const r = (await runLive(prompt, lastId)) ?? (await runModel(prompt));
    clearInterval(typingTimer); clearTimeout(onItTimer);
    try {
      if (r.ok) {
        const lines = r.text.split('\n');
        const files = lines.filter((l) => l.trim().startsWith('SEND_FILE:')).map((l) => { const [f, ...c] = l.trim().slice(10).split('|'); return { file: f.trim(), caption: c.join('|').trim() }; });
        const body = lines.filter((l) => !l.trim().startsWith('SEND_FILE:')).join('\n').trim();
        if (body) await sendText(to, body, batch.length > 1 ? lastId : null);
        for (const f of files) {
          try { await sendFile(to, f.file, f.caption); }
          catch (e) { log(`file send failed: ${e.message}`); await sendText(to, `I couldn't attach ${path.basename(f.file)}: ${e.message}`); }
        }
        if (!body && !files.length) await sendText(to, 'Done.');
        log(`job done: ${body.length} chars, ${files.length} file(s)`);
      } else {
        log(`job failed: ${r.why}`);
        await sendText(to, `That one didn't go through (${r.why}). Try again, or check logs/agent.log on the computer.`);
      }
    } catch (e) { log(`reply failed: ${e.message}`); }
  }
  busy = false;
}

// ---------- one incoming message ----------
async function handle(m) {
  state.handled = state.handled ?? [];
  if (state.handled.includes(m.id)) return;                 // WhatsApp can deliver the same update twice
  state.handled.push(m.id); state.handled = state.handled.slice(-500);
  state.owner = m.from; save();
  if (Number(m.timestamp) * 1000 < (state.startedAt ?? 0)) return;   // old backlog from before the helper was first switched on
  if (m.type === 'reaction') return;
  let text = '', savedFile;
  try {
    if (m.type === 'text') text = m.text.body;
    else if (!m[m.type]?.id) text = `[${OWNER} sent a ${m.type}: ${JSON.stringify(m[m.type] ?? {}).slice(0, 600)}]`;   // location, contact ...
    else {
      savedFile = await downloadMedia(m);
      const cap = m[m.type]?.caption ? ` Caption: "${m[m.type].caption}"` : '';
      text = `[${OWNER} sent a ${m.type}, saved at ${savedFile}.${cap}]`;
    }
  } catch (e) { text = `[${OWNER} sent a ${m.type}, but saving it failed: ${e.message}.]`; }
  const voice = m.type === 'audio' && m.audio?.voice;
  const inId = chat.incoming({ ext: m.id, kind: voice ? 'voice' : m.type, text: m.type === 'text' ? m.text.body : m[m.type]?.caption, file: savedFile });
  if (savedFile && voice) {
    const t = await transcribe(savedFile, { model: cfg.whisperModel, hints: cfg.nameHints });
    if (t.text) {
      chat.record('sys', { from: 'Computer', to: AGENT, kind: 'transcript', by: 'whisper', text: t.text, replyTo: inId });
      text = `[Voice note from ${OWNER}, transcribed on the computer: "${t.text}"]`;
    } else {
      log(`voice note not transcribed: ${t.error}`);
      text = `[${OWNER} sent a voice note, saved at ${savedFile}, but it could not be transcribed here (${t.error}). If you can't listen to audio, ask for it in text.]`;
    }
  }
  await enqueue({ id: m.id, to: m.from, text });
}

// ---------- main loop ----------
async function main() {
  log(`WhatsApp agent helper started (pid ${process.pid}, model: ${cfg.model?.type}).`);
  let backoff = 1000;
  for (;;) {
    if (!token) { token = await getToken(); if (!token) { await sleep(60_000); continue; } log('API key found; connecting.'); }
    if (!state.startedAt) { state.startedAt = Date.now(); save(); }
    try {
      const r = await api('GET', `/updates?offset=${state.offset ?? 0}&limit=50&timeout=25`, { timeoutMs: 40_000 });
      backoff = 1000;
      if (!r) continue;   // 204: nothing new
      for (const entry of r.entry ?? []) for (const ch of entry.changes ?? []) for (const m of ch.value?.messages ?? []) {
        try { await handle(m); } catch (e) { log(`handling a message failed: ${e.message}`); }
      }
      if (Number.isInteger(r.next_offset)) { state.offset = r.next_offset; save(); }
    } catch (e) {
      if ((e.status === 400 && e.body?.error?.code === 100) || e.status === 401) {
        log('WhatsApp says the API key is not valid (regenerated, app reinstalled, or agent removed). Save the new key with ./set-key.sh.');
        token = null; tokenMissingLogged = true; await sleep(5 * 60_000); continue;
      }
      if (e.status === 409) { log('another copy of this helper is polling; only run one'); await sleep(10_000); continue; }
      log(`poll problem: ${e.name === 'AbortError' ? 'timed out' : e.message}; trying again in ${Math.round(backoff / 1000)} s`);
      await sleep(backoff); backoff = Math.min(backoff * 2, 5 * 60_000);
    }
  }
}

if (process.argv[2] === '--try') {
  trying = true; state = { memory: { history: [] }, memoryDate: new Date().toLocaleDateString('en-CA', { timeZone: TZ }) };
  const r = await runModel(`WhatsApp from ${OWNER} (test run on the computer):\n${process.argv.slice(3).join(' ') || 'Say hello in one line.'}`);
  console.log(r.ok ? `--- reply that would be sent ---\n${r.text}` : `--- failed: ${r.why}`);
  process.exitCode = r.ok ? 0 : 1;
} else main();
