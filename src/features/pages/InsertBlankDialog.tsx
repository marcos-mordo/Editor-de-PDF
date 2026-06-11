import { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import toast from 'react-hot-toast';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';

type Where = 'before' | 'after' | 'end' | 'start';
type Size = 'a4' | 'letter' | 'legal' | 'a5' | 'match-current';

const SIZES: Record<Size, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
  a5: [419.53, 595.28],
  'match-current': [595, 842], // overridden at runtime
};

function InsertBlankView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const setWorkingBytes = useDocument((s) => s.setWorkingBytes);
  const [where, setWhere] = useState<Where>('after');
  const [size, setSize] = useState<Size>('match-current');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [busy, setBusy] = useState(false);

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  async function apply() {
    if (!doc) return;
    setBusy(true);
    try {
      const source = await PDFDocument.load(doc.workingBytes.slice(0), {
        ignoreEncryption: true,
      });
      let pageSize: [number, number];
      if (size === 'match-current') {
        const cp = useDocument.getState().currentPage;
        const origPage = doc.pagesOrder[cp - 1] ?? doc.pagesOrder[0];
        const page = source.getPage(origPage - 1);
        const { width, height } = page.getSize();
        pageSize = [width, height];
      } else {
        pageSize = SIZES[size];
      }
      if (orientation === 'landscape') {
        pageSize = [pageSize[1], pageSize[0]];
      }
      const cp = useDocument.getState().currentPage;
      let insertAt = 0;
      if (where === 'end') insertAt = source.getPageCount();
      else if (where === 'start') insertAt = 0;
      else if (where === 'before') insertAt = (doc.pagesOrder[cp - 1] ?? 1) - 1;
      else insertAt = doc.pagesOrder[cp - 1] ?? source.getPageCount();
      source.insertPage(insertAt, pageSize);
      const bytes = await source.save();
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      await setWorkingBytes(ab);
      toast.success('Página en blanco insertada');
      api.close();
    } catch (e: any) {
      console.error(e);
      toast.error('Error: ' + (e?.message ?? 'desconocido'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-secondary">
        Inserta una página en blanco en el PDF actual.
      </p>

      <div>
        <label className="mb-1 block text-xs text-ink-secondary">Posición</label>
        <select
          value={where}
          onChange={(e) => setWhere(e.target.value as Where)}
          className="input"
        >
          <option value="after">Después de la página actual</option>
          <option value="before">Antes de la página actual</option>
          <option value="start">Al principio</option>
          <option value="end">Al final</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Tamaño</label>
          <select
            value={size}
            onChange={(e) => setSize(e.target.value as Size)}
            className="input"
          >
            <option value="match-current">Igual que página actual</option>
            <option value="a4">A4</option>
            <option value="letter">Carta</option>
            <option value="legal">Oficio (Legal)</option>
            <option value="a5">A5</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Orientación</label>
          <select
            value={orientation}
            onChange={(e) => setOrientation(e.target.value as any)}
            className="input"
            disabled={size === 'match-current'}
          >
            <option value="portrait">Vertical</option>
            <option value="landscape">Horizontal</option>
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary" onClick={api.close} disabled={busy}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={apply} disabled={busy}>
          {busy ? 'Insertando…' : 'Insertar'}
        </button>
      </div>
    </div>
  );
}

export function showInsertBlankDialog() {
  openModal('Insertar página en blanco', (api) => <InsertBlankView api={api} />);
}
