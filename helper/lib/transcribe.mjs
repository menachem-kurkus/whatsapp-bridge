// Voice notes are turned into words on this computer as soon as they arrive, with OpenAI's free Whisper
// (install: `brew install openai-whisper`, or `pip install openai-whisper`). No audio leaves the computer.
// Only one voice note is transcribed at a time (a lock folder), so a small computer isn't overloaded.
// Optional name hints (config.json "nameHints"): words Whisper should expect, like people or product names.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, rmdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const LOCK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'state', 'whisper.lock');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function findWhisper() {
  for (const p of ['/opt/homebrew/bin/whisper', '/usr/local/bin/whisper']) if (existsSync(p)) return p;
  try { return (await run('/bin/sh', ['-lc', 'command -v whisper'])).stdout.trim() || null; } catch { return null; }
}
async function lock() {
  for (let i = 0; i < 180; i++) {
    try { mkdirSync(LOCK); return true; } catch {
      try { if (Date.now() - statSync(LOCK).mtimeMs > 10 * 60_000) rmdirSync(LOCK); } catch { /* gone */ }
      await sleep(1000);
    }
  }
  return false;
}
// Returns { text } or { error }; never throws.
export async function transcribe(file, { model = 'base.en', hints = [] } = {}) {
  const whisper = await findWhisper();
  if (!whisper) return { error: 'Whisper is not installed on this computer' };
  if (!(await lock())) return { error: 'another voice note was still being transcribed after 3 minutes' };
  try {
    const dir = path.dirname(file);
    const args = [file, '--model', model, '--output_format', 'txt', '--output_dir', dir, '--fp16', 'False'];
    if (hints.length) args.push('--initial_prompt', hints.join(', '));
    await run(whisper, args, { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 });
    const text = readFileSync(path.join(dir, `${path.basename(file, path.extname(file))}.txt`), 'utf8').replace(/\s+/g, ' ').trim();
    return text ? { text } : { error: 'Whisper heard no words' };
  } catch (e) {
    return { error: e.killed ? 'Whisper took longer than 3 minutes' : `Whisper failed: ${String(e.stderr || e.message).trim().split('\n').pop().slice(0, 200)}` };
  } finally { try { rmdirSync(LOCK); } catch { /* fine */ } }
}
