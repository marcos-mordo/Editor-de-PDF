import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { watermarkPdf, batesPdf } from './batch';

async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    doc.addPage([400, 300]).drawText(`P${i + 1}`, { x: 10, y: 280, size: 10, font });
  }
  return doc.save();
}

async function loadPdfjs() {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const require = createRequire(import.meta.url);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ).href;
  return pdfjs;
}

async function pageText(bytes: Uint8Array, pageNum: number): Promise<string> {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await pdf.getPage(pageNum);
  const tc = await page.getTextContent();
  const text = (tc.items as any[]).map((i) => i.str).join(' ');
  await pdf.destroy();
  return text;
}

describe('batch watermark', () => {
  it('keeps page count and renders the watermark text on every page', async () => {
    const src = await blankPdf(2);
    // Small font + no rotation so the full word stays inside the test page.
    const out = await watermarkPdf(src, {
      text: 'CONFIDENCIAL',
      tile: false,
      fontSize: 16,
      rotation: 0,
    });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(await pageText(out, 1)).toContain('CONFIDENCIAL');
    expect(await pageText(out, 2)).toContain('CONFIDENCIAL');
  }, 30000);
});

describe('batch Bates', () => {
  it('numbers pages and continues across files via startIndex', async () => {
    const a = await blankPdf(2);
    const b = await blankPdf(2);

    const r1 = await batesPdf(a, { prefix: 'DOC-', digits: 4, start: 1 }, 0);
    expect(r1.pages).toBe(2);
    expect(await pageText(r1.bytes, 1)).toContain('DOC-0001');
    expect(await pageText(r1.bytes, 2)).toContain('DOC-0002');

    // Next file continues from where the first ended.
    const r2 = await batesPdf(b, { prefix: 'DOC-', digits: 4, start: 1 }, r1.pages);
    expect(await pageText(r2.bytes, 1)).toContain('DOC-0003');
    expect(await pageText(r2.bytes, 2)).toContain('DOC-0004');
  }, 30000);
});
