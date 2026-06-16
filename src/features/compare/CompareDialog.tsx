import { useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, ArrowRight } from 'lucide-react';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { pdfjsLib, type PDFDocumentProxy } from '../../lib/pdfjs';
import { diffWords, diffStats, type DiffOp } from './word-diff';

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

function CompareView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const [otherName, setOtherName] = useState<string | null>(null);
  const [pages, setPages] = useState<DiffOp[][] | null>(null);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(0);

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  async function pickAndCompare() {
    const files = await window.api.openPdf();
    if (!files || files.length === 0) return;
    const other = files[0];
    setBusy(true);
    setPages(null);
    const tt = toast.loading('Comparando…');
    try {
      const otherProxy = await pdfjsLib.getDocument({ data: other.data.slice(0) })
        .promise;
      const [aTexts, bTexts] = await Promise.all([
        pageTexts(doc!.proxy),
        pageTexts(otherProxy),
      ]);
      const maxPages = Math.max(aTexts.length, bTexts.length);
      const diffs: DiffOp[][] = [];
      for (let i = 0; i < maxPages; i++) {
        diffs.push(diffWords(aTexts[i] ?? '', bTexts[i] ?? ''));
      }
      await otherProxy.destroy();
      setOtherName(other.name);
      setPages(diffs);
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

  const totals = pages
    ? pages.reduce(
        (acc, ops) => {
          const s = diffStats(ops);
          return { added: acc.added + s.added, removed: acc.removed + s.removed };
        },
        { added: 0, removed: 0 },
      )
    : null;

  return (
    <div className="space-y-4">
      {!pages ? (
        <>
          <p className="text-sm text-ink-secondary">
            Compara el documento actual con otro PDF. Se resaltan las palabras
            <span className="mx-1 rounded bg-green-100 px-1 text-green-800">
              añadidas
            </span>
            y
            <span className="mx-1 rounded bg-red-100 px-1 text-red-800 line-through">
              eliminadas
            </span>
            página por página.
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
            {totals && (
              <div className="flex gap-2 text-xs">
                <span className="rounded bg-green-100 px-2 py-0.5 text-green-800">
                  +{totals.added}
                </span>
                <span className="rounded bg-red-100 px-2 py-0.5 text-red-800">
                  −{totals.removed}
                </span>
              </div>
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
              Página {current + 1} / {pages.length}
            </span>
            <button
              className="btn-secondary"
              onClick={() => setCurrent((c) => Math.min(pages.length - 1, c + 1))}
              disabled={current >= pages.length - 1}
            >
              Siguiente ›
            </button>
          </div>

          <div className="max-h-80 overflow-auto rounded border border-page-border bg-page p-3 text-sm leading-relaxed">
            {pages[current].length === 0 ? (
              <span className="text-ink-muted">(página sin texto)</span>
            ) : (
              pages[current].map((op, i) => {
                if (op.type === 'equal')
                  return (
                    <span key={i} className="text-ink-secondary">
                      {op.text}
                    </span>
                  );
                if (op.type === 'add')
                  return (
                    <span key={i} className="rounded bg-green-100 text-green-800">
                      {op.text}
                    </span>
                  );
                return (
                  <span
                    key={i}
                    className="rounded bg-red-100 text-red-800 line-through"
                  >
                    {op.text}
                  </span>
                );
              })
            )}
          </div>
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

export function showCompareDialog() {
  openModal('Comparar PDFs', (api) => <CompareView api={api} />, 'max-w-2xl');
}
