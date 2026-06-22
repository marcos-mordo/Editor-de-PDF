import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, ArrowRight, Type, Images } from 'lucide-react';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { pdfjsLib, type PDFDocumentProxy } from '../../lib/pdfjs';
import { diffWords, diffStats, type DiffOp } from './word-diff';
import { diffPixels } from './pixel-diff';

type Mode = 'text' | 'visual';

async function pageTexts(proxy: PDFDocumentProxy): Promise<string[]> {
  const out: string[] = [];
  for (let i = 1; i <= proxy.numPages; i++) {
    const page = await proxy.getPage(i);
    const tc = await page.getTextContent();
    out.push(
      (tc.items as any[])
        .map((it) => it.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }
  return out;
}

/** Render a PDF page onto a fresh white canvas at the given scale. */
async function renderPage(
  proxy: PDFDocumentProxy,
  pageNum: number,
  scale: number,
): Promise<HTMLCanvasElement | null> {
  if (pageNum > proxy.numPages) return null;
  const page = await proxy.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Place `src` (top-left) on a WxH white canvas and return its ImageData. */
function commonImageData(
  src: HTMLCanvasElement | null,
  w: number,
  h: number,
): ImageData {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  if (src) ctx.drawImage(src, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

function CompareView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const [mode, setMode] = useState<Mode>('text');
  const [otherName, setOtherName] = useState<string | null>(null);
  const [pages, setPages] = useState<DiffOp[][] | null>(null);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(0);

  // Visual mode state.
  const [otherProxy, setOtherProxy] = useState<PDFDocumentProxy | null>(null);
  const [visualPages, setVisualPages] = useState(0);
  const [view, setView] = useState<'diff' | 'a' | 'b'>('diff');
  const [ratio, setRatio] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  async function pickAndCompare() {
    const files = await window.api.openPdf();
    if (!files || files.length === 0) return;
    const other = files[0];
    setBusy(true);
    setPages(null);
    setRatio(null);
    const tt = toast.loading('Comparando…');
    try {
      const otherP = await pdfjsLib.getDocument({ data: other.data.slice(0) }).promise;
      if (mode === 'text') {
        const [aTexts, bTexts] = await Promise.all([
          pageTexts(doc!.proxy),
          pageTexts(otherP),
        ]);
        const maxPages = Math.max(aTexts.length, bTexts.length);
        const diffs: DiffOp[][] = [];
        for (let i = 0; i < maxPages; i++) {
          diffs.push(diffWords(aTexts[i] ?? '', bTexts[i] ?? ''));
        }
        await otherP.destroy();
        setPages(diffs);
      } else {
        setOtherProxy(otherP);
        setVisualPages(Math.max(doc!.proxy.numPages, otherP.numPages));
      }
      setOtherName(other.name);
      setCurrent(0);
      toast.dismiss(tt);
    } catch (e: any) {
      toast.dismiss(tt);
      console.error(e);
      toast.error('Error al comparar: ' + (e?.message ?? 'desconocido'));
    } finally {
      setBusy(false);
    }
  }

  // Render the current page pair (visual mode) whenever inputs change.
  useEffect(() => {
    if (mode !== 'visual' || !otherProxy || !doc) return;
    let cancelled = false;
    (async () => {
      try {
        const scale = 1.5;
        const [ca, cb] = await Promise.all([
          renderPage(doc.proxy, current + 1, scale),
          renderPage(otherProxy, current + 1, scale),
        ]);
        if (cancelled) return;
        const w = Math.max(ca?.width ?? 0, cb?.width ?? 0);
        const h = Math.max(ca?.height ?? 0, cb?.height ?? 0);
        if (w === 0 || h === 0) return;
        const out = canvasRef.current;
        if (!out) return;
        out.width = w;
        out.height = h;
        const ctx = out.getContext('2d')!;
        if (view === 'a' || view === 'b') {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          const src = view === 'a' ? ca : cb;
          if (src) ctx.drawImage(src, 0, 0);
          const ida = commonImageData(ca, w, h);
          const idb = commonImageData(cb, w, h);
          setRatio(diffPixels(ida.data, idb.data, w, h).ratio);
        } else {
          const ida = commonImageData(ca, w, h);
          const idb = commonImageData(cb, w, h);
          const res = diffPixels(ida.data, idb.data, w, h);
          const img = ctx.createImageData(w, h);
          img.data.set(res.data);
          ctx.putImageData(img, 0, 0);
          setRatio(res.ratio);
        }
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, otherProxy, current, view, doc]);

  // Tear down the visual proxy when the dialog closes / re-compares.
  useEffect(() => {
    return () => {
      otherProxy?.destroy().catch(() => {});
    };
  }, [otherProxy]);

  const totals = pages
    ? pages.reduce(
        (acc, ops) => {
          const s = diffStats(ops);
          return { added: acc.added + s.added, removed: acc.removed + s.removed };
        },
        { added: 0, removed: 0 },
      )
    : null;

  const hasResult = mode === 'text' ? !!pages : !!otherProxy;
  const pageCount = mode === 'text' ? pages?.length ?? 0 : visualPages;

  return (
    <div className="space-y-4">
      {!hasResult ? (
        <>
          <div className="flex gap-2">
            <ModeButton active={mode === 'text'} onClick={() => setMode('text')} icon={<Type size={15} />} label="Texto" />
            <ModeButton active={mode === 'visual'} onClick={() => setMode('visual')} icon={<Images size={15} />} label="Visual (píxeles)" />
          </div>
          <p className="text-sm text-ink-secondary">
            {mode === 'text' ? (
              <>
                Compara el texto con otro PDF: se resaltan las palabras
                <span className="mx-1 rounded bg-green-100 px-1 text-green-800">añadidas</span>
                y
                <span className="mx-1 rounded bg-red-100 px-1 text-red-800 line-through">eliminadas</span>.
              </>
            ) : (
              <>
                Compara el aspecto visual página a página. Los píxeles que cambian
                se resaltan en
                <span className="mx-1 rounded px-1 text-white" style={{ backgroundColor: 'rgb(255,0,200)' }}>magenta</span>.
              </>
            )}
          </p>
          <div className="flex items-center justify-center gap-3 rounded border border-page-border bg-page-alt p-4 text-sm">
            <span className="flex items-center gap-1.5 text-ink">
              <FileText size={16} className="text-amazon-orange" />
              {doc.name}
            </span>
            <ArrowRight size={16} className="text-ink-muted" />
            <button className="btn-primary" onClick={pickAndCompare} disabled={busy}>
              {busy ? 'Comparando…' : 'Seleccionar PDF a comparar'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-ink">
              <strong>{doc.name}</strong>{' '}
              <ArrowRight size={12} className="inline text-ink-muted" />{' '}
              <strong>{otherName}</strong>
            </div>
            {mode === 'text' && totals && (
              <div className="flex gap-2 text-xs">
                <span className="rounded bg-green-100 px-2 py-0.5 text-green-800">+{totals.added}</span>
                <span className="rounded bg-red-100 px-2 py-0.5 text-red-800">−{totals.removed}</span>
              </div>
            )}
            {mode === 'visual' && ratio !== null && (
              <span className="rounded bg-fuchsia-100 px-2 py-0.5 text-xs text-fuchsia-800">
                {(ratio * 100).toFixed(2)}% distinto
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              className="btn-secondary"
              onClick={() => setCurrent((c) => Math.max(0, c - 1))}
              disabled={current === 0}
            >
              ‹ Anterior
            </button>
            <span className="text-sm text-ink-secondary">
              Página {current + 1} / {pageCount}
            </span>
            <button
              className="btn-secondary"
              onClick={() => setCurrent((c) => Math.min(pageCount - 1, c + 1))}
              disabled={current >= pageCount - 1}
            >
              Siguiente ›
            </button>

            {mode === 'visual' && (
              <div className="ml-auto flex gap-1">
                <ViewTab active={view === 'a'} onClick={() => setView('a')} label="Original" />
                <ViewTab active={view === 'b'} onClick={() => setView('b')} label="Nuevo" />
                <ViewTab active={view === 'diff'} onClick={() => setView('diff')} label="Diferencias" />
              </div>
            )}
          </div>

          {mode === 'text' ? (
            <div className="max-h-80 overflow-auto rounded border border-page-border bg-page p-3 text-sm leading-relaxed">
              {pages![current].length === 0 ? (
                <span className="text-ink-muted">(página sin texto)</span>
              ) : (
                pages![current].map((op, i) => {
                  if (op.type === 'equal')
                    return <span key={i} className="text-ink-secondary">{op.text}</span>;
                  if (op.type === 'add')
                    return <span key={i} className="rounded bg-green-100 text-green-800">{op.text}</span>;
                  return <span key={i} className="rounded bg-red-100 text-red-800 line-through">{op.text}</span>;
                })
              )}
            </div>
          ) : (
            <div className="max-h-[28rem] overflow-auto rounded border border-page-border bg-page-alt p-2 text-center">
              <canvas ref={canvasRef} className="mx-auto max-w-full shadow" />
            </div>
          )}

          <button className="btn-secondary" onClick={pickAndCompare} disabled={busy}>
            Comparar con otro PDF
          </button>
        </>
      )}

      <div className="flex justify-end pt-1">
        <button className="btn-ghost" onClick={api.close}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm transition-colors ' +
        (active
          ? 'border-amazon-orange bg-amazon-orange/10 font-medium text-ink'
          : 'border-page-border text-ink-secondary hover:bg-gray-50')
      }
    >
      {icon}
      {label}
    </button>
  );
}

function ViewTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded px-2 py-1 text-xs transition-colors ' +
        (active ? 'bg-ink text-white' : 'bg-gray-100 text-ink-secondary hover:bg-gray-200')
      }
    >
      {label}
    </button>
  );
}

export function showCompareDialog() {
  openModal('Comparar PDFs', (api) => <CompareView api={api} />, 'max-w-3xl');
}
