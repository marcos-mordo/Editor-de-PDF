// End-to-end test: generate a real PDF, inject into the running app,
// verify it renders. Captures console messages and screenshots.

import http from 'node:http';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PORT = 9333;

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

async function generateTestPdf() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([595, 842]);
    page.drawRectangle({
      x: 0, y: 0, width: 595, height: 842,
      color: rgb(1, 1, 1),
    });
    page.drawText(`PAGINA ${i + 1}`, {
      x: 200, y: 700, size: 48, font: helv, color: rgb(0.1, 0.1, 0.1),
    });
    page.drawText('Este es un PDF de prueba.', {
      x: 100, y: 600, size: 24, font: helv, color: rgb(0.3, 0.3, 0.3),
    });
    page.drawRectangle({
      x: 100, y: 200, width: 400, height: 300,
      borderColor: rgb(1, 0.6, 0), borderWidth: 4,
    });
  }
  return doc.save();
}

async function main() {
  console.log('1) Generando PDF de prueba...');
  const pdfBytes = await generateTestPdf();
  console.log(`   PDF size: ${pdfBytes.byteLength} bytes`);

  console.log('2) Conectando a DevTools...');
  let targets;
  for (let i = 0; i < 30; i++) {
    try {
      targets = await getJson(`http://localhost:${PORT}/json/list`);
      if (targets.some((t) => t.type === 'page')) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const target = targets.find((t) => t.type === 'page');
  if (!target) throw new Error('No page target found');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });
  console.log('   Connected.');

  // Enable console events
  await send(ws, 'Runtime.enable');
  await send(ws, 'Log.enable');
  await send(ws, 'Page.enable');

  const consoleMessages = [];
  ws.on('message', (buf) => {
    const msg = JSON.parse(buf.toString());
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = msg.params.args.map((a) => a.value || a.description || JSON.stringify(a));
      consoleMessages.push(`[${msg.params.type}] ${args.join(' ')}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const ex = msg.params.exceptionDetails;
      consoleMessages.push(`[EXCEPTION] ${ex.text} ${ex.exception ? ex.exception.description : ''}`);
    }
    if (msg.method === 'Log.entryAdded') {
      consoleMessages.push(`[${msg.params.entry.level}] ${msg.params.entry.text} (${msg.params.entry.source})`);
    }
  });

  console.log('3) Verificando __app debug interface...');
  const r0 = await send(ws, 'Runtime.evaluate', {
    expression: `typeof window.__app`,
    returnByValue: true,
  });
  console.log(`   __app =`, r0.result.value);
  if (r0.result.value !== 'object') {
    console.error('   FAIL: __app no expuesto. Reconstruir es necesario.');
    process.exit(1);
  }

  console.log('4) Cargando PDF en el store...');
  // Convert pdfBytes to base64 and pass to renderer
  const base64 = Buffer.from(pdfBytes).toString('base64');
  const expr = `(async () => {
    const bin = atob(${JSON.stringify(base64)});
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    try {
      await window.__app.stores.document.getState().loadFromBytes(bytes.buffer, 'test.pdf');
      const s = window.__app.stores.document.getState();
      return { ok: true, hasDoc: !!s.doc, numPages: s.doc?.numPages, name: s.doc?.name };
    } catch (e) {
      return { ok: false, err: e.message, stack: e.stack };
    }
  })()`;
  const r1 = await send(ws, 'Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log('   loadFromBytes result:', JSON.stringify(r1.result.value));
  if (!r1.result.value.ok) {
    console.error('   FAIL: loadFromBytes failed');
    console.error('   Console messages so far:');
    consoleMessages.forEach((m) => console.error('     ' + m));
    process.exit(1);
  }

  console.log('5) Esperando 5s para que se rendericen las páginas...');
  await new Promise((r) => setTimeout(r, 5000));

  console.log('6) Inspeccionando estado del DOM...');
  const r2 = await send(ws, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      canvases: Array.from(document.querySelectorAll('canvas.pdf-page-canvas')).map(c => ({
        width: c.width,
        height: c.height,
        styleWidth: c.style.width,
        styleHeight: c.style.height,
        offsetWidth: c.offsetWidth,
        offsetHeight: c.offsetHeight,
        ctxData: (() => {
          const ctx = c.getContext('2d');
          if (!ctx || c.width === 0) return 'no-ctx-or-zero';
          const px = ctx.getImageData(c.width/2, c.height/2, 1, 1).data;
          return Array.from(px).join(',');
        })(),
      })),
      pageViewers: document.querySelectorAll('[data-page-number]').length,
      viewerContainer: !!document.querySelector('.h-full.overflow-auto'),
      docState: (() => {
        const s = window.__app.stores.document.getState();
        return {
          hasDoc: !!s.doc,
          numPages: s.doc?.numPages,
          pagesOrder: s.doc?.pagesOrder,
          currentPage: s.currentPage,
          zoom: s.zoom,
        };
      })(),
    })`,
    returnByValue: true,
  });
  console.log('   Estado:', r2.result.value);

  console.log('7) Capturando screenshot...');
  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.resolve('S:/Proyectos/Editor de PDF/diagnostic-screenshot.png'),
    Buffer.from(shot.data, 'base64'));
  console.log('   Saved.');

  console.log('\n--- CONSOLE MESSAGES ---');
  consoleMessages.forEach((m) => console.log('  ' + m));
  console.log(`\nTotal: ${consoleMessages.length} messages`);

  ws.close();
}

main().catch((e) => {
  console.error('Test failed:', e);
  process.exit(2);
});
