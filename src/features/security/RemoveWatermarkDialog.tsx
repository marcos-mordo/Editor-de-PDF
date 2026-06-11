import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { useAnnotations } from '../../stores/annotations';
import { pushHistory } from '../../stores/history';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function RemoveWatermarkView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const addAnnotation = useAnnotations((s) => s.add);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [rectScreen, setRectScreen] = useState<Rect | null>(null);
  const [drawing, setDrawing] = useState<null | { sx: number; sy: number }>(null);
  const [pageSize, setPageSize] = useState<{ w: number; h: number; scale: number } | null>(null);
  const [pageMode, setPageMode] = useState<'current' | 'all' | 'range'>('all');
  const [rangeInput, setRangeInput] = useState('1-');
  const [busy, setBusy] = useState(false);

  // Render current page as preview
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!doc) return;
      const currentPage = useDocument.getState().currentPage;
      const origPage = doc.pagesOrder[currentPage - 1] ?? doc.pagesOrder[0];
      const page = await doc.proxy.getPage(origPage);
      const previewMaxWidth = 560;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.5, previewMaxWidth / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
      if (!cancelled) {
        setPageSize({ w: viewport.width, h: viewport.height, scale });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  function getOffset(e: React.PointerEvent) {
    const wrapper = wrapperRef.current!;
    const rect = wrapper.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startDraw(e: React.PointerEvent) {
    const { x, y } = getOffset(e);
    setDrawing({ sx: x, sy: y });
    setRectScreen({ x, y, w: 0, h: 0 });
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function moveDraw(e: React.PointerEvent) {
    if (!drawing) return;
    const { x, y } = getOffset(e);
    setRectScreen({
      x: Math.min(drawing.sx, x),
      y: Math.min(drawing.sy, y),
      w: Math.abs(x - drawing.sx),
      h: Math.abs(y - drawing.sy),
    });
  }
  function endDraw() {
    setDrawing(null);
  }

  function targetPages(): number[] {
    if (!doc) return [];
    const total = doc.pagesOrder.length;
    if (pageMode === 'current') {
      const cp = useDocument.getState().currentPage;
      return [doc.pagesOrder[cp - 1] ?? doc.pagesOrder[0]];
    }
    if (pageMode === 'all') return doc.pagesOrder.slice();
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

  function apply() {
    if (!doc || !rectScreen || !pageSize) {
      toast.error('Dibuja un rectángulo sobre la marca de agua primero');
      return;
    }
    if (rectScreen.w < 5 || rectScreen.h < 5) {
      toast.error('El rectángulo es demasiado pequeño');
      return;
    }
    setBusy(true);
    try {
      const pages = targetPages();
      if (pages.length === 0) {
        toast.error('Selección de páginas vacía');
        setBusy(false);
        return;
      }
      // Convert preview-screen rect to PDF coordinates
      // The PDF page is rendered at `scale`. Preview canvas pixels -> PDF points.
      const scale = pageSize.scale;
      const pdfX = rectScreen.x / scale;
      const pdfY_top = rectScreen.y / scale;
      const pdfW = rectScreen.w / scale;
      const pdfH = rectScreen.h / scale;

      pushHistory();
      for (const origPage of pages) {
        // We need the actual page height to convert top-y to PDF bottom-up y
        // doc.proxy.getPage(origPage).then is async; let's await sync via promise
      }
      // Use the current page's height as a reference; all pages may differ but
      // most PDFs have consistent dimensions across pages.
      const currentOrig = pages[0];
      doc.proxy.getPage(currentOrig).then((firstPage) => {
        const view = firstPage.view;
        const pageHeight = view[3] - view[1];
        const annY = pageHeight - pdfY_top - pdfH;
        for (const origPage of pages) {
          addAnnotation({
            type: 'rect',
            pageNumber: origPage,
            x: pdfX,
            y: annY,
            width: pdfW,
            height: pdfH,
            color: '#FFFFFF',
            opacity: 1,
            strokeWidth: 0,
          });
        }
        toast.success(
          `Marca de agua cubierta en ${pages.length} página${pages.length !== 1 ? 's' : ''}`,
        );
        api.close();
      });
    } catch (e: any) {
      console.error(e);
      toast.error('Error: ' + (e?.message ?? 'desconocido'));
    } finally {
      setBusy(false);
    }
  }

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-secondary">
        Dibuja un rectángulo sobre la marca de agua del PDF y aplícalo a las
        páginas que quieras. El área quedará cubierta con un rectángulo blanco
        al guardar.
      </p>

      <div
        ref={wrapperRef}
        className="relative inline-block overflow-hidden rounded border-2 border-page-border bg-page-alt-2 mx-auto"
        style={{ touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={startDraw}
        onPointerMove={moveDraw}
        onPointerUp={endDraw}
        onPointerCancel={endDraw}
      >
        <canvas ref={canvasRef} className="block bg-white" />
        {rectScreen && (
          <div
            className="pointer-events-none absolute border-2 border-amazon-orange"
            style={{
              left: rectScreen.x,
              top: rectScreen.y,
              width: rectScreen.w,
              height: rectScreen.h,
              background: 'rgba(255, 153, 0, 0.25)',
            }}
          />
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs text-ink-secondary">Aplicar a</label>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={pageMode === 'all'}
              onChange={() => setPageMode('all')}
            />
            Todas las páginas
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={pageMode === 'current'}
              onChange={() => setPageMode('current')}
            />
            Solo página actual
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
        <button className="btn-secondary" onClick={api.close} disabled={busy}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={apply} disabled={busy || !rectScreen}>
          {busy ? 'Aplicando…' : 'Quitar marca de agua'}
        </button>
      </div>
    </div>
  );
}

export function showRemoveWatermarkDialog() {
  openModal('Quitar marca de agua', (api) => <RemoveWatermarkView api={api} />, 'max-w-3xl');
}
