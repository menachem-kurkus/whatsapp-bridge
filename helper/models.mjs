// Model adapters: the one place that knows how to talk to an AI model. agent.mjs only calls askModel().
// Pick one in config.json under "model": { "type": ... }. Every adapter returns { ok: true, text } or { ok: false, why }.
//
//   claude-code        Claude Code on this computer (`claude -p`). Can use tools: read and make files, run commands,
//                      search the web, use your connectors. Memory: resumes the same conversation all day.
//   codex              OpenAI Codex CLI on this computer (`codex exec`). Can use tools too.
//   anthropic          Claude through the Anthropic API (official SDK). Chat only, no tools. Needs an Anthropic API key.
//   openai-compatible  Any service that speaks the OpenAI chat format: OpenAI, OpenRouter, Google Gemini, Groq,
//                      or a local model with Ollama or LM Studio. Chat only, no tools.
//   command            Any command line tool: the prompt goes in on stdin, the reply comes out on stdout.
//
// Everything but claude-code gets the day's last messages sent along each time, so follow-ups have context.
// Models that can use tools work inside workspace/ (not the kit folder), so they can't change the kit's own files.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const run = promisify(execFile);
const KEEP_TURNS = 20;   // how many recent messages (both sides) are sent back each time

// An API key comes from the macOS Keychain ("keychainService") or an environment variable ("keyEnv"). Never from a file.
async function apiKey(m, fallbackEnv) {
  if (m.keychainService && process.platform === 'darwin') {
    try { const { stdout } = await run('security', ['find-generic-password', '-s', m.keychainService, '-w']); if (stdout.trim()) return stdout.trim(); } catch { /* not there */ }
  }
  const env = m.keyEnv || fallbackEnv;
  return env ? process.env[env] : undefined;
}
function remember(memory, prompt, reply) {
  if (!reply) return;   // an empty reply would make some APIs refuse the whole day's history
  memory.history = [...(memory.history ?? []), { role: 'user', content: prompt }, { role: 'assistant', content: reply }].slice(-KEEP_TURNS);
}
// For tools that take one block of text: the brief, then today's earlier messages, then the new one.
function asOneText(system, memory, prompt) {
  const earlier = (memory.history ?? []).map((h) => `${h.role === 'user' ? 'THEM' : 'YOU'}: ${h.content}`).join('\n\n');
  return `${system}\n\n${earlier ? `--- Earlier today in this chat ---\n${earlier}\n\n` : ''}--- New message ---\n${prompt}`;
}
function workspace(cwd, m) {
  const dir = m.workspace ? m.workspace.replace(/^~/, os.homedir()) : path.join(cwd, 'workspace');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function askModel(m, job) {
  if (!m?.type) return { ok: false, why: 'config.json has no "model" set (see README.md, step 4)' };
  const adapter = ADAPTERS[m.type];
  if (!adapter) return { ok: false, why: `unknown model type "${m.type}"; use one of: ${Object.keys(ADAPTERS).join(', ')}` };
  return adapter(m, job);
}

const ADAPTERS = {
  // ---------- Claude Code (claude -p) ----------
  async 'claude-code'(m, { system, prompt, memory, cwd, limitMin }) {
    const bin = await findOnPath(m.bin || 'claude', [path.join(os.homedir(), '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']);
    if (!bin) return { ok: false, why: 'Claude Code was not found on this computer (install it, then run `claude` once to sign in)' };
    const args = [prompt, '-p', '--output-format', 'json', '--append-system-prompt', system,
      '--permission-mode', 'default',
      ...(m.allowedTools?.length ? ['--allowedTools', m.allowedTools.join(',')] : []),
      ...(m.disallowedTools?.length ? ['--disallowedTools', m.disallowedTools.join(',')] : []),
      ...(m.model ? ['--model', m.model] : []),
      ...[path.join(cwd, 'inbox'), ...(m.addDirs ?? [])].flatMap((d) => ['--add-dir', d.replace(/^~/, os.homedir())]),
      ...(memory.sessionId ? ['--resume', memory.sessionId] : [])];
    const r = await spawnText(bin, args, { cwd: workspace(cwd, m), limitMin });
    let j = null;
    try { j = JSON.parse(r.out.trim().split('\n').filter((l) => l.startsWith('{')).pop()); } catch { /* not json */ }
    if (j?.session_id) memory.sessionId = j.session_id;
    if (!j || j.is_error || r.code !== 0) {
      if (/No conversation found/i.test(r.err)) memory.sessionId = null;   // start fresh next time
      return { ok: false, why: j?.result ? String(j.result).slice(0, 200) : stopped('Claude', r, limitMin) };
    }
    return { ok: true, text: String(j.result ?? '').trim() };
  },

  // ---------- OpenAI Codex CLI (codex exec) ----------
  // Runs in workspace/ with the "workspace-write" sandbox: it may read your files and change files in workspace/ only.
  // Set "sandbox": "read-only" for a look-only assistant. Install Codex and sign in once by running `codex`.
  async codex(m, { system, prompt, memory, cwd, limitMin }) {
    const bin = await findOnPath(m.bin || 'codex', ['/opt/homebrew/bin/codex', '/usr/local/bin/codex']);
    if (!bin) return { ok: false, why: 'Codex was not found on this computer (install the Codex CLI, then run `codex` once to sign in)' };
    const ws = workspace(cwd, m), out = path.join(ws, `.codex-reply-${Date.now()}.txt`);
    const args = ['exec', '--skip-git-repo-check', '--sandbox', m.sandbox || 'workspace-write', '--cd', ws,
      '--output-last-message', out, ...(m.model ? ['--model', m.model] : []), '-'];
    const r = await spawnText(bin, args, { cwd: ws, limitMin, stdin: asOneText(system, memory, prompt) });
    let text = '';
    try { text = readFileSync(out, 'utf8').trim(); rmSync(out); } catch { text = r.out.trim(); }
    if (r.code !== 0) return { ok: false, why: stopped('Codex', r, limitMin) };
    remember(memory, prompt, text);
    return { ok: true, text };
  },

  // ---------- Anthropic API (official SDK: npm install) ----------
  async anthropic(m, { system, prompt, memory }) {
    let Anthropic;
    try { ({ default: Anthropic } = await import('@anthropic-ai/sdk')); }
    catch { return { ok: false, why: 'the Anthropic SDK is not installed; run `npm install` in the kit folder' }; }
    const key = await apiKey(m, 'ANTHROPIC_API_KEY');
    if (!key) return { ok: false, why: 'no Anthropic API key (save it with ./set-key.sh model, or set ANTHROPIC_API_KEY)' };
    const client = new Anthropic({ apiKey: key });
    try {
      const msg = await client.messages.create({
        model: m.model || 'claude-opus-5-5',
        max_tokens: m.maxTokens ?? 2000,
        system,
        messages: [...(memory.history ?? []), { role: 'user', content: prompt }],
      });
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      remember(memory, prompt, text);
      return { ok: true, text };
    } catch (e) {
      return { ok: false, why: e instanceof Anthropic.APIError ? `Anthropic said ${e.status}: ${e.message.slice(0, 160)}` : e.message };
    }
  },

  // ---------- anything that speaks the OpenAI chat format ----------
  async 'openai-compatible'(m, { system, prompt, memory }) {
    const base = (m.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const key = await apiKey(m, 'OPENAI_API_KEY');
    const local = /localhost|127\.0\.0\.1/.test(base);
    if (!key && !local) return { ok: false, why: `no API key for ${base} (save it with ./set-key.sh model, or set ${m.keyEnv || 'OPENAI_API_KEY'})` };
    // OpenAI's own newer models take max_completion_tokens; most other services still take max_tokens.
    const limitField = m.limitField || (/api\.openai\.com/.test(base) ? 'max_completion_tokens' : 'max_tokens');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: m.model, [limitField]: m.maxTokens ?? 2000,
        messages: [{ role: 'system', content: system }, ...(memory.history ?? []), { role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(5 * 60_000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (res.status === 0) return { ok: false, why: `couldn't reach ${base} (${await res.text()}); is it running and is the address right?` };
    if (!res.ok) return { ok: false, why: `${base} answered ${res.status}: ${(await res.text()).slice(0, 160)}` };
    const j = await res.json();
    const text = String(j.choices?.[0]?.message?.content ?? '').trim();
    remember(memory, prompt, text);
    return { ok: true, text };
  },

  // ---------- any command line tool ----------
  // "command": ["llm", "-m", "gpt-4o-mini"] or ["./my-script.sh"]. The prompt (with today's earlier messages) goes in on
  // stdin; the standing instructions are in the SYSTEM_PROMPT environment variable, and also on stdin if "systemInPrompt".
  async command(m, { system, prompt, memory, cwd, limitMin }) {
    if (!Array.isArray(m.command) || !m.command.length) return { ok: false, why: 'model.command must be a list, like ["llm", "-m", "gpt-4o"]' };
    const [first, ...args] = m.command;
    const bin = await findOnPath(/^\.\.?[\/\\]/.test(first) ? path.resolve(cwd, first) : first);   // ./my-script.sh means the kit folder
    if (!bin) return { ok: false, why: `the tool "${first}" was not found on this computer (install it, or put its full path in config.json "command")` };
    const stdin = m.systemInPrompt ? asOneText(system, memory, prompt) : asOneText('', memory, prompt).trim();
    const r = await spawnText(bin, args, { cwd: workspace(cwd, m), limitMin, stdin, env: { SYSTEM_PROMPT: system } });
    if (r.code !== 0) return { ok: false, why: stopped(bin, r, limitMin) };
    const text = r.out.trim();
    remember(memory, prompt, text);
    return { ok: true, text };
  },
};

const stopped = (name, r, limitMin) => r.timedOut ? `it passed its ${limitMin} minute limit`
  : `${name} stopped (exit ${r.code})${r.err ? `: ${r.err.trim().split('\n').pop().slice(0, 160)}` : ''}`;

async function findOnPath(name, extra = []) {
  if (name.includes('/') || name.includes('\\')) return existsSync(name) ? name : null;
  for (const c of extra) if (existsSync(c)) return c;
  try {
    const { stdout } = process.platform === 'win32' ? await run('where', [name]) : await run('/bin/sh', ['-lc', `command -v ${name}`]);
    return stdout.trim().split(/\r?\n/)[0] || null;
  } catch { return null; }
}
function spawnText(bin, args, { cwd, limitMin = 30, stdin, env = {} }) {
  return new Promise((resolve) => {
    let out = '', err = '', timedOut = false;
    const childEnv = { ...process.env, ...env };
    delete childEnv.WA_AGENT_KEY;   // the model never sees the WhatsApp key
    const child = spawn(bin, args, { cwd, detached: process.platform !== 'win32', env: childEnv, stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    if (stdin) { child.stdin.on('error', () => { /* the tool didn't read its input; fine */ }); child.stdin.end(stdin); }
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { timedOut = true; try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch { /* gone */ } }, limitMin * 60_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err, timedOut }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: e.message, timedOut }); });
  });
}
