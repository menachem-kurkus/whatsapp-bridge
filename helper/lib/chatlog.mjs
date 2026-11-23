// The helper's chat history. It uses the same writer as the live bridge (../../bridge/lib/chatlog.mjs),
// so both modes produce one and the same state/chat.jsonl format. See CHAT-LOG.md at the top of the repo.
// Writing here must never stop a message from being sent or handled, so every function catches its own errors.
import path from 'node:path';
import { openChatLog } from '../../bridge/lib/chatlog.mjs';

export function chatlog(dir, { owner = 'Owner', agent = 'Assistant' } = {}) {
  const short = agent.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'agent';
  const log = openChatLog({ dir: path.join(dir, 'state'), agent: short, owner, assistant: agent });
  const safe = (fn) => { try { return fn()?.id ?? null; } catch { return null; } };
  const idForExt = (ext) => { try { return log.findByExt(ext)?.id; } catch { return undefined; } };
  return {
    file: log.file,
    lines: log.readRows,
    incoming({ ext, kind, text, file: f, replyToExt }) {
      return safe(() => log.append({ source: 'wa', ext, from: owner, to: agent, kind, ...(kind === 'voice' ? { via: 'computer' } : {}), text, localFile: f, replyTo: idForExt(replyToExt) }));
    },
    outgoing({ ext, kind = 'text', text, file: f, replyToExt }) {
      return safe(() => log.append({ source: 'wa', ext, from: agent, to: owner, kind, text, localFile: f, replyTo: idForExt(replyToExt) }));
    },
    record(source, entry) { return safe(() => log.append({ source, ...entry })); },
  };
}
