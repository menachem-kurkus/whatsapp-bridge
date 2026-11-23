# The chat history file: `bridge/state/chat.jsonl`

One file holds the whole conversation, incoming and outgoing. Each line is one small JSON object. Lines are only ever **added at the bottom**. Nothing is edited in place. To fix a mistake (a misheard voice note), append a new line with `corrects` pointing at the old line's `id`.

Every file that came in or went out is copied once to `bridge/state/media/<date>/`. The same file twice points at the first copy.

## Example

```json
{"v":1,"id":"wa-claude-0001","at":"2026-11-20T14:02:11.000Z","ext":"wamid.AAA","from":"Sam","to":"Claude","kind":"text","text":"Find Tuesday's invoice"}
{"v":1,"id":"wa-claude-0002","at":"2026-11-20T14:02:40.000Z","ext":"wamid.BBB","from":"Claude","to":"Sam","kind":"text","text":"Found it. Sending now."}
{"v":1,"id":"wa-claude-0003","at":"2026-11-20T14:02:42.000Z","ext":"wamid.CCC","from":"Claude","to":"Sam","kind":"document","file":"media/2026-11-20/wa-claude-0003-invoice.pdf","filename":"invoice.pdf"}
{"v":1,"id":"wa-claude-0004","at":"2026-11-20T15:10:05.000Z","ext":"wamid.DDD","from":"Sam","to":"Claude","via":"whisper","kind":"voice","text":"Remind me to call the bank at three."}
{"v":1,"id":"sess-claude-0005","at":"2026-11-20T15:10:30.000Z","from":"calendar-bot","to":"Claude","kind":"note","text":"Reminder set for 15:00"}
```

## Fields

| Field | Meaning |
|---|---|
| `v` | Format version, currently 1 |
| `id` | Our own id: where it came from (`wa` WhatsApp, `app` another app, `sess` a program or Claude session), the agent id from `config.json`, a running number |
| `at` | When, in UTC |
| `ext` | WhatsApp's own id for the message. A line with the same `ext`, `kind` and `from` is never written twice |
| `from`, `to` | Who sent it and who it was for (the names in `config.json`, or a program's name) |
| `via` | Something in between, for example `whisper` for a transcribed voice note |
| `kind` | `text`, `voice`, `image`, `video`, `document`, `note`, or `image-arrived` / `video-arrived` / `document-arrived` |
| `text` | The words, a transcript, or a caption |
| `file` | The saved copy, relative to `bridge/state/` |
| `replyTo` | The `id` of an earlier line this one answers (set when the person uses WhatsApp's reply) |
| `corrects` | On a correction line: the `id` it fixes |

Extra fields, used when they apply: `quotedFrom`, `quotedText` (what was replied to), `frames` (picture frames from a video), `mediaId`, `filename`, `note`, `early` (the line was written the moment a file arrived, before the download).

## Reading it

```bash
tail -n 20 bridge/state/chat.jsonl
grep -i "invoice" bridge/state/chat.jsonl
```

Other programs or sessions can add their own lines: `node bridge/chatnote.mjs <from> <to> "text"`.
