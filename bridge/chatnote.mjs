// Lets another program or Claude session write a line into the shared history.
//   node chatnote.mjs <from> <to> "text" [--kind note]
// The line gets an id that starts with "sess-" so it is clear it was not a WhatsApp message.
import { chat } from './lib.mjs';

const args = process.argv.slice(2);
const k = args.indexOf('--kind');
const kind = k >= 0 ? args.splice(k, 2)[1] : 'note';
const [from, to, ...rest] = args;
if (!from || !to || !rest.length) { console.log('usage: node chatnote.mjs <from> <to> "text" [--kind note]'); process.exit(1); }
console.log(chat.append({ source: 'sess', from, to, kind, text: rest.join(' ') }).id);
