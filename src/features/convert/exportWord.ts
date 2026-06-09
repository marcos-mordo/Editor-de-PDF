import { Document, Paragraph, TextRun, Packer, PageBreak } from 'docx';
import toast from 'react-hot-toast';
import { useDocument } from '../../stores/document';
import { stripPdfExt } from '../../lib/utils';

export async function exportToWord(): Promise<void> {
  const doc = useDocument.getState().doc;
  if (!doc) {
    toast.error('Abre un PDF primero');
    return;
  }
  const tt = toast.loading('Extrayendo texto…');
  try {
    const children: Paragraph[] = [];
    for (let i = 0; i < doc.pagesOrder.length; i++) {
      const origPage = doc.pagesOrder[i];
      const page = await doc.proxy.getPage(origPage);
      const tc = await page.getTextContent();
      // Group items by approximate y position to form lines
      type Item = { str: string; y: number; x: number; height: number };
      const items: Item[] = (tc.items as any[])
        .filter((it: any) => typeof it.str === 'string')
        .map((it: any) => ({
          str: it.str,
          y: it.transform[5],
          x: it.transform[4],
          height: it.height,
        }));
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines: Item[][] = [];
      const threshold = 4;
      for (const it of items) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(last[0].y - it.y) <= threshold) {
          last.push(it);
        } else {
          lines.push([it]);
        }
      }
      for (const line of lines) {
        const text = line
          .sort((a, b) => a.x - b.x)
          .map((it) => it.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (text) {
          children.push(new Paragraph({ children: [new TextRun(text)] }));
        }
      }
      if (i < doc.pagesOrder.length - 1) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
    }
    if (children.length === 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun(
              'No se encontró texto extraíble. Si el PDF es un escaneo, ejecuta OCR primero.',
            ),
          ],
        }),
      );
    }
    const docx = new Document({ sections: [{ properties: {}, children }] });
    const blob = await Packer.toBlob(docx);
    const ab = await blob.arrayBuffer();
    const name = `${stripPdfExt(doc.name)}.docx`;
    const saved = await window.api.saveBinary(name, ab, [
      { name: 'Word', extensions: ['docx'] },
    ]);
    toast.dismiss(tt);
    if (saved) toast.success('Exportado a Word');
  } catch (e: any) {
    toast.dismiss(tt);
    console.error(e);
    toast.error('Error al exportar a Word');
  }
}
