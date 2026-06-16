import { describe, it, expect } from 'vitest';
import {
  PDFDocument,
  StandardFonts,
  PDFName,
  PDFArray,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import { removeTextInRects } from './redact';

function bytesToStr(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

async function pageContent(doc: PDFDocument): Promise<string> {
  const ctx = doc.context;
  const c = ctx.lookup(doc.getPage(0).node.get(PDFName.of('Contents')));
  let out = '';
  if (c instanceof PDFArray) {
    for (let i = 0; i < c.size(); i++) {
      const s = ctx.lookup(c.get(i));
      if (s instanceof PDFRawStream) out += bytesToStr(decodePDFRawStream(s).decode());
    }
  } else if (c instanceof PDFRawStream) {
    out += bytesToStr(decodePDFRawStream(c).decode());
  }
  return out;
}

function readable(content: string): string {
  return content.replace(/<([0-9A-Fa-f]+)>/g, (_, hex) => {
    let s = '';
    for (let i = 0; i + 2 <= hex.length; i += 2) {
      s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return s;
  });
}

describe('removeTextInRects (true redaction)', () => {
  it('removes text inside the rect and keeps text outside', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('SECRET', { x: 50, y: 250, size: 20, font }); // top — to redact
    page.drawText('KEEPME', { x: 50, y: 50, size: 20, font }); // bottom — keep
    const bytes = await doc.save();

    const reloaded = await PDFDocument.load(bytes);
    // Rectangle covering only the top text area (around y=250).
    const removed = removeTextInRects(reloaded, 0, [
      { x: 40, y: 240, width: 200, height: 40 },
    ]);
    expect(removed).toBeGreaterThan(0);

    const out = await reloaded.save();
    const content = readable(await pageContent(await PDFDocument.load(out)));
    expect(content).not.toContain('SECRET');
    expect(content).toContain('KEEPME');
  });

  it('returns 0 when nothing falls in the rect', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([400, 300]).drawText('Hello', { x: 50, y: 250, size: 20, font });
    const reloaded = await PDFDocument.load(await doc.save());
    const removed = removeTextInRects(reloaded, 0, [
      { x: 0, y: 0, width: 30, height: 30 },
    ]);
    expect(removed).toBe(0);
  });
});
