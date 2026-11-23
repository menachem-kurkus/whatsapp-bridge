// The poller: asks WhatsApp for new messages (outbound only, nothing connects in to your computer)
// and prints each one as a line:   WHATSAPP {"id":"...","text":"..."}
// Run it under your Claude Code session's Monitor tool so each line wakes the session.
// Every message is also written to state/chat.jsonl.
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import {
  STATE_FILE, LAST_FROM_FILE, REPLIED_FILE, TOKEN, api, chat, config, log, markRead, sendText, sleep,
} from './lib.mjs';
import { transcribeVoice } from './voice.mjs';
import { downloadDocument, downloadImage, downloadVideo } from './media.mjs';

const MIN_POLL_GAP_MS = 4200; // WhatsApp allows 15 polls a minute
const REPLY_WAIT_MS = config.noticeAfterMinutes * 60_000;
const TYPING_REFRESH_MS = 20_000; // the typing indicator lasts 25 seconds

if (!TOKEN) {
  console.log('BRIDGE-ERROR no WhatsApp key found. Run: node set-key.mjs (in your own terminal)');
  process.exit(1);
}

let state = { offset: null, handled: [] };
try { state = { ...state, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }; } catch {}
const STARTED = Math.floor(Date.now() / 1000);
const firstRun = state.offset === null;
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state));

function repliedSince(t) {
  try { return statSync(REPLIED_FILE).mtimeMs > t; } catch { return false; }
}

let lastNoticeAt = 0;
// Keeps the typing indicator alive while the assistant works. Says so once if nothing comes back in time.
async function watchReply(msg, receivedAt) {
  while (Date.now() - receivedAt < REPLY_WAIT_MS) {
    await sleep(TYPING_REFRESH_MS);
    if (repliedSince(receivedAt)) return;
    await markRead(msg.id, true);
  }
  if (!repliedSince(receivedAt) && Date.now() - lastNoticeAt > 30 * 60_000) {
    lastNoticeAt = Date.now();
    log('no reply in time; sent notice');
    await sendText(msg.from, "I haven't answered yet. Your message is saved and will be answered when I can.");
  }
}

async function handleMessage(msg) {
  if (!msg?.id || state.handled.includes(msg.id)) return;
  state.handled.push(msg.id);
  state.handled = state.handled.slice(-500);
  saveState(); // mark first: each message is delivered at most once, even after a crash

  if (firstRun && (Number(msg.timestamp) || 0) < STARTED - 30) { log('skipped backlog message'); return; }

  writeFileSync(LAST_FROM_FILE, msg.from);
  const receivedAt = Date.now();
  const at = Number(msg.timestamp) ? Number(msg.timestamp) * 1000 : Date.now();
  const isText = msg.type === 'text' && msg.text?.body;
  log(`in type=${msg.type} chars=${isText ? msg.text.body.length : 0}`);

  const base = { source: 'wa', ext: msg.id, at, from: config.ownerName, to: config.assistantName };
  const quotedExt = msg.context?.id ?? null;
  const quoted = quotedExt ? chat.findByExt(quotedExt) : null;
  const quotedFields = quoted ? { replyTo: quoted.id, quotedFrom: quoted.from, quotedText: String(quoted.text || quoted.filename || '').slice(0, 600) } : {};
  const say = (event) => console.log('WHATSAPP ' + JSON.stringify(event));
  const caption = (msg[msg.type] || {}).caption ? String(msg[msg.type].caption).slice(0, 4000) : null;

  // A picture, video or file is noted the moment it ARRIVES, before the slow download, so it cannot vanish.
  if (['image', 'video', 'document'].includes(msg.type)) {
    chat.append({ ...base, kind: msg.type + '-arrived', mediaId: (msg[msg.type] || {}).id, filename: (msg.document || {}).filename, ...(caption ? { text: caption } : {}), note: 'arrived; downloading now', early: true });
  }

  let event;
  if (isText) {
    chat.append({ ...base, kind: 'text', text: msg.text.body, ...quotedFields });
    event = { id: msg.id, text: msg.text.body.slice(0, 4000) };
  } else if (msg.type === 'audio' && msg.audio?.id) {
    const v = await transcribeVoice(msg.audio.id);
    if (v) {
      chat.append({ ...base, kind: 'voice', via: 'whisper', text: v.text, ...(v.file ? { localFile: v.file } : {}), ...quotedFields });
      if (v.file && !config.voice.keepAudio) try { rmSync(v.file); } catch {}
      event = { id: msg.id, type: 'voice', text: v.text.slice(0, 4000), note: 'voice note, transcribed on this computer (may contain errors)' };
    } else {
      chat.append({ ...base, kind: 'voice', note: 'voice note, not transcribed', ...quotedFields });
      event = { id: msg.id, type: 'voice', note: 'voice note, could not be transcribed' };
    }
  } else if (msg.type === 'image') {
    const file = msg.image?.id ? await downloadImage(msg.image.id) : null;
    chat.append({ ...base, kind: 'image', ...(caption ? { text: caption } : {}), ...(file ? { localFile: file } : { note: 'could not be downloaded' }), ...quotedFields });
    event = { id: msg.id, type: 'image', ...(caption ? { text: caption } : {}), ...(file ? { image: file, note: 'a picture; open it with the Read tool' } : { note: 'a picture that could not be downloaded' }) };
  } else if (msg.type === 'video') {
    const vid = msg.video?.id ? await downloadVideo(msg.video.id) : null;
    chat.append({ ...base, kind: 'video', ...(caption ? { text: caption } : {}), ...(vid ? { localFile: vid.video, frames: vid.frames } : { note: 'could not be downloaded' }), ...quotedFields });
    event = { id: msg.id, type: 'video', ...(caption ? { text: caption } : {}), ...(vid ? { video: vid.video, frames: vid.frames, note: 'a video; frames are saved as pictures, open them with the Read tool' } : { note: 'a video that could not be downloaded' }) };
  } else if (msg.type === 'document') {
    const file = msg.document?.id ? await downloadDocument(msg.document.id, msg.document.filename) : null;
    chat.append({ ...base, kind: 'document', ...(caption ? { text: caption } : {}), filename: msg.document?.filename, ...(file ? { localFile: file } : { note: 'could not be downloaded' }), ...quotedFields });
    event = { id: msg.id, type: 'document', ...(caption ? { text: caption } : {}), ...(file ? { file, note: `a document (${msg.document?.filename || ''}); open it with the Read tool` } : { note: 'a document that could not be downloaded' }) };
  } else {
    chat.append({ ...base, kind: String(msg.type), note: 'not a text message; content was not read', ...quotedFields });
    event = { id: msg.id, type: msg.type, note: 'not a text message; content was not read' };
  }
  if (quoted) Object.assign(event, { quotedFrom: quotedFields.quotedFrom, quotedText: quotedFields.quotedText });
  if (!process.env.RELAY_QUIET) say(event); // quiet mode keeps message text out of any output file

  await markRead(msg.id, true);
  watchReply(msg, receivedAt); // not awaited: polling continues
}

let backoffMs = 0;
const bumpBackoff = () => (backoffMs = Math.min(backoffMs ? backoffMs * 2 : 2000, 60_000));

async function main() {
  log(`poller starting (firstRun=${firstRun})`);
  let lastPoll = 0;
  for (;;) {
    const wait = lastPoll + MIN_POLL_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastPoll = Date.now();

    let r;
    try {
      r = await api('GET', `/updates?offset=${state.offset ?? 0}&limit=50&timeout=25`, null, 45_000);
    } catch (e) { log(`poll error: ${e.name}`); await sleep(bumpBackoff()); continue; }

    if (r.status === 204) { backoffMs = 0; continue; }
    if (r.status === 200 && r.data) {
      backoffMs = 0;
      const value = r.data.entry?.[0]?.changes?.[0]?.value;
      for (const msg of value?.messages ?? []) await handleMessage(msg);
      if (typeof r.data.next_offset === 'number') { state.offset = r.data.next_offset; saveState(); }
      continue;
    }

    log(`poll status=${r.status}`);
    if (r.status === 401 || r.status === 403) {
      console.log('BRIDGE-ERROR WhatsApp rejected the key. Make a new key in WhatsApp and run: node set-key.mjs');
      process.exit(1);
    }
    if (r.status === 409) {
      console.log('BRIDGE-ERROR another poller is already running for this agent. Stopping this one.');
      process.exit(1);
    }
    await sleep(bumpBackoff());
  }
}

process.on('SIGINT', () => { log('stopped'); process.exit(0); });
main();
