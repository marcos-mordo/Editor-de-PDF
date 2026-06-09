import { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import toast from 'react-hot-toast';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { stripPdfExt } from '../../lib/utils';

type SplitMode = 'every' | 'ranges' | 'extract';

function SplitView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const [mode, setMode] = useState<SplitMode>('every');
  const [chunkSize, setChunkSize] = useState(1);
  const [ranges, setRanges] = useState('1-3, 4-6');
  const [extract, setExtract] = useState('1, 3, 5');
  const [busy, setBusy] = useState(false);

  if (!doc) {
    return (
      <div className="text-sm text-ink-secondary">
        Abre un PDF primero para poder dividirlo.
      </div>
    );
  }

  const totalPages = doc.pagesOrder.length;
  const base = stripPdfExt(doc.name);

  function parseRanges(input: string): number[][] {
    return input
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
        if (m) {
          const a = Math.max(1, Math.min(totalPages, Number(m[1])));
          const b = Math.max(1, Math.min(totalPages, Number(m[2])));
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const arr: number[] = [];
          for (let i = lo; i <= hi; i++) arr.push(i);
          return arr;
        }
        const n = Math.max(1, Math.min(totalPages, Number(part)));
        return Number.isFinite(n) ? [n] : [];
      })
      .filter((g) => g.length > 0);
  }

  async function doSplit() {
    if (!doc) return;
    setBusy(true);
    try {
      const folder = await window.api.saveFolder(`${base}_dividido`);
      if (!folder) {
        setBusy(false);
        return;
      }
      const source = await PDFDocument.load(doc.workingBytes.slice(0), {
        ignoreEncryption: true,
      });
      let groups: number[][] = [];
      if (mode === 'every') {
        const size = Math.max(1, chunkSize);
        for (let i = 1; i <= totalPages; i += size) {
          const grp: number[] = [];
          for (let j = i; j <= Math.min(totalPages, i + size - 1); j++) grp.push(j);
          groups.push(grp);
        }
      } else if (mode === 'ranges') {
        groups = parseRanges(ranges);
      } else {
        // extract → each listed page becomes its own file
        const pages = parseRanges(extract).flat();
        groups = pages.map((p) => [p]);
      }

      if (groups.length === 0) {
        toast.error('Configuración inválida');
        setBusy(false);
        return;
      }

      let count = 0;
      const sep = folder.includes('\\') ? '\\' : '/';
      for (let g = 0; g < groups.length; g++) {
        const out = await PDFDocument.create();
        const origIndices = groups[g].map((p) => p - 1);
        // Map display page numbers (1-based) to original page indices.
        // Here we treat as direct page numbers in source order.
        const copied = await out.copyPages(source, origIndices);
        for (const p of copied) out.addPage(p);
        const bytes = await out.save();
        const ab = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        const filename = `${base}_parte_${String(g + 1).padStart(2, '0')}.pdf`;
        await window.api.writeFile(`${folder}${sep}${filename}`, ab);
        count++;
      }
      toast.success(`${count} archivos guardados`);
      api.close();
    } catch (e: any) {
      console.error(e);
      toast.error('Error al dividir: ' + (e?.message ?? 'desconocido'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-secondary">
        Documento actual: <strong>{doc.name}</strong> · {totalPages} páginas.
      </p>

      <div className="space-y-2">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            checked={mode === 'every'}
            onChange={() => setMode('every')}
            className="mt-1"
          />
          <div className="flex-1">
            <div className="text-sm text-ink">Cada N páginas</div>
            <div className="text-xs text-ink-secondary">
              Divide el documento en archivos de tamaño fijo.
            </div>
            {mode === 'every' && (
              <input
                type="number"
                min={1}
                max={totalPages}
                value={chunkSize}
                onChange={(e) => setChunkSize(Math.max(1, Number(e.target.value)))}
                className="input mt-2 w-32"
              />
            )}
          </div>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            checked={mode === 'ranges'}
            onChange={() => setMode('ranges')}
            className="mt-1"
          />
          <div className="flex-1">
            <div className="text-sm text-ink">Rangos personalizados</div>
            <div className="text-xs text-ink-secondary">
              Ej: <code>1-3, 4-6, 7</code>
            </div>
            {mode === 'ranges' && (
              <input
                type="text"
                value={ranges}
                onChange={(e) => setRanges(e.target.value)}
                className="input mt-2"
                placeholder="1-3, 4-6"
              />
            )}
          </div>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            checked={mode === 'extract'}
            onChange={() => setMode('extract')}
            className="mt-1"
          />
          <div className="flex-1">
            <div className="text-sm text-ink">Extraer páginas sueltas</div>
            <div className="text-xs text-ink-secondary">
              Una página por archivo. Ej: <code>1, 3, 5</code>
            </div>
            {mode === 'extract' && (
              <input
                type="text"
                value={extract}
                onChange={(e) => setExtract(e.target.value)}
                className="input mt-2"
                placeholder="1, 3, 5"
              />
            )}
          </div>
        </label>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-ghost" onClick={api.close} disabled={busy}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={doSplit} disabled={busy}>
          {busy ? 'Dividiendo…' : 'Dividir y guardar'}
        </button>
      </div>
    </div>
  );
}

export function showSplitDialog() {
  openModal('Dividir PDF', (api) => <SplitView api={api} />);
}
