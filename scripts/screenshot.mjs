import http from 'node:http';
import { WebSocket } from 'ws';
import fs from 'node:fs';

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e6);
    function onMessage(buf) {
      const msg = JSON.parse(buf.toString());
      if (msg.id !== id) return;
      ws.off('message', onMessage);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
    ws.on('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const targets = await getJson('http://localhost:9333/json/list');
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res) => ws.once('open', res));

await send(ws, 'Page.enable');
const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(process.argv[2] || '/tmp/app-screenshot.png', Buffer.from(data, 'base64'));
console.log('saved to', process.argv[2] || '/tmp/app-screenshot.png');
ws.close();
