// Quick interactive check of the running app
import http from 'node:http';
import { WebSocket } from 'ws';

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
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
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });

await send(ws, 'Runtime.enable');
await send(ws, 'Log.enable');

const messages = [];
ws.on('message', (buf) => {
  const msg = JSON.parse(buf.toString());
  if (msg.method === 'Runtime.consoleAPICalled') {
    const args = msg.params.args.map(a => a.value || a.description || JSON.stringify(a));
    messages.push(`[${msg.params.type}] ${args.join(' ')}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    messages.push(`[EX] ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ''}`);
  }
  if (msg.method === 'Log.entryAdded') {
    messages.push(`[${msg.params.entry.level}|${msg.params.entry.source}] ${msg.params.entry.text}`);
  }
});

// Force a reload to see all messages from start
await send(ws, 'Page.enable');
await send(ws, 'Page.reload');

await new Promise((r) => setTimeout(r, 6000));

const status = await send(ws, 'Runtime.evaluate', {
  expression: `JSON.stringify({
    api: typeof window.api,
    __app: typeof window.__app,
    react: !!document.querySelector('#root').children.length,
    docHasState: window.__app ? !!window.__app.stores.document.getState : 'no app',
  })`,
  returnByValue: true,
});

console.log('STATUS:', status.result.value);
console.log('\n--- CONSOLE ---');
messages.forEach(m => console.log(m));

ws.close();
