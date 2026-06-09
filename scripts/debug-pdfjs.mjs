// Deep diagnostic of PDF.js state
import http from 'node:http';
import { WebSocket } from 'ws';

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
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
await send(ws, 'Network.enable');

const events = [];
ws.on('message', (buf) => {
  const msg = JSON.parse(buf.toString());
  if (msg.method === 'Runtime.consoleAPICalled') {
    const args = msg.params.args.map(a => a.value !== undefined ? JSON.stringify(a.value) : a.description || 'obj');
    events.push(`[${msg.params.type}] ${args.join(' ')}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const ed = msg.params.exceptionDetails;
    events.push(`[EX] ${ed.text} ${ed.exception?.description ?? ''}`);
  }
  if (msg.method === 'Log.entryAdded') {
    events.push(`[${msg.params.entry.level}|${msg.params.entry.source}] ${msg.params.entry.text} (${msg.params.entry.url ?? ''})`);
  }
  if (msg.method === 'Network.requestWillBeSent') {
    if (msg.params.request.url.includes('worker') || msg.params.request.url.includes('pdf')) {
      events.push(`[NET-REQ] ${msg.params.request.url}`);
    }
  }
  if (msg.method === 'Network.responseReceived') {
    if (msg.params.response.url.includes('worker') || msg.params.response.url.includes('pdf')) {
      events.push(`[NET-RES] ${msg.params.response.status} ${msg.params.response.url}`);
    }
  }
  if (msg.method === 'Network.loadingFailed') {
    events.push(`[NET-FAIL] ${msg.params.errorText} - request ${msg.params.requestId}`);
  }
});

const r = await send(ws, 'Runtime.evaluate', {
  expression: `JSON.stringify({
    pdfjsExists: typeof window.__app.pdfjs,
    workerSrc: window.__app.pdfjs.GlobalWorkerOptions.workerSrc,
    workerSrcType: typeof window.__app.pdfjs.GlobalWorkerOptions.workerSrc,
    canRender: typeof window.__app.pdfjs.getDocument,
    pdfjsVersion: window.__app.pdfjs.version,
    GlobalWorkerOptions: {
      workerPort: window.__app.pdfjs.GlobalWorkerOptions.workerPort,
    },
  })`,
  returnByValue: true,
});
console.log('PDF.js state:', r.result.value);

// Try loading a small PDF and watch for errors
console.log('\nIntentando render directo de un PDF mínimo...');
const tryLoad = await send(ws, 'Runtime.evaluate', {
  expression: `(async () => {
    try {
      // Create minimal PDF using pdf-lib loaded in app, OR just use existing doc
      const docState = window.__app.stores.document.getState();
      if (!docState.doc) return { skip: 'no doc loaded' };
      const page = await docState.doc.proxy.getPage(1);
      console.log('Got page:', page);
      const viewport = page.getViewport({ scale: 1.0 });
      console.log('Viewport:', JSON.stringify({ w: viewport.width, h: viewport.height }));
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      const task = page.render({ canvasContext: ctx, viewport, canvas });
      console.log('Task created');
      await task.promise;
      console.log('Task completed');
      // Sample pixel
      const px = ctx.getImageData(canvas.width * 0.45, canvas.height * 0.3, 1, 1).data;
      return { ok: true, sample: [px[0], px[1], px[2]] };
    } catch (e) {
      return { ok: false, error: e.message, stack: e.stack };
    }
  })()`,
  returnByValue: true,
  awaitPromise: true,
});
console.log('Direct render result:', tryLoad.result.value);

await new Promise(r => setTimeout(r, 1000));
console.log('\nEvents:');
events.forEach(e => console.log('  ' + e));
ws.close();
