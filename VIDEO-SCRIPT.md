# VIDEO SCRIPT: How to set up your own AI in WhatsApp

Length: about 6 to 7 minutes. Plain, spoken English. Say it your own way; the lines in quotes are a guide.
Everything below matches what was actually built. Things not tested on the real service are marked **[check before filming]**.

---

## Scene 1. Hook (0:00 to 0:20)

**On screen:** Your phone, full screen. You type "what's on my plate today?" in WhatsApp. A reply appears, written by your computer. Cut to the computer: the Claude Code session, with the same message sitting in it.

**Say:** "This is WhatsApp. This is my Claude Code session on my computer. I just texted it from my phone, and it answered. No app, no website, nothing open to the internet. And you can set this up in about ten minutes. I'll show you the whole thing."

## Scene 2. The 60-second version (0:20 to 1:20)

**On screen:** Four big captions, one at a time, with quick shots of each.

1. "Add the plugin" (the two commands, typed)
2. "Make the WhatsApp agent on your phone"
3. "Paste the key in YOUR terminal"
4. "Say hello"

**Say:** "Here's the whole thing in a minute. One: in Claude Code you add the plugin. Two lines. Two: on your phone, you create a WhatsApp agent. Only you can do that part. Three: you paste the key into your own terminal, not into the chat with the AI. That's important and I'll explain why. Four: Claude starts a small program that watches for your messages. You text 'hello', and it answers. That's it. Now let me do it slowly."

## Scene 3. How it works, in one picture (1:20 to 2:00)

**On screen:** A simple drawing: phone, WhatsApp, a small program on your computer, Claude Code. An arrow that goes OUT from the computer, not in. Label: "your computer asks WhatsApp: anything new?"

**Say:** "Here's the idea. Your computer does not open a door to the internet. A small program, called the poller, keeps asking WhatsApp, 'any new messages?' When there's one, it prints a line. Claude Code has a tool called Monitor that watches a program's output. Every line wakes Claude up. Claude reads it, does the work, and answers with one command. The reply goes back to your phone. Only the person who made the agent, you, can message it. Nobody else can."

## Scene 4. Add the plugin (2:00 to 2:40)

**On screen:** Claude Code terminal. Type the two commands slowly, so people can read them:

```
/plugin marketplace add menachem-kurkus/whatsapp-bridge
/plugin install whatsapp-bridge@whatsapp-bridge
```

Then type: "Set up the WhatsApp bridge."

**Say:** "First, add the plugin. This is the whole project, packaged so Claude Code can install it like an app. Then I just tell Claude, 'set up the WhatsApp bridge.' It has a setup skill inside, so it knows every step. It will check you have Node, and then it'll ask you to do the one thing it can't do for you."

**[check before filming]** The exact install commands from a real GitHub repo (this has only been checked on this computer).

## Scene 5. Make the agent on your phone (2:40 to 3:30)

**On screen:** Screen recording of your phone: WhatsApp settings, creating the agent, opening its chat info where the key is. Blur or cover the key every time.

**Say:** "On your phone, in WhatsApp, you create an agent. Only you can do this, so Claude will pause and ask you. Menus can look a bit different, so follow what WhatsApp shows you. When it's created, open the chat info and you'll find a key. Think of the key like a password. Whoever has it can talk as your agent. Don't screenshot it, don't send it to anyone, and don't paste it into an AI chat."

**[check before filming]** Exact menu names on your phone today.

## Scene 6. The key, the right way (3:30 to 4:20)

**On screen:** A second terminal window, clearly separate from Claude. Run:

```
cd bridge
node set-key.mjs
```

Paste the key. Nothing shows on screen. Then the message: "Saved to ... only your user can read it."

**Say:** "Here's the part most people get wrong. Open a separate terminal, not the Claude chat. Run set-key, and paste the key. You'll see nothing as you paste. That's on purpose. The key goes straight into a private file in your home folder. The AI never sees it. It's never in your project folder, so it can't end up on GitHub by accident. If you ever paste a key into a chat, make a new one."

## Scene 7. Start it and say hello (4:20 to 5:10)

**On screen:** Back in Claude Code. Claude starts the poller under Monitor (the command is `node bridge/poller.mjs`). On the phone, send "hello". The line appears in Claude. Claude replies. The reply shows on the phone.

**Say:** "Now Claude starts the poller under Monitor. I send 'hello' from my phone... there it is. And Claude answers... and there's the reply on my phone. That's the whole loop."

## Scene 8. What it can do (5:10 to 5:50)

**On screen:** Quick montage: send a photo from the phone and Claude describes it; ask Claude for a PDF and it arrives in WhatsApp; the `chat.jsonl` file open in an editor, one line per message.

**Say:** "Send it a photo, a PDF, even a video, and Claude can open them. Ask it for a file, and it sends it back. Everything, both directions, is saved as plain lines in one file. You can search it, back it up, show it to another AI. Voice notes work too, if you turn on the optional local transcription."

**[check before filming]** Voice notes and video frames were not tested on the real service. Only show them if you tried them.

## Scene 9. The pitfalls (5:50 to 6:30)

**On screen:** A list, one line at a time.

- The agent only talks to you. It can't text other people or join groups.
- It answers only while Claude Code is open and the poller is running. If your computer is off, messages wait at WhatsApp for about 30 days.
- The Monitor doesn't last forever. After a restart, Claude starts it again.
- Run only one poller. A second one gets an error.
- Never paste the key into the chat. Never commit `bridge/config.json` or the `state` folder. They're already ignored by git.
- Limits: about 12 messages a minute, 4096 characters each.

**Say:** "A few things to know. The agent only talks to you. It only answers while Claude Code is open with the program running, and after a restart you start it again. Run one at a time. And keep your key and your chat history private. The project already keeps them out of git for you."

## Scene 10. Call to action (6:30 to 6:50)

**On screen:** Big text: "Comment: kit". The GitHub link appears once, then a shot of the repo.

**Say:** "Want the whole thing? It's free and open source. Comment the word 'kit' under this video, and my bot will send you the GitHub link in a direct message. Set it up, and tell me what you built."

---

## Notes for filming

- Film the key steps with the real key off screen. Use a throwaway agent and delete it afterwards.
- Proposed comment keyword: `kit` (set the real one in the keyword bot).
- Before filming, run `node test/run-test.mjs` once on camera: it prints PASS for each check without needing WhatsApp. It's a nice moment to show it works.
- Don't claim it works on Mac or Linux unless you've tried it. It has only been run on Windows.
