#!/usr/bin/env node
// Live mode, for an open AI session (Claude Code, Codex, or anything that can run a command and wait):
// waits for the next WhatsApp message and prints it. While it waits, the helper knows a session is ready
// (live/heartbeat), so new messages come here instead of to the background model.
//   node live-wait.mjs [--minutes 9]      waits up to 9 minutes (fits most tools' command time limit), then exits
// After it prints a message: do the job, answer with live-reply.mjs, then run live-wait.mjs again.
import { readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'live');
for (const d of ['inbox', 'taken', 'outbox']) mkdirSync(path.join(LIVE, d), { recursive: true });
const i = process.argv.indexOf('--minutes');
const minutes = i > 0 ? Number(process.argv[i + 1]) || 9 : 9;
const beat = () => writeFileSync(path.join(LIVE, 'heartbeat'), JSON.stringify({ at: new Date().toISOString(), pid: process.pid }));
const end = Date.now() + minutes * 60_000;
beat();
const beater = setInterval(beat, 20_000);
for (;;) {
  const next = readdirSync(path.join(LIVE, 'inbox')).filter((f) => f.endsWith('.json')).sort()[0];
  if (next) {
    try {
      renameSync(path.join(LIVE, 'inbox', next), path.join(LIVE, 'taken', next));   // taken: the helper won't hand it to the background model
      const job = JSON.parse(readFileSync(path.join(LIVE, 'taken', next), 'utf8'));
      clearInterval(beater); beat();
      console.log(`NEW MESSAGE (job ${job.id})\n\n${job.prompt}\n\n` +
        `Do what it asks. Then answer with:\n  node ${path.join(path.dirname(LIVE), 'live-reply.mjs')} ${job.id} "your answer"\n` +
        `(To send a file, add a line: SEND_FILE: /full/path | caption. To send nothing, reply with "".)\n` +
        `Then run live-wait.mjs again to keep taking messages.`);
      process.exit(0);
    } catch { /* the helper took it back a moment ago; keep waiting */ }
  }
  if (Date.now() > end) { clearInterval(beater); console.log(`No new message in ${minutes} minutes. Run live-wait.mjs again to keep taking messages.`); process.exit(0); }
  await new Promise((r) => setTimeout(r, 1500));
}
