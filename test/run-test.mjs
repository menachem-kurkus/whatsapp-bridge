// End-to-end check against the fake service. No real WhatsApp, no real key.  Run:  node test/run-test.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'bridge-test-'));
const port = 8799;
const cfg = path.join(tmp, 'config.json');
writeFileSync(cfg, JSON.stringify({ ownerName: 'Sam', assistantName: 'Helper', agentId: 'helper', dataDir: path.join(tmp, 'state'), noticeAfterMinutes: 9 }));
const env = { ...process.env, BRIDGE_CONFIG: cfg, WHATSAPP_AGENT_KEY: 'test-key-0123456789abcdef', WHATSAPP_API_BASE: `http://localhost:${port}/agent/v1` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };

const mock = spawn(process.execPath, [path.join(root, 'test', 'mock-whatsapp.mjs'), String(port)], { stdio: 'ignore' });
await sleep(700);
const poller = spawn(process.execPath, [path.join(root, 'bridge', 'poller.mjs')], { env, stdio: ['ignore', 'pipe', 'ignore'] });
let out = '';
poller.stdout.on('data', (d) => (out += d));
await sleep(5000);

const run = (script, ...args) => spawnSync(process.execPath, [path.join(root, 'bridge', script), ...args], { env, encoding: 'utf8' });
const s1 = run('send.mjs', 'hello back');
const doc = path.join(tmp, 'reply.txt');
writeFileSync(doc, 'a file I send');
const s2 = run('sendfile.mjs', doc, 'here you go');
const s3 = run('sendfile.mjs', doc, 'same file again');
const note = run('chatnote.mjs', 'keyword-bot', 'Helper', 'a session wrote this');
poller.kill();
mock.kill();

const rows = readFileSync(path.join(tmp, 'state', 'chat.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
check('poller printed 4 WHATSAPP lines (plus early notes)', (out.match(/^WHATSAPP /gm) || []).length >= 4);
check('send.mjs worked', /sent 1/.test(s1.stdout));
check('sendfile.mjs worked', /sent file/.test(s2.stdout));
check('incoming text logged', rows.some((r) => r.kind === 'text' && r.from === 'Sam' && r.text === 'hello from the test phone' && r.id.startsWith('wa-helper-')));
check('outgoing text logged', rows.some((r) => r.kind === 'text' && r.from === 'Helper' && r.text === 'hello back'));
check('document logged with a copy under media/<date>/', rows.some((r) => r.kind === 'document' && r.from === 'Sam' && /^media\/\d{4}-\d\d-\d\d\//.test(r.file || '') && existsSync(path.join(tmp, 'state', r.file))));
check('early "arrived" line written for incoming file', rows.some((r) => r.kind === 'document-arrived' && r.early === true));
check('outgoing file logged with a copy', rows.some((r) => r.from === 'Helper' && r.kind === 'document' && r.file));
check('same file twice points at the first copy', (() => { const f = rows.filter((r) => r.from === 'Helper' && r.kind === 'document'); return f.length === 2 && f[0].file === f[1].file; })());
check('session note has a sess- id', /^sess-helper-\d{4}$/.test(note.stdout.trim()));
check('ids are unique and rising', new Set(rows.map((r) => r.id)).size === rows.length);
check('every line has v, id, at', rows.every((r) => r.v === 1 && r.id && /Z$/.test(r.at)));
console.log(failed ? `\n${failed} check(s) failed. State left in ${tmp}` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
