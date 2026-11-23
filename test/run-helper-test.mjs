// Checks the helper mode (helper/agent.mjs) against the fake service, using a tiny command "model".
//   node test/run-helper-test.mjs
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'helper-test-'));
// The helper imports ../../bridge/lib/chatlog.mjs, so keep that shape in the temp copy.
cpSync(path.join(root, 'helper'), path.join(tmp, 'helper'), { recursive: true });
mkdirSync(path.join(tmp, 'bridge', 'lib'), { recursive: true });
cpSync(path.join(root, 'bridge', 'lib', 'chatlog.mjs'), path.join(tmp, 'bridge', 'lib', 'chatlog.mjs'));
const model = path.join(tmp, 'model.mjs');
writeFileSync(model, "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('model heard: '+s.includes('hello from the test phone')));");
writeFileSync(path.join(tmp, 'helper', 'config.json'), JSON.stringify({ ownerName: 'Sam', agentName: 'Helper', model: { type: 'command', command: [process.execPath, model] }, onItAfterSeconds: 600 }));

const port = 8797;
const env = { ...process.env, WA_AGENT_KEY: 'test-key-0123456789abcdef', WHATSAPP_API_BASE: `http://localhost:${port}/agent/v1` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mock = spawn(process.execPath, [path.join(root, 'test', 'mock-whatsapp.mjs'), String(port)], { stdio: 'ignore' });
await sleep(700);
const agent = spawn(process.execPath, [path.join(tmp, 'helper', 'agent.mjs')], { env, cwd: path.join(tmp, 'helper'), stdio: 'ignore' });
await sleep(14000);
agent.kill();
mock.kill();

let failed = 0;
const check = (n, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) failed++; };
const file = path.join(tmp, 'helper', 'state', 'chat.jsonl');
const rows = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
check('chat.jsonl written by the helper', rows.length > 0);
check('incoming text logged', rows.some((r) => r.from === 'Sam' && r.text === 'hello from the test phone'));
check('model reply was sent and logged', rows.some((r) => r.from === 'Helper' && /model heard: true/.test(r.text || '')));
check('incoming file kept once under state/media/<date>/', rows.some((r) => r.from === 'Sam' && /^media\/\d{4}-\d\d-\d\d\//.test(r.file || '')));
check('lines use the shared format (v, id, at)', rows.every((r) => r.v === 1 && r.id && r.at));
console.log(failed ? `\n${failed} failed. Files in ${tmp}` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
