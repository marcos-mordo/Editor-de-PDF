import { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import toast from 'react-hot-toast';
import { Zap, FileDown } from 'lucide-react';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { stripPdfExt, toArrayBuffer, formatBytes } from '../../lib/utils';

type Mode = 'lossless' | 'raster';

function CompressView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const [mode, setMode] = useState<Mode>('lossless');
  const [quality, setQuality] = useState(0.6);
  const [dpiScale, setDpiScale] = useState(1.5);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ before: number; after: number } | null>(null);
  const [outputBytes, setOutputBytes] = useState<ArrayBuffer | null>(null);

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  const originalSize = doc.workingBytes.byteLength;

  async function compress() {
    if (!doc) return;
    setBusy(true);
    setResult(null);
    setOutputBytes(null);
    const tt = toast.loading('Comprimiendo…');
    try {
      let out: Uint8Array;
      if (mode === 'lossless') {
        // Re-pack objects (object streams) and drop unreferenced data.
        const src = await PDFDocument.load(doc.workingBytes.slice(0), {
          ignoreEncryption: true,
        });
        out = await src.save({ useObjectStreams: true });
      } else {
        // Rasterise each page to JPEG at the chosen quality and rebuild.
        const newDoc = await PDFDocument.create();
        for (const origPage of doc.pagesOrder) {
          const page = await doc.proxy.getPage(origPage);
          const rotation = doc.pageRotations[origPage] ?? 0;
          const viewport = page.getViewport({ scale: dpiScale, rotation });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          const jpg = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
          const img = await newDoc.embedJpg(jpg);
          // Page sized to the original page dimensions (points).
          const view = page.view;
          const wPt = view[2] - view[0];
          const hPt = view[3] - view[1];
          const swap = rotation % 180 !== 0;
          const pw = swap ? hPt : wPt;
          const ph = swap ? wPt : hPt;
          const pdfPage = newDoc.addPage([pw, ph]);
          pdfPage.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
        }
        out = await newDoc.save({ useObjectStreams: true });
      }
      const ab = toArrayBuffer(out);
      toast.dismiss(tt);
      setResult({ before: originalSize, after: ab.byteLength });
      setOutputBytes(ab);
      if (ab.byteLength >= originalSize && mode === 'lossless') {
        toast('Este PDF ya está optimizado; prueba el modo de reducción.', {
          icon: 'ℹ️',
        });
      } else {
        toast.success('Listo. Revisa el resultado abajo.');
      }
    } catch (e: any) {
      toast.dismiss(tt);
      console.error(e);
      toast.error('Error: ' + (e?.message ?? 'desconocido'));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!doc || !outputBytes) return;
    const name = `${stripPdfExt(doc.name)}_comprimido.pdf`;
    const saved = await window.api.savePdf(name, outputBytes);
    if (saved) {
      toast.success('Guardado');
      api.close();
    }
  }

  const reduction =
    result && result.before > 0
      ? Math.round((1 - result.after / result.before) * 100)
      : 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-secondary">
        Tamaño actual: <strong className="text-ink">{formatBytes(originalSize)}</strong>
      </p>

      <div className="space-y-2">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            checked={mode === 'lossless'}
            onChange={() => setMode('lossless')}
            className="mt-1"
          />
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <Zap size={14} className="text-amazon-orange" /> Optimizar (sin pérdida)
            </div>
            <div className="text-xs text-ink-secondary">
              Reempaqueta el archivo y elimina datos sin usar. Mantiene el texto
              seleccionable y la calidad. Reducción modesta.
            </div>
          </div>
        </label>

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            checked={mode === 'raster'}
            onChange={() => setMode('raster')}
            className="mt-1"
          />
          <div className="flex-1">
            <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <FileDown size={14} className="text-amazon-orange" /> Reducir tamaño
              (rasterizar)
            </div>
            <div className="text-xs text-ink-secondary">
              Convierte cada página en imagen JPEG. Reduce mucho el tamaño en PDFs
              con imágenes o escaneos, pero el texto deja de ser seleccionable.
            </div>
            {mode === 'raster' && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-ink-secondary">
                    Calidad JPEG: {Math.round(quality * 100)}%
                  </label>
                  <input
                    type="range"
                    min={0.3}
                    max={0.92}
                    step={0.02}
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    className="w-full accent-amazon-orange"
                  />
                </div>
                <div>
                  <label className="text-xs text-ink-secondary">
                    Resolución: {Math.round(dpiScale * 72)} DPI
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.25}
                    value={dpiScale}
                    onChange={(e) => setDpiScale(Number(e.target.value))}
                    className="w-full accent-amazon-orange"
                  />
                </div>
              </div>
            )}
          </div>
        </label>
      </div>

      {result && (
        <div className="rounded border border-page-border bg-page-alt p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-ink-secondary">Antes</span>
            <span className="text-ink">{formatBytes(result.before)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-secondary">Después</span>
            <span className="font-semibold text-ink">{formatBytes(result.after)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-page-border pt-1">
            <span className="text-ink-secondary">Reducción</span>
            <span
              className={
                reduction > 0
                  ? 'font-bold text-green-700'
                  : 'font-bold text-ink-secondary'
              }
            >
              {reduction > 0 ? `−${reduction}%` : 'sin cambios'}
            </span>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary" onClick={api.close} disabled={busy}>
          Cancelar
        </button>
        {!outputBytes ? (
          <button className="btn-primary" onClick={compress} disabled={busy}>
            {busy ? 'Comprimiendo…' : 'Comprimir'}
          </button>
        ) : (
          <button className="btn-primary" onClick={save}>
            Guardar resultado
          </button>
        )}
      </div>
    </div>
  );
}

export function showCompressDialog() {
  openModal('Reducir tamaño del PDF', (api) => <CompressView api={api} />, 'max-w-xl');
}
