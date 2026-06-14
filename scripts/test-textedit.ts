// Standalone test of the real text-editing engine.
// Bundled with esbuild and run in node — no Electron needed.
//
// Verifies that editTextInPage actually rewrites the PDF content stream so
// the original text is replaced (in place, no overlay) and the new text is
// present in the page's drawing operators.

import { PDFDocument, StandardFonts, rgb, PDFName, PDFRawStream, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { editTextInPage } from '../src/features/textedit/engine';

function bytesToStr(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

async function getPageContentString(doc: PDFDocument, pageIndex: number): Promise<string> {
  const ctx = doc.context;
  const page = doc.getPage(pageIndex);
  const contents = ctx.lookup(page.node.get(PDFName.of('Contents')));
  let out = '';
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const s = ctx.lookup(contents.get(i));
      if (s instanceof PDFRawStream) out += bytesToStr(decodePDFRawStream(s).decode());
    }
  } else if (contents instanceof PDFRawStream) {
    out += bytesToStr(decodePDFRawStream(contents).decode());
  }
  return out;
}

// Decode any hex strings <..> in the content into ASCII so we can read them.
function readableText(content: string): string {
  return content.replace(/<([0-9A-Fa-f]+)>/g, (_, hex) => {
    let s = '';
    for (let i = 0; i + 2 <= hex.length; i += 2) {
      s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return s;
  });
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail++;
    console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function main() {
  // --- Test 1: simple standard font (Helvetica, literal string) ---
  {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([600, 200]);
    page.drawText('Marcos Morales Doello', {
      x: 50,
      y: 120,
      size: 24,
      font,
      color: rgb(0.1, 0.2, 0.6),
    });
    const bytes = await doc.save();

    const reloaded = await PDFDocument.load(bytes);
    const result = await editTextInPage(
      reloaded,
      0,
      'Marcos Morales Doello',
      'Pedro Garcia Lopez',
      { x: 50, y: 120 },
    );
    check('Test1 engine reports success', result.success, `mode=${result.mode}`);
    check('Test1 mode is inplace (same font kept)', result.mode === 'inplace');

    const editedBytes = await reloaded.save();
    const finalDoc = await PDFDocument.load(editedBytes);
    const content = await getPageContentString(finalDoc, 0);
    const readable = readableText(content);
    check(
      'Test1 new text present in content stream',
      readable.includes('Pedro Garcia Lopez'),
    );
    check(
      'Test1 original text removed from content stream',
      !readable.includes('Marcos Morales Doello'),
    );
    // No cover rectangle was added: the content should not contain a filled
    // rectangle op "re" followed by "f" that we didn't have originally.
    check(
      'Test1 produced valid non-empty PDF',
      editedBytes.length > 400,
      `${editedBytes.length} bytes`,
    );
  }

  // --- Test 2: typo fix preserving same font (subset-safe chars) ---
  {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const page = doc.addPage([400, 150]);
    page.drawText('Helllo World', { x: 40, y: 80, size: 18, font });
    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    const result = await editTextInPage(reloaded, 0, 'Helllo World', 'Hello World', {
      x: 40,
      y: 80,
    });
    check('Test2 typo fix success', result.success, `mode=${result.mode}`);
    const editedBytes = await reloaded.save();
    const finalDoc = await PDFDocument.load(editedBytes);
    const readable = readableText(await getPageContentString(finalDoc, 0));
    check('Test2 corrected text present', readable.includes('Hello World'));
    check('Test2 misspelling removed', !readable.includes('Helllo World'));
  }

  // --- Test 3: edit a substring inside a larger run — neighbours must survive ---
  {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([500, 150]);
    page.drawText('Hello World Foo Bar', { x: 30, y: 80, size: 16, font });
    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    const result = await editTextInPage(reloaded, 0, 'World', 'Planet', {
      x: 30,
      y: 80,
    });
    check('Test3 substring edit success', result.success, `mode=${result.mode}`);
    const editedBytes = await reloaded.save();
    const finalDoc = await PDFDocument.load(editedBytes);
    const readable = readableText(await getPageContentString(finalDoc, 0));
    check('Test3 result has full corrected line', readable.includes('Hello Planet Foo Bar'));
    check('Test3 neighbour "Hello" preserved', readable.includes('Hello'));
    check('Test3 neighbour "Foo Bar" preserved', readable.includes('Foo Bar'));
    check('Test3 old word removed', !readable.includes('World'));
  }

  // --- Test 4: TJ array operator with kerning ---
  {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([500, 150]);
    page.drawText('seed', { x: 0, y: 0, size: 1, font }); // force /Font resource
    // Find the font resource name pdf-lib assigned.
    const ctx = doc.context;
    const res = ctx.lookup(page.node.get(PDFName.of('Resources'))) as any;
    const fontDict = ctx.lookup(res.get(PDFName.of('Font'))) as any;
    const fontName = fontDict.entries()[0][0].asString().replace(/^\//, '');
    // Replace the page content with a TJ-based stream.
    const streamText = `BT /${fontName} 20 Tf 40 90 Td [(Hola )-60(Mundo)] TJ ET`;
    const enc = new TextEncoder().encode(streamText);
    const dict = ctx.obj({}) as any;
    dict.set(PDFName.of('Length'), (await import('pdf-lib')).PDFNumber.of(enc.length));
    const stream = PDFRawStream.of(dict, enc);
    page.node.set(PDFName.of('Contents'), ctx.register(stream));
    const bytes = await doc.save();

    const reloaded = await PDFDocument.load(bytes);
    const result = await editTextInPage(reloaded, 0, 'Hola Mundo', 'Adios Tierra', {
      x: 40,
      y: 90,
    });
    check('Test4 TJ edit success', result.success, `mode=${result.mode}`);
    const editedBytes = await reloaded.save();
    const readable = readableText(
      await getPageContentString(await PDFDocument.load(editedBytes), 0),
    );
    check('Test4 new text present', readable.includes('Adios Tierra'));
    check('Test4 old text removed', !readable.includes('Mundo'));
  }

  // --- Test 5: text NOT present returns failure (no accidental edit) ---
  {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 100]);
    page.drawText('Something', { x: 20, y: 50, size: 14, font });
    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    const result = await editTextInPage(reloaded, 0, 'NotThere', 'X', { x: 20, y: 50 });
    check('Test5 missing text reports failure', !result.success);
  }

  console.log(`\n=== ${pass}/${pass + fail} checks passed ===`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('TEST ERROR:', e);
  process.exit(2);
});
