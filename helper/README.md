# WhatsApp Agent Kit

Turn a WhatsApp **agent chat** into a personal assistant that runs on your own computer and uses **the AI model you choose**: Claude, ChatGPT, Codex, Gemini, a free local model, any command line tool, or an AI session you keep open on your computer ("live mode").

You message it from WhatsApp like any other chat. It reads your message (and your photos, files and voice notes), does the job, and answers in the same chat, with files if needed.

**In a hurry?** Read `60-SECONDS.md`. **Using an AI helper to set it up?** Point it at this folder; it will find `SETUP-FOR-AI.md`.

---

## What you need

- **WhatsApp with the Agents feature** (Settings › Agents). It's rolling out on iPhone and Android; if you don't see it yet, update WhatsApp.
- **A computer that stays on.** A Mac is easiest: the kit includes Mac scripts that keep it running. Linux or Windows work too (see "Not on a Mac").
- **Node.js 20 or newer** from [nodejs.org](https://nodejs.org).
- **An AI model**, any one of:
  - **Claude Code** (it can use tools, like reading and making files and searching the web). Install it from [claude.com/claude-code](https://claude.com/claude-code) and run `claude` once to sign in.
  - **OpenAI Codex CLI** (also uses tools). Install it, then run `codex` once to sign in.
  - **An API key** from Anthropic, OpenAI, Google Gemini, OpenRouter, Groq or another service that uses the OpenAI chat format.
  - **A free local model** with [Ollama](https://ollama.com) or LM Studio. No key and nothing leaves your computer.
  - **Any command line tool** that reads a prompt and prints an answer.
- **Optional, for voice notes:** Whisper, which turns voice notes into words on your computer: `brew install openai-whisper`.

## How it works, in one picture

```
Your phone (WhatsApp agent chat)
        │  you send a message, photo, file or voice note
        ▼
WhatsApp's agent service  ◀── the helper on your computer asks "anything new?" every few seconds
        │                      (no website or open port needed)
        ▼
agent.mjs on your computer
  1. saves files to inbox/, turns voice notes into words (Whisper)
  2. gives the message to your model, with INSTRUCTIONS.md as its standing brief
  3. sends the answer back, plus any files the model made
  4. writes every message to state/chat.jsonl (one running history)
```

One job runs at a time. Messages that arrive while it's working are answered together in the next job, so a quick "oh, and also…" is never lost.

---

## Set it up (about 15 minutes)

### 1. Put the kit somewhere that stays

Unzip it into a folder you'll keep, for example `Documents/whatsapp-agent-kit`. Open Terminal in that folder (in Finder: right-click the folder › New Terminal at Folder).

### 2. Make the agent in WhatsApp

On your phone: **WhatsApp › Settings › Agents › Create agent**. Give it a name. Open its chat, tap the name at the top (**Chat info**), find **API key**, and copy it.

> Treat the key like a password. Anyone with it can read and send in that chat.

### 3. Make your settings file

```bash
cp config.example.json config.json
```

Open `config.json` and set:
- `ownerName`: your first name (the assistant calls you this).
- `agentName`: what you called the agent.
- `timeZone`: yours, like `America/New_York` or `Europe/London`.

### 4. Choose your model

In `config.json`, set `"model"`. The example file lists ready-made choices under `otherModelChoices`; copy one into `"model"`.

| You want | Set `"model"` to |
|---|---|
| Claude Code, with tools (recommended) | `{ "type": "claude-code", "allowedTools": ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"] }` |
| Codex, with tools |  `{ "type": "codex", "sandbox": "workspace-write" }` |
| Claude by API key | `{ "type": "anthropic", "model": "claude-opus-5-5", "keychainService": "whatsapp-agent-kit-model" }`, then run `npm install` |
| ChatGPT | `{ "type": "openai-compatible", "baseUrl": "https://api.openai.com/v1", "model": "gpt-5", "keychainService": "whatsapp-agent-kit-model" }` |
| Gemini | `{ "type": "openai-compatible", "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-2.5-flash", "keychainService": "whatsapp-agent-kit-model" }` |
| Many models through one key (OpenRouter) | `{ "type": "openai-compatible", "baseUrl": "https://openrouter.ai/api/v1", "model": "<a model name from openrouter.ai>", "keychainService": "whatsapp-agent-kit-model" }` |
| A free local model (Ollama) | `{ "type": "openai-compatible", "baseUrl": "http://localhost:11434/v1", "model": "llama3.2" }` |
| Any command line tool | `{ "type": "command", "command": ["llm", "-m", "gpt-4o-mini"], "systemInPrompt": true }` |

Model names change often; use the current name from your provider's website.

**What's the difference?** Claude Code and Codex can *do* things on your computer: open and make files, search the web, use connected apps. They work inside the kit's `workspace/` folder, so they can't change the kit itself. The API and local choices are *chat only*: they answer, summarize, draft and translate, but can't touch files. For every choice except Claude Code (which keeps its own conversation), the last 20 messages of the day are sent along each time so follow-ups make sense.

**Codex:** `"sandbox": "workspace-write"` lets it read your files and change files in `workspace/` only; use `"read-only"` for a look-only assistant. Codex support follows OpenAI's `codex exec` instructions; test it with step 7 before relying on it.

**Tools for Claude Code:** `allowedTools` lists what it may use without asking. Add `"Bash"` to let it run commands; add folders it may work in to `"addDirs"`, like `["~/Documents"]`. Start small and add as you go.

### 5. Save your keys

```bash
./set-key.sh           # paste the WhatsApp agent key
./set-key.sh model     # only if your model needs an API key
```

Keys go into the Mac Keychain. Nothing shows while you paste, and no key is ever written to a file or a log.

### 6. Write the assistant's brief

Open `INSTRUCTIONS.md` and describe, in plain words, who it helps, how to answer, and what it must always ask before doing. It's read fresh for every message, so you can change it any time.

### 7. Try it without WhatsApp

```bash
node agent.mjs --try "What can you help me with?"
```

You should see the reply it *would* send. If something's wrong, the message says what.

### 8. Turn it on

```bash
./install-mac.sh
```

It now runs in the background, starts when you log in, and restarts itself if it stops. Send your agent a WhatsApp message. You'll see the typing dots, then the answer.

To watch what it's doing: `tail -f logs/agent.log`. To turn it off: `./install-mac.sh remove`.

---

## Using it

- **Text it** like a person. Several quick messages in a row are answered together.
- **Send photos, PDFs and files.** They're saved in `inbox/<date>/` and the model is told where.
- **Send voice notes.** With Whisper installed, they're turned into words on your computer first (the audio never leaves it).
- **Get files back.** When the model writes a line `SEND_FILE: /path/to/file | caption`, the file is sent to you. Claude Code does this on its own when it makes something for you.
- **Long jobs:** after a minute it sends "On it", then the result when it's done. Jobs stop after 30 minutes (`jobLimitMinutes`).
- **History:** every message in and out is in `state/chat.jsonl`, and every file has a copy in `state/media/`. See `../CHAT-LOG.md`.
- **Job logs:** `logs/<date>-jobs.log` keeps each prompt and reply for troubleshooting. They're deleted after 30 days (`logDays`).
- **A fresh conversation each day**, so the model doesn't drag old topics along.

## Live mode: let an open AI session answer (optional)

Instead of a hidden background job, an AI session you keep open on your computer can answer your WhatsApp messages, where you can watch it work and step in. It remembers everything from that session, and can use whatever that session is connected to (its browser, apps, files). The background model stays as backup: if no session is waiting, or it doesn't pick a message up within 3 minutes, the background model answers, so you always get a reply.

It works with any session that can run a command and wait: Claude Code (in Terminal or the Claude app), Codex, and similar tools.

1. In `config.json`, set `"live": { "enabled": true, "pickupMinutes": 3 }`.
2. In your open session, paste this:

   > You're my WhatsApp assistant now. Read `INSTRUCTIONS.md` in `<kit folder>`. Run `node <kit folder>/live-wait.mjs`. When it prints a message, do what it asks, answer with the `live-reply.mjs` command it shows you, then run `live-wait.mjs` again. Keep doing this until I say stop.

`live-wait.mjs` waits up to 9 minutes at a time, so it fits the command time limit most tools have; the session simply runs it again. In Claude Code you can also run it in the background and it wakes the session when a message arrives.

## Setting it up with an AI helper (Claude Cowork, Codex, Claude Code)

You can hand this folder to any AI helper and say: "Set this up for me." It finds `SETUP-FOR-AI.md` on its own (or point it there), which also tells it how to connect an AI this kit doesn't list yet. It can make `config.json`, choose the model with you and write `INSTRUCTIONS.md`. Three steps stay with you:
- **Making the agent on your phone** and copying its key (only your phone can).
- **Pasting the keys** with `./set-key.sh` in Terminal. That's on purpose: the key goes straight into your Keychain and never passes through the AI.
- **`./install-mac.sh`**, if your helper can't run it (Cowork works in a separate space on your computer and may not be able to install a background helper). It's one command.

Note: Cowork is an app you talk to, so it can *set up* the kit but can't *be* the model behind the chat. Choose Claude Code, Codex, an API key or a local model as the model; or keep a Claude Code or Codex session open with live mode.

## Good to know (WhatsApp's rules for agent chats)

- An agent chat can only message **the person who created it**. It can't text other people or join groups.
- Up to 12 messages a minute; text up to 4,096 characters (longer answers are split); images up to 5 MB; other files up to 16 MB.
- WhatsApp keeps unread updates for 30 days, so if the computer is off for a while, messages are picked up when it's back.
- If you regenerate the key or reinstall WhatsApp, the old key stops working: run `./set-key.sh` again.

## Fixing problems

| You see | What to do |
|---|---|
| No answer at all | `tail -n 30 logs/agent.log`. "No WhatsApp API key yet" → run `./set-key.sh`. "API key is not valid" → copy a fresh key from Chat info and run `./set-key.sh`. |
| "That one didn't go through (…)" | The words in brackets say why. Run `node agent.mjs --try "hi"` to test the model on its own. |
| "Claude Code was not found" | Install Claude Code and run `claude` once to sign in. |
| "no API key for …" | Run `./set-key.sh model`. |
| Voice notes not understood | Install Whisper: `brew install openai-whisper`. Add names it mishears to `nameHints` in `config.json`. |
| "another copy of this helper is polling" | Two copies are running. Run `./install-mac.sh remove`, close any Terminal running `agent.mjs`, then `./install-mac.sh`. |

## Not on a Mac

Everything works on Linux. On Windows, the helper and the API choices work, but the scripts are Mac-only and the tool choices are less tested. Instead of the two Mac scripts:
- Instead of `./set-key.sh`, set the keys as environment variables: `WA_AGENT_KEY` for WhatsApp, and `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (or the name in your model's `"keyEnv"`) for the model.
- Instead of `./install-mac.sh`, keep `node agent.mjs` running with your system's service manager (systemd on Linux, Task Scheduler or NSSM on Windows) or `pm2`.

## Adding a model the kit doesn't know

Open `models.mjs`. Each model is one small function that gets the brief, the message and the day's memory, and returns `{ ok: true, text }` or `{ ok: false, why }`. Copy the closest one, give it a new name, and use that name as `"type"` in `config.json`.

## What's in the box

| File | What it is |
|---|---|
| `agent.mjs` | The helper: talks to WhatsApp, runs one job at a time, sends answers and files. |
| `models.mjs` | The model choices (Claude Code, Codex, Anthropic, OpenAI-style, any command). |
| `live-wait.mjs`, `live-reply.mjs` | Live mode: an open AI session takes and answers messages. |
| `lib/chatlog.mjs` | Thin adapter onto `../bridge/lib/chatlog.mjs`, which writes the running chat history and file copies. |
| `lib/transcribe.mjs` | Turns voice notes into words with Whisper. |
| `config.example.json` | Settings to copy into `config.json`. |
| `INSTRUCTIONS.md` | The assistant's standing brief. Yours to write. |
| `set-key.sh`, `install-mac.sh` | Save keys in the Keychain; keep it running on a Mac. |
| `../CHAT-LOG.md` | How the chat history file is laid out (shared with the live bridge). |
| `60-SECONDS.md` | The whole setup, read aloud in a minute. |
| `SETUP-FOR-AI.md` | Step-by-step setup for any AI helper, including how to add a new AI. |
| `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | Short pointers that AI tools read on their own when they open the folder. |
