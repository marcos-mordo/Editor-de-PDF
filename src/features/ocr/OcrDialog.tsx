import { useState } from 'react';
import { createWorker, type Worker } from 'tesseract.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import toast from 'react-hot-toast';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { stripPdfExt } from '../../lib/utils';

type Lang = 'spa' | 'eng' | 'fra' | 'por' | 'deu' | 'spa+eng';

const LANGS: { value: Lang; label: string }[] = [
  { value: 'spa', label: 'Español' },
  { value: 'eng', label: 'Inglés' },
  { value: 'spa+eng', label: 'Español + Inglés' },
  { value: 'fra', label: 'Francés' },
  { value: 'por', label: 'Portugués' },
  { value: 'deu', label: 'Alemán' },
];

type OutputMode = 'searchable' | 'text' | 'overlay';

function OcrView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const setWorkingBytes = useDocument((s) => s.setWorkingBytes);
  const [lang, setLang] = useState<Lang>('spa');
  const [mode, setMode] = useState<OutputMode>('searchable');
  const [pageRange, setPageRange] = useState<'all' | 'current' | 'custom'>('all');
  const [customRange, setCustomRange] = useState('1-');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ page: 0, total: 0, status: '' });
  const [resultText, setResultText] = useState<string | null>(null);

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  function pagesToProcess(): number[] {
    const total = doc!.pagesOrder.length;
    if (pageRange === 'all') return doc!.pagesOrder.slice();
    if (pageRange === 'current') {
      const cp = useDocument.getState().currentPage;
      return [doc!.pagesOrder[cp - 1] ?? doc!.pagesOrder[0]];
    }
    // custom
    return customRange
      .split(',')
      .flatMap((part) => {
        const m = part.trim().match(/^(\d+)\s*-\s*(\d+)?$/);
        if (m) {
          const lo = Math.max(1, Number(m[1]));
          const hi = m[2] ? Math.min(total, Number(m[2])) : total;
          const arr: number[] = [];
          for (let i = lo; i <= hi; i++) arr.push(doc!.pagesOrder[i - 1]);
          return arr;
        }
        const n = Number(part.trim());
        if (Number.isFinite(n) && n >= 1 && n <= total) return [doc!.pagesOrder[n - 1]];
        return [];
      })
      .filter(Boolean);
  }

  async function run() {
    if (!doc) return;
    setBusy(true);
    setResultText(null);
    const pages = pagesToProcess();
    if (pages.length === 0) {
      toast.error('Selección de páginas vacía');
      setBusy(false);
      return;
    }
    setProgress({ page: 0, total: pages.length, status: 'Iniciando…' });
    let worker: Worker | null = null;
    try {
      worker = await createWorker(lang, 1, {
        logger: (m) => {
          if (m.status) {
            setProgress((p) => ({ ...p, status: m.status }));
          }
        },
      });

      // Render each page to canvas, OCR, collect text
      const accumulated: { pageNumber: number; text: string }[] = [];
      let processed = 0;
      for (const origPage of pages) {
        setProgress({
          page: processed + 1,
          total: pages.length,
          status: `Procesando página ${processed + 1}/${pages.length}…`,
        });
        const page = await doc.proxy.getPage(origPage);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
        const { data } = await worker.recognize(canvas);
        accumulated.push({ pageNumber: origPage, text: data.text });
        processed++;
      }

      if (mode === 'text') {
        setResultText(accumulated.map((p) => p.text).join('\n\n---\n\n'));
        toast.success('OCR completado');
      } else if (mode === 'searchable' || mode === 'overlay') {
        // Build a new PDF with invisible (searchable) text overlayed on the rendered page image
        const out = await PDFDocument.create();
        const font = await out.embedFont(StandardFonts.Helvetica);
        for (let i = 0; i < pages.length; i++) {
          const origPage = pages[i];
          const page = await doc.proxy.getPage(origPage);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d')!;
          await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
          const png = canvas.toDataURL('image/png');
          const pngBin = Uint8Array.from(atob(png.split(',')[1]), (c) => c.charCodeAt(0));
          const img = await out.embedPng(pngBin);
          const pdfPage = out.addPage([viewport.width / 2, viewport.height / 2]);
          pdfPage.drawImage(img, {
            x: 0,
            y: 0,
            width: viewport.width / 2,
            height: viewport.height / 2,
          });
          // Re-recognize to get word positions (we already ran, but bounding boxes need data.words)
          const rec = await worker.recognize(canvas);
          const words: any[] = (rec.data as any).words ?? [];
          for (const w of words) {
            if (!w.text || !w.bbox) continue;
            const { x0, y0, x1, y1 } = w.bbox;
            const wWidth = (x1 - x0) / 2;
            const wHeight = (y1 - y0) / 2;
            const xPdf = x0 / 2;
            const yPdf = (viewport.height - y1) / 2;
            const size = Math.max(4, Math.min(48, wHeight));
            pdfPage.drawText(w.text, {
              x: xPdf,
              y: yPdf,
              size,
              font,
              color: rgb(0, 0, 0),
              opacity: mode === 'searchable' ? 0.001 : 0.7,
            });
          }
        }
        const bytes = await out.save();
        const ab = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        await setWorkingBytes(ab);
        toast.success(
          mode === 'searchable'
            ? 'PDF buscable creado'
            : 'PDF con texto visible sobre escaneo',
        );
        api.close();
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Error en OCR: ' + (e?.message ?? 'desconocido'));
    } finally {
      try {
        await worker?.terminate();
      } catch {
        /* noop */
      }
      setBusy(false);
    }
  }

  async function saveText() {
    if (!resultText || !doc) return;
    const blob = new Blob([resultText], { type: 'text/plain;charset=utf-8' });
    const ab = await blob.arrayBuffer();
    const name = `${stripPdfExt(doc.name)}_ocr.txt`;
    await window.api.saveBinary(name, ab, [{ name: 'Texto', extensions: ['txt'] }]);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-secondary">
        Reconoce texto en escaneos. Se procesa <strong>localmente</strong> con
        Tesseract.js. La primera ejecución descarga el idioma (~10-30 MB).
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Idioma</label>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="input"
            disabled={busy}
          >
            {LANGS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Salida</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as OutputMode)}
            className="input"
            disabled={busy}
          >
            <option value="searchable">PDF buscable (texto invisible)</option>
            <option value="overlay">PDF con texto visible</option>
            <option value="text">Solo texto plano</option>
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-ink-secondary">Páginas</label>
        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={pageRange === 'all'}
              onChange={() => setPageRange('all')}
              disabled={busy}
            />
            Todas
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={pageRange === 'current'}
              onChange={() => setPageRange('current')}
              disabled={busy}
            />
            Actual
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={pageRange === 'custom'}
              onChange={() => setPageRange('custom')}
              disabled={busy}
            />
            Personalizado
          </label>
          {pageRange === 'custom' && (
            <input
              className="input ml-2 max-w-[220px]"
              value={customRange}
              onChange={(e) => setCustomRange(e.target.value)}
              placeholder="1-5, 8, 10-12"
            />
          )}
        </div>
      </div>

      {busy && (
        <div className="rounded border border-page-border bg-page-alt p-3 text-sm">
          <div>
            Página {progress.page} de {progress.total}
          </div>
          <div className="mt-1 h-1.5 w-full rounded bg-page-alt-2 overflow-hidden">
            <div
              className="h-full bg-amazon-orange transition-all"
              style={{
                width: `${progress.total > 0 ? (progress.page / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="mt-1 text-xs text-ink-secondary">{progress.status}</div>
        </div>
      )}

      {resultText !== null && (
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Texto reconocido</label>
          <textarea
            className="input h-40 resize-y font-mono text-xs"
            value={resultText}
            readOnly
          />
          <button className="btn-secondary mt-2" onClick={saveText}>
            Guardar como .txt
          </button>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-ghost" onClick={api.close} disabled={busy}>
          Cerrar
        </button>
        <button className="btn-primary" onClick={run} disabled={busy}>
          {busy ? 'Procesando…' : 'Iniciar OCR'}
        </button>
      </div>
    </div>
  );
}

export function showOcrDialog() {
  openModal('Reconocer texto (OCR)', (api) => <OcrView api={api} />, 'max-w-xl');
}
