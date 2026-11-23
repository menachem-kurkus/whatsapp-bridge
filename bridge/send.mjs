// Sends a WhatsApp reply to the owner.  node send.mjs "text"   or pipe the text in on stdin.
// Long text is split into chunks of at most 4000 characters.
import { readFileSync, writeFileSync } from 'node:fs';
import { LAST_FROM_FILE, REPLIED_FILE, TOKEN, sendText, sleep } from './lib.mjs';

if (!TOKEN) { console.error('No WhatsApp key found. Run: node set-key.mjs'); process.exit(1); }
let to = '';
try { to = readFileSync(LAST_FROM_FILE, 'utf8').trim(); } catch {}
if (!/^user:\d+$/.test(to)) { console.error('No known recipient yet. Send your agent a message from your phone first.'); process.exit(1); }

let text = process.argv.slice(2).join(' ');
if (!text) text = readFileSync(0, 'utf8');
text = text.trim();
if (!text) { console.error('Nothing to send.'); process.exit(1); }

const chunks = [];
for (let i = 0; i < text.length; i += 4000) chunks.push(text.slice(i, i + 4000));
for (const chunk of chunks) {
  if (!(await sendText(to, chunk))) { console.error('Send failed. See state/bridge.log for the status code.'); process.exit(1); }
  await sleep(1000);
}
writeFileSync(REPLIED_FILE, String(Date.now()));
console.log(`sent ${chunks.length} message(s)`);
