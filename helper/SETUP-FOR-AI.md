# Setup guide for AI helpers

You are an AI helper (Claude, ChatGPT, Codex, Gemini, Cursor, Copilot, a local model, or anything else) asked to set up this kit for the person you're working with. Follow these steps in order. Talk to them in plain, friendly words; they may not be technical. README.md has the human version of everything here.

## What this kit is

`agent.mjs` is a small Node.js helper that runs on this computer. It long-polls WhatsApp's Agent Platform (`https://api.whatsapp.com/agent/v1`) for messages from the person's WhatsApp agent chat, hands each message to an AI ("the brain"), and sends the answer back. The brain is chosen in `config.json` → `"model"`, and every brain is one small adapter function in `models.mjs`.

There are two ways for the brain to work, and you can set up either or both:
- **Headless (background):** the helper starts the AI itself for each message, with no window. That needs an AI it can call on its own: an API, a local model server, or a command line tool with a run-once mode.
- **Live mode:** an AI session that stays open (possibly you) takes the messages itself, by running `node live-wait.mjs` and answering with `node live-reply.mjs`. The headless brain is the backup when no session is waiting.

## Rules you must keep

1. **Never handle the keys yourself.** Don't ask the person to paste a key into the chat. Don't put a key in a file, a command line, or a log. The person runs `./set-key.sh` (WhatsApp key) and `./set-key.sh model` (AI key) **in their own Terminal**; the scripts put the keys in the macOS Keychain. Off a Mac, they set environment variables themselves (README "Not on a Mac").
2. **Only the person can make the WhatsApp agent** (on their phone: WhatsApp › Settings › Agents › Create; Chat info › API key). An agent chat can only message the person who made it. It can't message anyone else or join groups. Don't promise otherwise.
3. **Don't edit `agent.mjs`** unless something is actually broken. To add a brain, edit `models.mjs` only.
4. **Start with few tool permissions.** For tool-using brains, start small (read, write in `workspace/`, web search) and add more only when the person asks.
5. **Test before you say it works** (step 6).

## Steps

**1. Check the basics.** Run `node --version`; it needs 20 or newer (if it's missing or older, point them to nodejs.org). Note the operating system: the two `.sh` scripts are for Mac.

**2. Make the settings file.** Copy `config.example.json` to `config.json`. Ask for and fill in `ownerName` (their first name), `agentName` (what they called the agent), and `timeZone` (an IANA name like `America/Chicago`).

**3. Choose the headless brain.** Ask which AI they use and pay for, and find their row below. If more than one row fits, say what each gives them (tool-using brains can work with files; chat-only ones just answer) and let them choose. If they named a specific tool, use that one:

| They have | Set `"model"` to | Notes |
|---|---|---|
| Claude Code installed | `{ "type": "claude-code", "allowedTools": ["Read","Write","Edit","Glob","Grep","WebSearch","WebFetch"] }` | Uses tools. Keeps its own conversation all day. |
| OpenAI Codex CLI installed | `{ "type": "codex", "sandbox": "workspace-write" }` | Uses tools. |
| An Anthropic API key | `{ "type": "anthropic", "model": "<current model id>", "keychainService": "whatsapp-agent-kit-model" }` | Run `npm install` first. Chat only. |
| Any service with an OpenAI-style `/chat/completions` endpoint (OpenAI, Google Gemini, OpenRouter, Groq, Mistral, Together, DeepSeek, xAI, Azure OpenAI ...) | `{ "type": "openai-compatible", "baseUrl": "<the service's OpenAI-compatible base URL>", "model": "<model id>", "keychainService": "whatsapp-agent-kit-model" }` | Look up that service's own docs for the base URL and current model ids; don't guess. Chat only. |
| A local model (Ollama, LM Studio, llama.cpp server, vLLM) | `{ "type": "openai-compatible", "baseUrl": "http://localhost:<port>/v1", "model": "<local model name>" }` | No key. The model server must be running. |
| A command line tool that can answer one prompt and exit (for example Gemini CLI, Aider, the `llm` tool, or their own script) | `{ "type": "command", "command": ["<tool>", "<its run-once flags>"], "systemInPrompt": true }` | The prompt arrives on stdin and the answer must be printed on stdout. Check the tool's docs for its run-once flag and how it reads stdin. Use the tool's **full path** (from `command -v <tool>`): the background service started by `install-mac.sh` only searches the usual folders (Node's, /opt/homebrew/bin, /usr/local/bin, /usr/bin, /bin). If the tool keeps its own API key, nothing is needed from `set-key.sh model`. |
| Something none of these fit | Write a new adapter (see "Adding a brain") | |

Model ids and base URLs change often. Read the provider's current docs instead of relying on memory.

**4. The keys.** Tell the person to run, in Terminal, in this folder:
- `./set-key.sh`, then paste the WhatsApp agent key (nothing shows while pasting; that's normal).
- `./set-key.sh model`, only if the brain needs an API key.

**5. The brief.** Help them fill in `INSTRUCTIONS.md`: who the assistant helps, how to answer, and what always needs their yes first. Keep it short.

**6. Test** (README step 7). Run `node agent.mjs --try "Say hello in one line."` You should see `--- reply that would be sent ---` and an answer. If it shows `--- failed: ...` (and exits with code 1), the words after it say why. Fix the cause and run it again. (`--try` never touches WhatsApp or the saved state.)

**7. Turn it on.** On a Mac: `./install-mac.sh` (it starts at login and restarts itself). If you can't run commands on the person's own computer (some helpers work in a separate sandbox), ask them to run it. Then ask them to send their agent a WhatsApp message. Watch `logs/agent.log` for `job start` and `job done`.

**8. Live mode (optional, ask if they want it).** If they want an open session to answer (you, if you're a session that can run shell commands and keep going, or another one):
- In `config.json` set `"live": { "enabled": true, "pickupMinutes": 3 }`.
- The session loop: run `node live-wait.mjs` (it waits up to 9 minutes, so it fits most command time limits; `--minutes N` changes that). When it prints `NEW MESSAGE (job <id>)`, do the job, then run `node live-reply.mjs <id> "<answer>"` (or pipe the answer in on stdin). Run `live-wait.mjs` again right away. While `live-wait.mjs` is running, or for 2 minutes after a reply, the helper treats the session as present.
- To send files: put a line `SEND_FILE: /full/path/to/file | caption` in the answer. To send nothing, answer with `""` (the person gets "Done.").
- If the session doesn't pick a message up within `pickupMinutes`, the headless brain answers instead, so keep a headless brain configured.
- Give the person this line to paste into their session whenever they want it to take over: *"You're my WhatsApp assistant now. Read INSTRUCTIONS.md in <kit folder>. Run node <kit folder>/live-wait.mjs; when it prints a message, do what it asks, answer with the live-reply.mjs command it shows, then run live-wait.mjs again. Keep going until I say stop."*

**9. Tell the person what you set up.** Which brain, whether live mode is on, how to watch it (`tail -f logs/agent.log`), how to turn it off (`./install-mac.sh remove`), and that INSTRUCTIONS.md can be changed any time.

## Adding a brain (a new adapter in `models.mjs`)

Add one entry to the `ADAPTERS` object. Its name is the `"type"` used in `config.json`.

```js
async 'my-brain'(m, { system, prompt, memory, cwd, limitMin }) {
  // m:        this brain's settings from config.json "model" (your own fields are fine, e.g. m.baseUrl, m.model)
  // system:   the standing brief (INSTRUCTIONS.md plus a few WhatsApp rules)
  // prompt:   the new message(s), already turned into text (files are described with their saved path)
  // memory:   today's memory, saved for you between messages. Chat-style brains use memory.history
  //           (a list of { role: 'user' | 'assistant', content }); call remember(memory, prompt, text) after a reply.
  //           Session-style brains can keep their own id instead, e.g. memory.sessionId.
  // cwd:      the kit folder. Tool-using brains should work in workspace(cwd, m), not in the kit folder.
  // limitMin: stop after this many minutes.
  // Get keys with: await apiKey(m, 'SOME_ENV_NAME')   (Keychain first, then the environment variable; never a file)
  // Run programs with: await spawnText(bin, args, { cwd, limitMin, stdin })  -> { code, out, err, timedOut }
  // For a tool that takes one block of text: asOneText(system, memory, prompt)
  return { ok: true, text: 'the answer' };      // or { ok: false, why: 'a plain sentence saying what went wrong' }
},
```

Rules for a new adapter: never throw (return `{ ok: false, why }`); `why` is shown to the person in WhatsApp, so write it as a sentence they can act on; never log keys; use the provider's official SDK or documented HTTP API; test with step 6.

## Files

`agent.mjs` (the helper) · `models.mjs` (brains) · `lib/chatlog.mjs` (writes `state/chat.jsonl`, see ../CHAT-LOG.md) · `lib/transcribe.mjs` (voice notes, via a local Whisper if installed) · `live-wait.mjs` / `live-reply.mjs` (live mode) · `config.json` (settings) · `INSTRUCTIONS.md` (the brief) · `set-key.sh` / `install-mac.sh` (Mac only) · folders made at run time: `state/`, `logs/`, `inbox/`, `media/`, `live/`, `workspace/`.
