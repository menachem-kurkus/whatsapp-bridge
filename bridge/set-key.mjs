// Saves your WhatsApp agent key to a private file in your home folder. Run it yourself, in your own terminal.
// The key is typed into THIS prompt (hidden). It never goes through the AI, a chat, or this project's folder.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { KEY_FILE } from './lib.mjs';

if (!process.stdin.isTTY) { console.error('Run this in a real terminal window so you can type the key.'); process.exit(1); }
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const prompt = 'Paste your WhatsApp agent key and press Enter (nothing will show): ';
rl._writeToOutput = (s) => { if (s.startsWith('Paste') || s === '\r\n' || s === '\n') process.stdout.write(s); }; // hide what you type
rl.question(prompt, (key) => {
  rl.close();
  key = key.trim();
  if (key.length < 20) { console.error('\nThat looks too short for a key. Nothing saved.'); process.exit(1); }
  mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  writeFileSync(KEY_FILE, `WHATSAPP_AGENT_KEY=${key}\n`, { mode: 0o600 });
  try { chmodSync(KEY_FILE, 0o600); } catch {}
  if (process.platform === 'win32') {
    // Windows: remove inherited access, keep this user only.
    spawnSync('icacls', [KEY_FILE, '/inheritance:r', '/grant:r', `${os.userInfo().username}:F`], { stdio: 'ignore' });
  }
  console.log(`\nSaved to ${KEY_FILE} (only your user can read it). Do not paste the key anywhere else.`);
});
