// Downloads pictures, files and videos that arrive, to a temporary place, so chat.jsonl can keep one copy.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { BASE, TOKEN, DATA, log } from './lib.mjs';

const TMP = path.join(DATA, 'tmp');

async function fetchMedia(mediaId, ext, timeout) {
  mkdirSync(TMP, { recursive: true });
  const auth = { headers: { Authorization: `Bearer ${TOKEN}` } };
  const meta = await (await fetch(`${BASE}/media/${mediaId}`, { ...auth, signal: AbortSignal.timeout(20_000) })).json();
  let r = await fetch(meta.url, { ...auth, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) r = await fetch(meta.url, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) return null;
  const e = ext || ({ 'image/png': '.png', 'application/pdf': '.pdf', 'text/plain': '.txt', 'video/mp4': '.mp4' }[meta.mime_type] || '.jpg');
  const file = path.join(TMP, `in-${Date.now()}-${mediaId.slice(-6)}${e}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

export async function downloadImage(id) {
  try { return await fetchMedia(id, null, 30_000); } catch (e) { log(`image download error: ${e.name}`); return null; }
}

export async function downloadDocument(id, filename) {
  try { return await fetchMedia(id, (filename && path.extname(filename)) || null, 120_000); } catch (e) { log(`document download error: ${e.name}`); return null; }
}

// Video: saves it, then pulls up to 24 frames spread over the whole video (needs ffmpeg) so they can be read as pictures.
export async function downloadVideo(id) {
  try {
    const video = await fetchMedia(id, '.mp4', 240_000);
    if (!video) return null;
    const dir = video.replace(/\.[^.]+$/, '') + '-frames';
    mkdirSync(dir, { recursive: true });
    const dur = parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }).stdout) || 30;
    spawnSync('ffmpeg', ['-y', '-i', video, '-vf', `fps=${Math.min(1, 24 / dur).toFixed(4)},scale=720:-2`, '-frames:v', '24', '-q:v', '4', path.join(dir, 'f%02d.jpg')], { timeout: 180_000 });
    const frames = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().map((f) => path.join(dir, f));
    return { video, frames };
  } catch (e) { log(`video download error: ${e.name}`); return null; }
}
