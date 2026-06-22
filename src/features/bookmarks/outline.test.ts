import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts, PDFName, PDFDict } from 'pdf-lib';
import { applyOutline, nestByLevel } from './outline';

async function makeDoc(pages: number): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    doc.addPage([300, 200]).drawText(`Page ${i + 1}`, { x: 20, y: 100, size: 14, font });
  }
  return doc;
}

describe('nestByLevel', () => {
  it('keeps a flat list flat', () => {
    const tree = nestByLevel([
      { title: 'A', pageIndex: 0, level: 0 },
      { title: 'B', pageIndex: 1, level: 0 },
    ]);
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toBeUndefined();
  });

  it('nests children under the preceding parent', () => {
    const tree = nestByLevel([
      { title: 'Chapter 1', pageIndex: 0, level: 0 },
      { title: '1.1', pageIndex: 1, level: 1 },
      { title: '1.2', pageIndex: 2, level: 1 },
      { title: 'Chapter 2', pageIndex: 3, level: 0 },
    ]);
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children![1].title).toBe('1.2');
    expect(tree[1].children).toBeUndefined();
  });
});

describe('applyOutline', () => {
  it('writes /Outlines into the catalog and counts nodes', async () => {
    const doc = await makeDoc(3);
    const n = applyOutline(doc, [
      { title: 'Intro', pageIndex: 0 },
      { title: 'Body', pageIndex: 1, children: [{ title: 'Detail', pageIndex: 2 }] },
    ]);
    expect(n).toBe(3);
    const outlines = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    expect(outlines).toBeTruthy();
    // Root /Count is the number of visible descendants (all open) = 3.
    const count = outlines.lookup(PDFName.of('Count'));
    expect((count as any).asNumber()).toBe(3);
  });

  it('round-trips through pdf.js getOutline with correct titles and pages', async () => {
    const doc = await makeDoc(4);
    applyOutline(doc, [
      { title: 'Portada', pageIndex: 0 },
      {
        title: 'Capítulo 1',
        pageIndex: 1,
        children: [{ title: 'Sección 1.1', pageIndex: 2 }],
      },
      { title: 'Final', pageIndex: 3 },
    ]);
    const bytes = await doc.save();

    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createRequire } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    const require = createRequire(import.meta.url);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href;

    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const outline = await pdf.getOutline();
    expect(outline).toHaveLength(3);
    expect(outline[0].title).toBe('Portada');
    expect(outline[1].title).toBe('Capítulo 1');
    expect(outline[1].items).toHaveLength(1);
    expect(outline[1].items[0].title).toBe('Sección 1.1');

    // The nested bookmark resolves to page index 2 (0-based).
    const dest = outline[1].items[0].dest;
    const pageIndex = await pdf.getPageIndex(dest[0]);
    expect(pageIndex).toBe(2);
    await pdf.destroy();
  }, 30000);

  it('removing the outline leaves no /Outlines entry', async () => {
    const doc = await makeDoc(2);
    applyOutline(doc, [{ title: 'X', pageIndex: 0 }]);
    const removed = applyOutline(doc, []);
    expect(removed).toBe(0);
    expect(doc.catalog.lookup(PDFName.of('Outlines'))).toBeUndefined();
  });
});
