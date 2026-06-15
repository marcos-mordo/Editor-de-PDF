import { useEffect, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { pushHistory } from '../../stores/history';

interface Meta {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

function PropertiesView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const applyToWorkingPdf = useDocument((s) => s.applyToWorkingPdf);
  const [meta, setMeta] = useState<Meta>({
    title: '',
    author: '',
    subject: '',
    keywords: '',
    creator: '',
    producer: '',
  });
  const [info, setInfo] = useState<{ pages: number; size: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!doc) return;
      try {
        const pdf = await PDFDocument.load(doc.workingBytes.slice(0), {
          ignoreEncryption: true,
        });
        setMeta({
          title: pdf.getTitle() ?? '',
          author: pdf.getAuthor() ?? '',
          subject: pdf.getSubject() ?? '',
          keywords: pdf.getKeywords() ?? '',
          creator: pdf.getCreator() ?? '',
          producer: pdf.getProducer() ?? '',
        });
        const kb = doc.workingBytes.byteLength / 1024;
        setInfo({
          pages: pdf.getPageCount(),
          size: kb > 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${Math.round(kb)} KB`,
        });
      } catch (e) {
        console.error(e);
      }
    })();
  }, [doc]);

  async function save(sanitize: boolean) {
    if (!doc) return;
    setBusy(true);
    try {
      pushHistory();
      const ok = await applyToWorkingPdf((pdf) => {
        if (sanitize) {
          pdf.setTitle('');
          pdf.setAuthor('');
          pdf.setSubject('');
          pdf.setKeywords([]);
          pdf.setCreator('');
          pdf.setProducer('');
        } else {
          pdf.setTitle(meta.title);
          pdf.setAuthor(meta.author);
          pdf.setSubject(meta.subject);
          pdf.setKeywords(
            meta.keywords
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean),
          );
          pdf.setCreator(meta.creator);
          pdf.setProducer(meta.producer);
        }
      });
      if (ok) {
        toast.success(sanitize ? 'Metadatos eliminados' : 'Propiedades guardadas');
        api.close();
      } else {
        toast.error('No se pudo aplicar');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  const field = (
    label: string,
    key: keyof Meta,
    placeholder = '',
  ) => (
    <div>
      <label className="mb-1 block text-xs text-ink-secondary">{label}</label>
      <input
        className="input"
        value={meta[key]}
        placeholder={placeholder}
        onChange={(e) => setMeta((m) => ({ ...m, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {info && (
        <div className="flex gap-4 rounded border border-page-border bg-page-alt px-3 py-2 text-xs text-ink-secondary">
          <span>
            <strong className="text-ink">{info.pages}</strong> páginas
          </span>
          <span>
            Tamaño: <strong className="text-ink">{info.size}</strong>
          </span>
          <span className="truncate">
            Archivo: <strong className="text-ink">{doc.name}</strong>
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {field('Título', 'title')}
        {field('Autor', 'author')}
        {field('Asunto', 'subject')}
        {field('Palabras clave', 'keywords', 'separadas, por, comas')}
        {field('Creador', 'creator')}
        {field('Productor', 'producer')}
      </div>

      <div className="flex items-center justify-between border-t border-page-border pt-3">
        <button
          className="btn-secondary text-amazon-link-hover"
          onClick={() => save(true)}
          disabled={busy}
          title="Elimina todos los metadatos (privacidad)"
        >
          <Trash2 size={14} />
          Eliminar todos los metadatos
        </button>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={api.close} disabled={busy}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={() => save(false)} disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar propiedades'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function showPropertiesDialog() {
  openModal('Propiedades del documento', (api) => <PropertiesView api={api} />, 'max-w-xl');
}
