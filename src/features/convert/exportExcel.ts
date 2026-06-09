import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { useDocument } from '../../stores/document';
import { stripPdfExt } from '../../lib/utils';

interface Cell {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Heuristic table extraction from PDF text content:
 * - Group text fragments by line (y position)
 * - Detect column boundaries from x-position clustering
 * - Emit one sheet per page
 */
export async function exportToExcel(): Promise<void> {
  const doc = useDocument.getState().doc;
  if (!doc) {
    toast.error('Abre un PDF primero');
    return;
  }
  const tt = toast.loading('Detectando tablas…');
  try {
    const wb = XLSX.utils.book_new();
    for (let i = 0; i < doc.pagesOrder.length; i++) {
      const origPage = doc.pagesOrder[i];
      const page = await doc.proxy.getPage(origPage);
      const tc = await page.getTextContent();
      const cells: Cell[] = (tc.items as any[])
        .filter((it: any) => typeof it.str === 'string' && it.str.trim())
        .map((it: any) => ({
          text: it.str.trim(),
          x: it.transform[4],
          y: it.transform[5],
          width: it.width ?? 0,
          height: it.height ?? 0,
        }));

      // Group by row
      cells.sort((a, b) => b.y - a.y);
      const rows: Cell[][] = [];
      const rowTol = 4;
      for (const c of cells) {
        const lastRow = rows[rows.length - 1];
        if (lastRow && Math.abs(lastRow[0].y - c.y) <= rowTol) {
          lastRow.push(c);
        } else {
          rows.push([c]);
        }
      }

      // Detect columns from all x-starts
      const xStarts = cells.map((c) => c.x).sort((a, b) => a - b);
      const colBuckets: number[] = [];
      const colTol = 8;
      for (const x of xStarts) {
        if (colBuckets.length === 0 || x - colBuckets[colBuckets.length - 1] > colTol) {
          colBuckets.push(x);
        }
      }
      // Build matrix
      const matrix: string[][] = [];
      for (const row of rows) {
        const r: string[] = new Array(colBuckets.length).fill('');
        for (const c of row.sort((a, b) => a.x - b.x)) {
          let colIdx = 0;
          for (let k = 0; k < colBuckets.length; k++) {
            if (Math.abs(c.x - colBuckets[k]) <= colTol) {
              colIdx = k;
              break;
            }
            if (c.x > colBuckets[k]) colIdx = k;
          }
          r[colIdx] = r[colIdx] ? `${r[colIdx]} ${c.text}` : c.text;
        }
        matrix.push(r);
      }
      const ws = XLSX.utils.aoa_to_sheet(matrix.length ? matrix : [['(página vacía)']]);
      XLSX.utils.book_append_sheet(wb, ws, `Página ${i + 1}`.slice(0, 31));
    }
    const u8 = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
    const ab = u8.buffer.slice(
      u8.byteOffset,
      u8.byteOffset + u8.byteLength,
    ) as ArrayBuffer;
    const name = `${stripPdfExt(doc.name)}.xlsx`;
    const saved = await window.api.saveBinary(name, ab, [
      { name: 'Excel', extensions: ['xlsx'] },
    ]);
    toast.dismiss(tt);
    if (saved) toast.success('Exportado a Excel');
  } catch (e: any) {
    toast.dismiss(tt);
    console.error(e);
    toast.error('Error al exportar a Excel');
  }
}
