import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { attachFilesToPdf, guessMimeType } from './attachments';

async function makeDoc(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 200]).drawText('Host document', { x: 20, y: 100, size: 14, font });
  return doc;
}

describe('guessMimeType', () => {
  it('maps common extensions', () => {
    expect(guessMimeType('a.pdf')).toBe('application/pdf');
    expect(guessMimeType('b.CSV')).toBe('text/csv');
    expect(guessMimeType('c.unknown')).toBe('application/octet-stream');
  });
});

describe('attachFilesToPdf', () => {
  it('embeds files retrievable by pdf.js getAttachments', async () => {
    const doc = await makeDoc();
    const payload = new TextEncoder().encode('hola,mundo\n1,2');
    const n = await attachFilesToPdf(doc, [
      { name: 'datos.csv', data: payload },
      { name: 'nota.txt', data: new TextEncoder().encode('texto adjunto') },
    ]);
    expect(n).toBe(2);

    const bytes = await doc.save();

    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createRequire } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    const require = createRequire(import.meta.url);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href;

    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const attachments = await pdf.getAttachments();
    const names = Object.keys(attachments);
    expect(names).toContain('datos.csv');
    expect(names).toContain('nota.txt');

    const csv = new TextDecoder().decode(attachments['datos.csv'].content);
    expect(csv).toBe('hola,mundo\n1,2');
    await pdf.destroy();
  }, 30000);
});
