import JSZip from 'jszip';
import toast from 'react-hot-toast';
import { useDocument } from '../../stores/document';
import { stripPdfExt } from '../../lib/utils';

export async function exportToImages(): Promise<void> {
  const doc = useDocument.getState().doc;
  if (!doc) {
    toast.error('Abre un PDF primero');
    return;
  }
  const tt = toast.loading('Generando imágenes…');
  try {
    const zip = new JSZip();
    const base = stripPdfExt(doc.name);
    for (let i = 0; i < doc.pagesOrder.length; i++) {
      const origPage = doc.pagesOrder[i];
      const page = await doc.proxy.getPage(origPage);
      const rotation = doc.pageRotations[origPage] ?? 0;
      const viewport = page.getViewport({ scale: 2.0, rotation });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png'),
      );
      const buf = await blob.arrayBuffer();
      zip.file(`${base}_${String(i + 1).padStart(3, '0')}.png`, buf);
    }
    const zipBlob = await zip.generateAsync({ type: 'arraybuffer' });
    const saved = await window.api.saveBinary(
      `${base}_imagenes.zip`,
      zipBlob,
      [{ name: 'ZIP', extensions: ['zip'] }],
    );
    toast.dismiss(tt);
    if (saved) toast.success(`${doc.pagesOrder.length} imágenes guardadas`);
  } catch (e: any) {
    toast.dismiss(tt);
    console.error(e);
    toast.error('Error al exportar imágenes');
  }
}
