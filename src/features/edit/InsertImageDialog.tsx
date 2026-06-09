import { useState } from 'react';
import toast from 'react-hot-toast';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { useAnnotations } from '../../stores/annotations';
import { pushHistory } from '../../stores/history';

function InsertImageView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const addAnnotation = useAnnotations((s) => s.add);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [imageType, setImageType] = useState<'png' | 'jpg'>('png');
  const [pageMode, setPageMode] = useState<'current' | 'all' | 'range'>('current');
  const [rangeInput, setRangeInput] = useState('1-');
  const [scale, setScale] = useState(0.3);
  const [position, setPosition] = useState<'tl' | 'tr' | 'bl' | 'br' | 'center'>('br');
  const [busy, setBusy] = useState(false);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  async function pickImage() {
    const img = await window.api.openImage();
    if (!img) return;
    const ext = img.name.toLowerCase().split('.').pop() ?? 'png';
    const type = ext === 'jpg' || ext === 'jpeg' ? 'jpg' : 'png';
    setImageType(type);
    const blob = new Blob([img.data], {
      type: type === 'png' ? 'image/png' : 'image/jpeg',
    });
    const url = await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.readAsDataURL(blob);
    });
    setDataUrl(url);
    // Get dimensions
    const im = new Image();
    im.onload = () => setImgSize({ w: im.width, h: im.height });
    im.src = url;
  }

  function targetPages(): number[] {
    if (!doc) return [];
    const total = doc.pagesOrder.length;
    if (pageMode === 'all') return doc.pagesOrder.slice();
    if (pageMode === 'current') {
      const cp = useDocument.getState().currentPage;
      return [doc.pagesOrder[cp - 1] ?? doc.pagesOrder[0]];
    }
    return rangeInput
      .split(',')
      .flatMap((part) => {
        const m = part.trim().match(/^(\d+)\s*-\s*(\d+)?$/);
        if (m) {
          const lo = Math.max(1, Number(m[1]));
          const hi = m[2] ? Math.min(total, Number(m[2])) : total;
          const arr: number[] = [];
          for (let i = lo; i <= hi; i++) arr.push(doc.pagesOrder[i - 1]);
          return arr;
        }
        const n = Number(part.trim());
        return Number.isFinite(n) && n >= 1 && n <= total
          ? [doc.pagesOrder[n - 1]]
          : [];
      })
      .filter(Boolean);
  }

  async function apply() {
    if (!doc || !dataUrl || !imgSize) {
      toast.error('Selecciona una imagen');
      return;
    }
    setBusy(true);
    try {
      const pages = targetPages();
      pushHistory();
      for (const origPage of pages) {
        const page = await doc.proxy.getPage(origPage);
        const view = page.view;
        const pageW = view[2] - view[0];
        const pageH = view[3] - view[1];
        const imgW = imgSize.w * scale;
        const imgH = imgSize.h * scale;
        let x = 20;
        let y = 20;
        switch (position) {
          case 'tl':
            x = 20;
            y = pageH - imgH - 20;
            break;
          case 'tr':
            x = pageW - imgW - 20;
            y = pageH - imgH - 20;
            break;
          case 'bl':
            x = 20;
            y = 20;
            break;
          case 'br':
            x = pageW - imgW - 20;
            y = 20;
            break;
          case 'center':
            x = (pageW - imgW) / 2;
            y = (pageH - imgH) / 2;
            break;
        }
        addAnnotation({
          type: 'image',
          pageNumber: origPage,
          x,
          y,
          width: imgW,
          height: imgH,
          color: '#000000',
          opacity: 1,
          imageData: dataUrl,
          imageType,
        });
      }
      toast.success(`Imagen añadida a ${pages.length} página(s)`);
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
        Inserta una imagen sobre el PDF. Después puedes seleccionarla y moverla con el ratón.
      </p>

      <div>
        <button className="btn-secondary" onClick={pickImage}>
          Seleccionar imagen…
        </button>
        {dataUrl && (
          <div className="mt-3 flex items-center gap-3">
            <img
              src={dataUrl}
              alt="preview"
              className="max-h-32 max-w-32 rounded border border-page-border bg-white"
            />
            <div className="text-xs text-ink-secondary">
              {imgSize ? `${imgSize.w}×${imgSize.h}px` : ''}
              {' · '}
              {imageType.toUpperCase()}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Escala</label>
          <input
            type="range"
            min={0.05}
            max={2}
            step={0.05}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            className="w-full"
          />
          <div className="text-right text-xs text-ink-secondary">{Math.round(scale * 100)}%</div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Posición</label>
          <select
            className="input"
            value={position}
            onChange={(e) => setPosition(e.target.value as any)}
          >
            <option value="tl">Superior izq.</option>
            <option value="tr">Superior der.</option>
            <option value="center">Centro</option>
            <option value="bl">Inferior izq.</option>
            <option value="br">Inferior der.</option>
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-ink-secondary">Páginas</label>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={pageMode === 'current'}
              onChange={() => setPageMode('current')}
            />
            Página actual
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={pageMode === 'all'}
              onChange={() => setPageMode('all')}
            />
            Todas
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={pageMode === 'range'}
              onChange={() => setPageMode('range')}
            />
            Rango
          </label>
          {pageMode === 'range' && (
            <input
              className="input ml-2 max-w-[180px]"
              value={rangeInput}
              onChange={(e) => setRangeInput(e.target.value)}
              placeholder="1-5, 8"
            />
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-ghost" onClick={api.close} disabled={busy}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={apply} disabled={busy || !dataUrl}>
          {busy ? 'Insertando…' : 'Insertar imagen'}
        </button>
      </div>
    </div>
  );
}

export function showInsertImageDialog() {
  openModal('Insertar imagen', (api) => <InsertImageView api={api} />);
}
