// Verify that PDF content (text + shapes) is actually drawn on canvas,
// not just a white blank background.

import http from 'node:http';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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

console.log('Generando PDF con texto y formas...');
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.HelveticaBold);
const page = doc.addPage([595, 842]);
page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(1,1,1) });
page.drawText('HOLA', { x: 220, y: 600, size: 80, font, color: rgb(0,0,0) });
page.drawRectangle({ x: 50, y: 100, width: 495, height: 200, color: rgb(1, 0.6, 0) });
const pdfBytes = await doc.save();
const base64 = Buffer.from(pdfBytes).toString('base64');

console.log('Cargando PDF en el store...');
const r = await send(ws, 'Runtime.evaluate', {
  expression: `(async () => {
    const bin = atob(${JSON.stringify(base64)});
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await window.__app.stores.document.getState().loadFromBytes(bytes.buffer, 'verify.pdf');
    return 'loaded';
  })()`,
  returnByValue: true, awaitPromise: true,
});
console.log('   ' + r.result.value);

console.log('Esperando renderizado completo (8s)...');
await new Promise((r) => setTimeout(r, 8000));

console.log('Analizando pixeles del canvas...');
const sample = await send(ws, 'Runtime.evaluate', {
  expression: `(() => {
    const canvas = document.querySelector('canvas.pdf-page-canvas');
    if (!canvas) return { error: 'no canvas' };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { error: 'no ctx' };

    function px(x, y) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    }

    // Sample various points
    const w = canvas.width, h = canvas.height;
    return {
      w, h,
      // White background (top corner)
      topLeftCorner: px(10, 10),
      // Inside "HOLA" text (approx)
      insideHolaText: px(w * 0.45, h * 0.30),
      // Inside orange rectangle (clearly filled)
      insideOrangeRect: px(w * 0.5, h * 0.75),
      // White space (between text and rect)
      whiteSpace: px(w * 0.95, h * 0.5),
    };
  })()`,
  returnByValue: true,
});
console.log('   Muestras de pixeles:', JSON.stringify(sample.result.value, null, 2));

const s = sample.result.value;
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
}

// Top-left corner should be white (255,255,255)
check('Esquina superior izq = blanco',
  s.topLeftCorner[0] > 240 && s.topLeftCorner[1] > 240 && s.topLeftCorner[2] > 240,
  `rgb(${s.topLeftCorner.join(',')})`);

// Orange rect should be orange (R>200, G ~150, B<100)
check('Rectángulo naranja dibujado',
  s.insideOrangeRect[0] > 200 && s.insideOrangeRect[1] > 100 && s.insideOrangeRect[2] < 100,
  `rgb(${s.insideOrangeRect.join(',')})`);

// White space should be white
check('Espacio blanco = blanco',
  s.whiteSpace[0] > 240 && s.whiteSpace[1] > 240 && s.whiteSpace[2] > 240,
  `rgb(${s.whiteSpace.join(',')})`);

const passed = checks.filter(c => c.ok).length;
console.log(`\n=== ${passed}/${checks.length} pruebas de pixels pasadas ===`);

// Take screenshot for visual confirmation
console.log('Capturando screenshot...');
const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('S:/Proyectos/Editor de PDF/verified-render.png',
  Buffer.from(shot.data, 'base64'));
console.log('   Saved');

ws.close();
if (passed !== checks.length) process.exit(1);
