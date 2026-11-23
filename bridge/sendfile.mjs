// Sends a picture or file back:  node sendfile.mjs <path> [caption]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { api, BASE, TOKEN, LAST_FROM_FILE, REPLIED_FILE, chat, config, log, sentId } from './lib.mjs';

const [file, caption = ''] = process.argv.slice(2);
if (!TOKEN) { console.error('No WhatsApp key found. Run: node set-key.mjs'); process.exit(1); }
if (!file || !existsSync(file)) { console.log('usage: node sendfile.mjs <path> [caption]'); process.exit(1); }
const types = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.md': 'text/plain', '.txt': 'text/plain' };
const mime = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
const kind = mime.startsWith('image/') ? 'image' : 'document';
let to = '';
try { to = readFileSync(LAST_FROM_FILE, 'utf8').trim(); } catch {}
if (!/^user:\d+$/.test(to)) { console.error('No known recipient yet. Send your agent a message from your phone first.'); process.exit(1); }

const fd = new FormData();
fd.append('file', new Blob([readFileSync(file)], { type: mime }), path.basename(file));
fd.append('type', mime);
fd.append('messaging_product', 'whatsapp');
const up = await fetch(BASE + '/media', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd });
const { id } = await up.json();
const media = { id, ...(caption ? { caption } : {}), ...(kind === 'document' ? { filename: path.basename(file) } : {}) };
const r = await api('POST', '/messages', { messaging_product: 'whatsapp', to, type: kind, [kind]: media }, 60_000);
log(`sent file kind=${kind} status=${r.status}`);
if (r.status !== 200) { console.log(`failed ${r.status}`); process.exit(1); }
writeFileSync(REPLIED_FILE, String(Date.now()));
chat.append({ source: 'wa', ext: sentId(r), from: config.assistantName, to: config.ownerName, kind, ...(caption ? { text: caption } : {}), localFile: file, filename: path.basename(file) });
console.log('sent file');
