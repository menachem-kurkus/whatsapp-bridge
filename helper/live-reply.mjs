#!/usr/bin/env node
// Live mode: send the open session's answer for a job back through WhatsApp.
//   node live-reply.mjs <job id> "the answer"        (or pipe the answer in: ... | node live-reply.mjs <job id>)
// Lines starting "SEND_FILE: /full/path | caption" send files. An empty answer sends "Done."
import { writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'live');
const [id, ...rest] = process.argv.slice(2);
if (!id) { console.error('Say which job: node live-reply.mjs <job id> "answer". The id is in the live-wait.mjs message.'); process.exit(1); }
if (!existsSync(path.join(LIVE, 'taken', `${id}.json`))) { console.error(`There's no taken job ${id} (check the id in the live-wait.mjs message). Nothing was sent.`); process.exit(1); }
const text = rest.length ? rest.join(' ') : (process.stdin.isTTY ? '' : readFileSync(0, 'utf8'));
const tmp = path.join(LIVE, 'outbox', `${id}.txt.part`);
writeFileSync(tmp, text);
renameSync(tmp, path.join(LIVE, 'outbox', `${id}.txt`));   // whole file at once, so the helper never reads half an answer
writeFileSync(path.join(LIVE, 'heartbeat'), JSON.stringify({ at: new Date().toISOString(), pid: process.pid }));   // still here; about to wait again
console.log('Answer handed to the helper; it goes out in a few seconds. Run live-wait.mjs again to keep taking messages.');
