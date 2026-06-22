import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Bookmark,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  IndentIncrease,
  IndentDecrease,
} from 'lucide-react';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { applyOutline, nestByLevel } from './outline';

interface Row {
  id: string;
  title: string;
  pageIndex: number; // 0-based
  level: number;
}

let counter = 0;
const newId = () => `bm-${counter++}`;

async function readExistingOutline(proxy: any): Promise<Row[]> {
  const rows: Row[] = [];
  let raw: any[] | null = null;
  try {
    raw = await proxy.getOutline();
  } catch {
    raw = null;
  }
  if (!raw) return rows;

  async function walk(nodes: any[], level: number) {
    for (const node of nodes) {
      let pageIndex = 0;
      try {
        if (node.dest) {
          const dest =
            typeof node.dest === 'string'
              ? await proxy.getDestination(node.dest)
              : node.dest;
          if (Array.isArray(dest) && dest[0]) {
            pageIndex = await proxy.getPageIndex(dest[0]);
          }
        }
      } catch {
        /* keep 0 */
      }
      rows.push({ id: newId(), title: node.title || 'Sin título', pageIndex, level });
      if (node.items && node.items.length) await walk(node.items, level + 1);
    }
  }
  await walk(raw, 0);
  return rows;
}

function BookmarksView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const currentPage = useDocument((s) => s.currentPage);
  const applyToWorkingPdf = useDocument((s) => s.applyToWorkingPdf);
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!doc) return;
    readExistingOutline(doc.proxy).then((r) => {
      setRows(r);
      setLoaded(true);
    });
  }, [doc]);

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  const pageCount = doc.pagesOrder.length;

  function update(id: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function remove(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }
  function move(id: string, dir: -1 | 1) {
    setRows((rs) => {
      const i = rs.findIndex((r) => r.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const next = rs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function indent(id: string, delta: -1 | 1) {
    setRows((rs) =>
      rs.map((r) =>
        r.id === id ? { ...r, level: Math.max(0, Math.min(5, r.level + delta)) } : r,
      ),
    );
  }
  function addRow() {
    setRows((rs) => [
      ...rs,
      {
        id: newId(),
        title: `Marcador ${rs.length + 1}`,
        pageIndex: Math.max(0, (currentPage || 1) - 1),
        level: 0,
      },
    ]);
  }

  async function apply() {
    setBusy(true);
    try {
      const clean = rows
        .map((r) => ({
          title: r.title.trim(),
          pageIndex: Math.max(0, Math.min(pageCount - 1, r.pageIndex)),
          level: r.level,
        }))
        .filter((r) => r.title.length > 0);
      const tree = nestByLevel(clean);
      const ok = await applyToWorkingPdf((pdf) => {
        applyOutline(pdf, tree);
      });
      if (ok) {
        toast.success(
          clean.length
            ? `${clean.length} marcador(es) guardados`
            : 'Marcadores eliminados',
        );
        api.close();
      } else {
        toast.error('No se pudieron aplicar los marcadores');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded border border-amazon-orange/20 bg-amber-50 p-3 text-sm text-ink">
        <Bookmark size={18} className="mt-0.5 flex-shrink-0 text-amazon-orange" />
        <div>
          Crea y organiza los <strong>marcadores</strong> (índice navegable) del
          PDF. Usa sangría para anidar sub-marcadores. Se guardan en el documento y
          aparecen en Adobe Acrobat y cualquier lector.
        </div>
      </div>

      <div className="max-h-80 space-y-1 overflow-auto rounded border border-page-border p-2">
        {!loaded ? (
          <div className="p-3 text-sm text-ink-secondary">Cargando…</div>
        ) : rows.length === 0 ? (
          <div className="p-3 text-center text-sm text-ink-secondary">
            Sin marcadores. Pulsa “Añadir”.
          </div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="flex items-center gap-1" style={{ paddingLeft: r.level * 16 }}>
              <input
                className="input flex-1 py-1"
                value={r.title}
                onChange={(e) => update(r.id, { title: e.target.value })}
                placeholder="Título del marcador"
              />
              <span className="text-xs text-ink-secondary">pág.</span>
              <input
                type="number"
                className="input w-16 py-1 text-center"
                min={1}
                max={pageCount}
                value={r.pageIndex + 1}
                onChange={(e) => update(r.id, { pageIndex: Number(e.target.value) - 1 })}
              />
              <IconBtn title="Subir" onClick={() => move(r.id, -1)}><ChevronUp size={15} /></IconBtn>
              <IconBtn title="Bajar" onClick={() => move(r.id, 1)}><ChevronDown size={15} /></IconBtn>
              <IconBtn title="Menos sangría" onClick={() => indent(r.id, -1)}><IndentDecrease size={15} /></IconBtn>
              <IconBtn title="Más sangría" onClick={() => indent(r.id, 1)}><IndentIncrease size={15} /></IconBtn>
              <IconBtn title="Eliminar" onClick={() => remove(r.id)}><Trash2 size={15} className="text-red-600" /></IconBtn>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between">
        <button className="btn-secondary" onClick={addRow}>
          <Plus size={15} />
          Añadir (pág. {currentPage})
        </button>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={api.close} disabled={busy}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={apply} disabled={busy}>
            <Bookmark size={15} />
            {busy ? 'Guardando…' : 'Guardar marcadores'}
          </button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded text-ink-secondary hover:bg-page-alt hover:text-ink"
    >
      {children}
    </button>
  );
}

export function showBookmarksDialog() {
  openModal('Editar marcadores', (api) => <BookmarksView api={api} />, 'max-w-2xl');
}
