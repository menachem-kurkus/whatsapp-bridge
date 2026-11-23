# whatsapp-bridge

Message your own Claude Code session from WhatsApp. You text from your phone, your session answers, and files go both ways. Nothing connects in to your computer: it only makes outbound requests.

## The 60-second version

1. In Claude Code:
   ```
   /plugin marketplace add menachem-kurkus/whatsapp-bridge
   /plugin install whatsapp-bridge@whatsapp-bridge
   ```
2. Tell Claude: **"Set up the WhatsApp bridge."** It uses the `whatsapp-bridge-setup` skill and walks you through everything.
3. On your phone you create the WhatsApp agent (only you can). Then, in **your own terminal**, you run `node bridge/set-key.mjs` and paste the key into the hidden prompt. The key never goes through the AI.
4. Claude starts the poller under its Monitor. Send "hello" from WhatsApp. It answers.

Not using the plugin? Clone this repo, then give your AI [SETUP-FOR-AI.md](SETUP-FOR-AI.md).

## Two ways to run it

| | **Live bridge** (`bridge/`, the default) | **Helper** (`helper/`) |
|---|---|---|
| Who answers | Your open Claude Code session itself, with all its memory and tools | A helper program that starts a fresh AI job per message |
| AI you can use | Claude Code | Claude Code, Codex, an API key (Anthropic, OpenAI-style services, Gemini, OpenRouter...), a local model, or any command |
| Always on | Only while the session is open and the poller runs under Monitor | Can run in the background; `helper/install-mac.sh` restarts it on a Mac |
| Start here | The 60-second version above | [helper/README.md](helper/README.md) and [helper/60-SECONDS.md](helper/60-SECONDS.md) |

Both write the same `chat.jsonl` format and use the same key file (`node bridge/set-key.mjs`). The helper is the original assistant kit; the live bridge adds the Monitor-based path, quoted-reply text, video frames, session names in the history and Windows support for the key.

## How the live bridge works

```
your phone ── WhatsApp ── (outbound poll) ── poller.mjs ── prints a line ──> Claude Code's Monitor
                                                                                   │
your phone <── WhatsApp <── send.mjs / sendfile.mjs <────────── Claude answers <───┘
```

- `bridge/poller.mjs` prints each message as `WHATSAPP {json}`; Claude Code's Monitor tool turns each line into a wake-up.
- `bridge/send.mjs` and `bridge/sendfile.mjs` answer.
- Pictures, videos (as frames, needs ffmpeg) and files arrive as saved paths Claude can open. Voice notes can be transcribed locally (optional).
- One running history, in plain lines: `bridge/state/chat.jsonl`. See [CHAT-LOG.md](CHAT-LOG.md).

## Requirements

Node 20 or newer, Claude Code, WhatsApp on your phone with the agent feature. Optional: `ffmpeg`, Python with `faster-whisper`. Built for Windows, macOS and Linux (only Windows has been run so far, see "Tested" below).

## Your key

Keep it out of chats, screenshots and git. `bridge/set-key.mjs` saves it to `~/.whatsapp-bridge/.env` for your user only. The project folder never holds it, and `.gitignore` covers `bridge/config.json`, `bridge/state/` and key files.

## Limits

About 12 sends a minute, 15 polls a minute, 4096 characters per message, images up to 5 MB, other files up to 16 MB. It answers only while a Claude Code session is open with the poller running; otherwise messages wait at WhatsApp for about 30 days. A Monitor does not live forever, so after a reboot the session starts it again.

## Tested

- Verified on Windows with a fake local WhatsApp service (`npm test`, or `node test/run-test.mjs` and `node test/run-helper-test.mjs`): polling, text and file send, incoming files, de-duplication, history lines, shared copies of files, and the helper answering through a command "model".
- **Not verified by the author:** the real WhatsApp service from a fresh account, macOS and Linux, voice transcription, video frames, and installing through `/plugin marketplace add` from GitHub.

## License

MIT. See [LICENSE](LICENSE). This is an independent project, not made by or affiliated with WhatsApp, Meta or Anthropic.
