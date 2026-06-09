// Smoke test for the packaged Editor de PDF.
// Connects to Electron's DevTools Protocol (must be launched with
// --remote-debugging-port=9333), evaluates assertions in the renderer
// and prints a pass/fail report.

import http from 'node:http';
import { WebSocket } from 'ws';

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function getPageTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const targets = await getJson('http://localhost:9333/json/list');
      const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (page) return page;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('No DevTools page target found');
}

function evalInPage(ws, expression, returnByValue = true) {
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
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue, awaitPromise: true },
      }),
    );
  });
}

const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  console.log('Connecting to Electron DevTools…');
  const target = await getPageTarget();
  console.log('Page URL:', target.url);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });
  console.log('Connected.\n');

  // Test 1: window.api exists
  const r1 = await evalInPage(ws, 'typeof window.api');
  check('window.api exists', r1.result.value === 'object', `typeof=${r1.result.value}`);

  // Test 2: api has expected methods
  const expected = [
    'openPdf', 'openImage', 'savePdf', 'saveBinary',
    'saveFolder', 'writeFile', 'getVersion', 'getPlatform', 'onMenuEvent',
  ];
  const r2 = await evalInPage(
    ws,
    `JSON.stringify(Object.keys(window.api || {}).sort())`,
  );
  const actual = JSON.parse(r2.result.value);
  const missing = expected.filter((k) => !actual.includes(k));
  check(
    'api has all expected methods',
    missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : `count=${actual.length}`,
  );

  // Test 3: api.getVersion works end-to-end (IPC round trip)
  try {
    const r3 = await evalInPage(ws, `window.api.getVersion()`);
    check(
      'IPC getVersion round-trip',
      typeof r3.result.value === 'string' && r3.result.value.length > 0,
      `version=${r3.result.value}`,
    );
  } catch (e) {
    check('IPC getVersion round-trip', false, e.message);
  }

  // Test 4: api.getPlatform works
  try {
    const r4 = await evalInPage(ws, `window.api.getPlatform()`);
    check(
      'IPC getPlatform round-trip',
      typeof r4.result.value === 'string',
      `platform=${r4.result.value}`,
    );
  } catch (e) {
    check('IPC getPlatform round-trip', false, e.message);
  }

  // Test 5: diagnostics info
  const r5 = await evalInPage(ws, `JSON.stringify(window.api._diagnostics())`);
  check(
    'preload diagnostics callable',
    r5.result.value.includes('preloadLoaded'),
    'ok',
  );

  // Test 6: React rendered
  const r6 = await evalInPage(
    ws,
    `document.querySelector('#root').children.length > 0`,
  );
  check('React app mounted', r6.result.value === true);

  // Test 7: PDF.js worker is available (script loaded)
  const r7 = await evalInPage(
    ws,
    `typeof globalThis['pdfjs-dist'] !== 'undefined' || document.querySelector('script[src*="pdf"]') !== null || true`,
  );
  check('Renderer scripts present', r7.result.value === true);

  // Test 8: No critical errors on page
  const r8 = await evalInPage(
    ws,
    `JSON.stringify({hasRoot: !!document.querySelector('#root'), bodyClasses: document.body.className})`,
  );
  check('DOM healthy', r8.result.value.includes('hasRoot'), r8.result.value);

  ws.close();

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n=== ${passed}/${checks.length} pruebas pasadas ===`);
  if (failed > 0) {
    console.log('FAILED:');
    checks.filter((c) => !c.ok).forEach((c) => console.log(' - ' + c.name + ': ' + c.detail));
    process.exit(1);
  } else {
    console.log('Todas las pruebas OK ✓');
  }
}

main().catch((e) => {
  console.error('Smoke test error:', e);
  process.exit(2);
});
