// A fake WhatsApp agent service for testing the bridge on your own computer.
//   node test/mock-whatsapp.mjs <port>
// Serves a few canned incoming messages once, then idles. Records what the bridge sends.
import http from 'node:http';

const port = Number(process.argv[2] || 8799);
const now = Math.floor(Date.now() / 1000) + 60; // slightly in the future so "skip old backlog" never hides them
const wamid = (n) => `wamid.TEST${n}`;
let delivered = false;
let sendCount = 0;
const media = { 'media-img': Buffer.from('fakepng'), 'media-doc': Buffer.from('%PDF-fake') };

const incoming = [
  { id: wamid(1), from: 'user:1000', timestamp: String(now), type: 'text', text: { body: 'hello from the test phone' } },
  { id: wamid(2), from: 'user:1000', timestamp: String(now), type: 'document', document: { id: 'media-doc', filename: 'notes.pdf', caption: 'see this' } },
  { id: wamid(3), from: 'user:1000', timestamp: String(now), type: 'image', image: { id: 'media-img' } },
  { id: wamid(4), from: 'user:1000', timestamp: String(now), type: 'text', text: { body: 'replying to you' }, context: { id: 'wamid.SENT1' } },
];

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const p = url.pathname.replace('/agent/v1', '');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== 'Bearer test-key-0123456789abcdef') return json(401, { error: { code: 190 } });
    if (p === '/updates') {
      if (!delivered) { delivered = true; return json(200, { entry: [{ changes: [{ value: { messages: incoming } }] }], next_offset: 5 }); }
      setTimeout(() => { res.writeHead(204); res.end(); }, 1500);
      return;
    }
    if (p === '/statuses') return json(200, { success: true });
    if (p === '/messages') { sendCount += 1; return json(200, { messages: [{ id: `wamid.SENT${sendCount}` }] }); }
    if (p === '/media' && req.method === 'POST') return json(200, { id: 'uploaded-1' });
    const m = p.match(/^\/media\/(.+)$/);
    if (m && req.method === 'GET') return json(200, { url: `http://localhost:${port}/file/${m[1]}`, mime_type: m[1] === 'media-doc' ? 'application/pdf' : 'image/png' });
    const f = url.pathname.match(/^\/file\/(.+)$/);
    if (f && media[f[1]]) { res.writeHead(200); return res.end(media[f[1]]); }
    json(404, {});
  });
}).listen(port, () => console.log(`mock WhatsApp on ${port}`));
