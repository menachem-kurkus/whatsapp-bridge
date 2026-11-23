// chatlog.mjs - one running history of the whole WhatsApp conversation, as plain lines of JSON.
//
//   state/chat.jsonl       one JSON object per line, append only, nothing is ever edited in place
//   state/media/<date>/    one copy of every file that came in or went out
//
// Written for this project. Format notes are in CHAT-LOG.md.
// Fix a mistake by appending a new line with `corrects: <id of the old line>`.

import {
  appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync,
  readFileSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const FORMAT_VERSION = 1;
const pad = (n) => String(n).padStart(4, '0');
const safeName = (s) => String(s || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);

// Standard fields come first in every line, in this order; anything extra (quotedText, frames, ...) follows.
const ORDER = ['v', 'id', 'at', 'ext', 'from', 'to', 'via', 'kind', 'text', 'file', 'replyTo', 'corrects'];

export function openChatLog({ dir, agent = 'assistant', owner = 'Owner', assistant = 'Assistant' }) {
  if (!dir) throw new Error('openChatLog needs a dir');
  const file = path.join(dir, 'chat.jsonl');
  const mediaRoot = path.join(dir, 'media');
  const lockFile = file + '.lock';
  const indexFile = path.join(dir, 'media-index.json');
  mkdirSync(dir, { recursive: true });

  const readRows = () => {
    try {
      return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch { return []; }
  };

  // Tiny lock so two processes (poller and send) never pick the same running number.
  function withLock(fn) {
    const start = Date.now();
    for (;;) {
      try { closeSync(openSync(lockFile, 'wx')); break; } catch {
        try { if (Date.now() - statSync(lockFile).mtimeMs > 10_000) unlinkSync(lockFile); } catch {}
        if (Date.now() - start > 3000) break; // give up waiting; write anyway rather than lose a line
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
    try { return fn(); } finally { try { unlinkSync(lockFile); } catch {} }
  }

  function readIndex() { try { return JSON.parse(readFileSync(indexFile, 'utf8')); } catch { return {}; } }

  // Keeps one copy of a file under media/<date>/. The same bytes twice point at the first copy.
  function saveCopy(src, id, at) {
    if (!src || !existsSync(src)) return null;
    const sha = createHash('sha256').update(readFileSync(src)).digest('hex');
    const index = readIndex();
    if (index[sha] && existsSync(path.join(dir, index[sha]))) return index[sha];
    const day = String(at).slice(0, 10);
    const rel = `media/${day}/${id}-${safeName(path.basename(src))}`;
    mkdirSync(path.join(mediaRoot, day), { recursive: true });
    copyFileSync(src, path.join(dir, rel));
    index[sha] = rel;
    writeFileSync(indexFile, JSON.stringify(index));
    return rel;
  }

  // The newest line that carries this outside (WhatsApp) id, or null.
  const findByExt = (ext) => (ext ? [...readRows()].reverse().find((r) => r.ext === ext) || null : null);

  // rec: { source: 'wa'|'mac'|'sess'|'app', from, to, kind, text?, ext?, via?, localFile?, replyTo?, corrects?, at?, ...extras }
  // Returns the line that was written. A line whose ext is already in the file is not written twice.
  function append(rec) {
    const { source = 'wa', localFile, at, ...rest } = rec;
    return withLock(() => {
      const rows = readRows();
      if (rest.ext && rows.some((r) => r.ext === rest.ext && r.kind === rest.kind && r.from === rest.from)) {
        return rows.find((r) => r.ext === rest.ext && r.kind === rest.kind && r.from === rest.from);
      }
      const n = rows.reduce((m, r) => Math.max(m, Number(String(r.id).split('-').pop()) || 0), 0) + 1;
      const id = `${source}-${agent}-${pad(n)}`;
      const when = at ? new Date(at).toISOString() : new Date().toISOString();
      const copy = localFile ? saveCopy(localFile, id, when) : null;
      const line = { v: FORMAT_VERSION, id, at: when, ...rest, ...(copy ? { file: copy } : {}) };
      const ordered = {};
      for (const k of ORDER) if (line[k] !== undefined && line[k] !== null) ordered[k] = line[k];
      for (const k of Object.keys(line)) if (!(k in ordered) && line[k] !== undefined && line[k] !== null) ordered[k] = line[k];
      appendFileSync(file, JSON.stringify(ordered) + '\n');
      return ordered;
    });
  }

  return { file, dir, owner, assistant, agent, append, findByExt, readRows, saveCopy };
}
