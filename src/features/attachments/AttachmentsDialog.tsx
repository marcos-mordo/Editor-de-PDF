import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Paperclip, Plus, Download, FileBox } from 'lucide-react';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { attachFilesToPdf } from './attachments';

interface Existing {
  name: string;
  size: number;
  content: Uint8Array;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function readExisting(proxy: any): Promise<Existing[]> {
  try {
    const map = await proxy.getAttachments();
    if (!map) return [];
    return Object.keys(map).map((k) => ({
      name: map[k].filename || k,
      content: map[k].content as Uint8Array,
      size: (map[k].content as Uint8Array)?.length ?? 0,
    }));
  } catch {
    return [];
  }
}

function AttachmentsView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const applyToWorkingPdf = useDocument((s) => s.applyToWorkingPdf);
  const [existing, setExisting] = useState<Existing[]>([]);
  const [pending, setPending] = useState<Array<{ name: string; data: ArrayBuffer }>>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!doc) return;
    readExisting(doc.proxy).then((e) => {
      setExisting(e);
      setLoaded(true);
    });
  }, [doc]);

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  async function pick() {
    const files = await window.api.openFiles();
    if (files && files.length) setPending((p) => [...p, ...files]);
  }

  async function extract(att: Existing) {
    const ab = att.content.buffer.slice(
      att.content.byteOffset,
      att.content.byteOffset + att.content.byteLength,
    ) as ArrayBuffer;
    const saved = await window.api.saveBinary(att.name, ab);
    if (saved) toast.success('Adjunto guardado');
  }

  async function apply() {
    if (pending.length === 0) {
      toast('No hay archivos nuevos que adjuntar');
      return;
    }
    setBusy(true);
    try {
      const ok = await applyToWorkingPdf(async (pdf) => {
        await attachFilesToPdf(
          pdf,
          pending.map((f) => ({ name: f.name, data: f.data })),
        );
      });
      if (ok) {
        toast.success(`${pending.length} archivo(s) adjuntados al PDF`);
        api.close();
      } else {
        toast.error('No se pudieron adjuntar los archivos');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded border border-blue-600/20 bg-blue-50 p-3 text-sm text-blue-900">
        <Paperclip size={18} className="mt-0.5 flex-shrink-0" />
        <div>
          Incrusta archivos dentro del PDF (como adjuntos de correo). Viajan con el
          documento y aparecen en el panel de adjuntos de Acrobat.
        </div>
      </div>

      {loaded && existing.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-ink-secondary">Ya adjuntos</h4>
          <div className="space-y-1">
            {existing.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded border border-page-border px-2 py-1 text-sm">
                <FileBox size={15} className="text-ink-secondary" />
                <span className="flex-1 truncate">{a.name}</span>
                <span className="text-xs text-ink-muted">{fmtBytes(a.size)}</span>
                <button title="Guardar a disco" onClick={() => extract(a)} className="text-ink-secondary hover:text-ink">
                  <Download size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between">
          <h4 className="text-xs font-medium text-ink-secondary">Nuevos a adjuntar</h4>
          <button className="btn-secondary !py-1 !text-xs" onClick={pick}>
            <Plus size={13} />
            Añadir archivos
          </button>
        </div>
        {pending.length === 0 ? (
          <div className="rounded border border-dashed border-page-border p-3 text-center text-sm text-ink-muted">
            Ningún archivo seleccionado.
          </div>
        ) : (
          <div className="space-y-1">
            {pending.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded border border-page-border px-2 py-1 text-sm">
                <Paperclip size={14} className="text-amazon-orange" />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-ink-muted">{fmtBytes(f.data.byteLength)}</span>
                <button
                  className="text-ink-muted hover:text-red-600"
                  onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-secondary" onClick={api.close} disabled={busy}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={apply} disabled={busy || pending.length === 0}>
          <Paperclip size={15} />
          {busy ? 'Adjuntando…' : 'Adjuntar al PDF'}
        </button>
      </div>
    </div>
  );
}

export function showAttachmentsDialog() {
  openModal('Adjuntar archivos', (api) => <AttachmentsView api={api} />);
}
