import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { pushHistory } from '../../stores/history';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function CropView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const applyToWorkingPdf = useDocument((s) => s.applyToWorkingPdf);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [drawing, setDrawing] = useState<null | { sx: number; sy: number }>(null);
  const [scale, setScale] = useState(1);
  const [pageMode, setPageMode] = useState<'current' | 'all'>('all');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!doc) return;
      const cp = useDocument.getState().currentPage;
      const origPage = doc.pagesOrder[cp - 1] ?? doc.pagesOrder[0];
      const page = await doc.proxy.getPage(origPage);
      const base = page.getViewport({ scale: 1 });
      const previewMax = 560;
      const sc = Math.min(1.6, previewMax / base.width);
      const viewport = page.getViewport({ scale: sc });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
      if (!cancelled) {
        setScale(sc);
        // Default selection: full page (a small inset so handles are visible)
        setRect({ x: 0, y: 0, w: viewport.width, h: viewport.height });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  function off(e: React.PointerEvent) {
    const r = wrapperRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function start(e: React.PointerEvent) {
    const { x, y } = off(e);
    setDrawing({ sx: x, sy: y });
    setRect({ x, y, w: 0, h: 0 });
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!drawing) return;
    const { x, y } = off(e);
    setRect({
      x: Math.min(drawing.sx, x),
      y: Math.min(drawing.sy, y),
      w: Math.abs(x - drawing.sx),
      h: Math.abs(y - drawing.sy),
    });
  }
  function end() {
    setDrawing(null);
  }

  async function apply() {
    if (!doc || !rect || !canvasRef.current) {
      toast.error('Dibuja el área a mantener');
      return;
    }
    if (rect.w < 10 || rect.h < 10) {
      toast.error('El área es demasiado pequeña');
      return;
    }
    setBusy(true);
    try {
      const canvasH = canvasRef.current.height;
      // Preview pixels → PDF points (origin bottom-left).
      const pdfX = rect.x / scale;
      const pdfW = rect.w / scale;
      const pdfH = rect.h / scale;
      // Y in preview is top-down; convert top of selection to PDF bottom-up.
      const pdfYfromTop = rect.y / scale;
      const pdfPageH = canvasH / scale;
      const pdfY = pdfPageH - pdfYfromTop - pdfH;

      const targets =
        pageMode === 'all'
          ? doc.pagesOrder.slice()
          : [doc.pagesOrder[useDocument.getState().currentPage - 1]];

      pushHistory();
      const ok = await applyToWorkingPdf((pdf) => {
        for (const origPage of targets) {
          const page = pdf.getPage(origPage - 1);
          const mb = page.getMediaBox();
          // Crop box is relative to the page's media box origin.
          const cx = mb.x + pdfX;
          const cy = mb.y + pdfY;
          page.setCropBox(cx, cy, pdfW, pdfH);
        }
      });
      if (ok) {
        toast.success(
          `Recortado en ${targets.length} página${targets.length !== 1 ? 's' : ''}`,
        );
        api.close();
      } else {
        toast.error('No se pudo recortar');
      }
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
        Arrastra para marcar el área que quieres <strong>mantener</strong>. El
        resto se recorta (no se borra contenido, solo se ajusta el área visible).
      </p>

      <div
        ref={wrapperRef}
        className="relative mx-auto inline-block select-none overflow-hidden rounded border-2 border-page-border bg-page-alt-2"
        style={{ touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <canvas ref={canvasRef} className="block bg-white" />
        {/* Dim outside the crop area */}
        {rect && canvasRef.current && (
          <>
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: 'rgba(0,0,0,0.45)',
                clipPath: `polygon(
                  0 0, 100% 0, 100% 100%, 0 100%, 0 0,
                  ${rect.x}px ${rect.y}px,
                  ${rect.x}px ${rect.y + rect.h}px,
                  ${rect.x + rect.w}px ${rect.y + rect.h}px,
                  ${rect.x + rect.w}px ${rect.y}px,
                  ${rect.x}px ${rect.y}px
                )`,
              }}
            />
            <div
              className="pointer-events-none absolute border-2 border-amazon-orange"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            />
          </>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs text-ink-secondary">Aplicar a</label>
        <div className="flex gap-3 text-sm">
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
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary" onClick={api.close} disabled={busy}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={apply} disabled={busy || !rect}>
          {busy ? 'Recortando…' : 'Recortar'}
        </button>
      </div>
    </div>
  );
}

export function showCropDialog() {
  openModal('Recortar páginas', (api) => <CropView api={api} />, 'max-w-3xl');
}
