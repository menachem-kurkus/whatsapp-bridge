// Optional: turns a voice note into text with the command in config.json (voice.command).
// Off by default. The audio is deleted after transcribing unless voice.keepAudio is true.
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BASE, TOKEN, HERE, DATA, config, log } from './lib.mjs';

// Returns { text, file } or null. `file` is set only when keepAudio is on; the caller deletes it otherwise.
export async function transcribeVoice(mediaId) {
  if (!config.voice.enabled) return null;
  const tmp = path.join(DATA, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const file = path.join(tmp, `voice-${Date.now()}.ogg`);
  try {
    const auth = { headers: { Authorization: `Bearer ${TOKEN}` } };
    const meta = await (await fetch(`${BASE}/media/${mediaId}`, { ...auth, signal: AbortSignal.timeout(20_000) })).json();
    let r = await fetch(meta.url, { ...auth, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) r = await fetch(meta.url, { signal: AbortSignal.timeout(30_000) });
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    const parts = config.voice.command.split(' ').map((p) => (p === '{file}' ? file : p));
    const text = await new Promise((resolve) => {
      execFile(parts[0], parts.slice(1), { cwd: HERE, timeout: 120_000 }, (err, out) => {
        if (err) { log(`transcribe error: ${err.message.slice(0, 120)}`); resolve(null); } else resolve(out.trim());
      });
    });
    if (!text) { try { rmSync(file); } catch {} return null; }
    return { text, file };
  } catch (e) {
    log(`voice download error: ${e.name}`);
    try { rmSync(file); } catch {}
    return null;
  }
}
