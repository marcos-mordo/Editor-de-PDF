import { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { GripVertical, Plus, Trash2, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { formatBytes, generateId } from '../../lib/utils';

interface MergeFile {
  id: string;
  name: string;
  size: number;
  data: ArrayBuffer;
}

function MergeView({ api }: { api: ModalApi }) {
  const [files, setFiles] = useState<MergeFile[]>([]);
  const [busy, setBusy] = useState(false);
  const loadFromBytes = useDocument((s) => s.loadFromBytes);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  async function addFiles() {
    const opened = await window.api.openPdf({ multi: true });
    if (!opened) return;
    setFiles((prev) => [
      ...prev,
      ...opened.map((f) => ({
        id: generateId(),
        name: f.name,
        size: f.size,
        data: f.data,
      })),
    ]);
  }

  function remove(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setFiles((prev) => {
      const oldIdx = prev.findIndex((f) => f.id === active.id);
      const newIdx = prev.findIndex((f) => f.id === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  async function doMerge(openAfter: boolean) {
    if (files.length < 2) {
      toast.error('Necesitas al menos 2 PDFs');
      return;
    }
    setBusy(true);
    try {
      const out = await PDFDocument.create();
      for (const f of files) {
        const src = await PDFDocument.load(f.data, { ignoreEncryption: true });
        const indices = src.getPageIndices();
        const pages = await out.copyPages(src, indices);
        for (const p of pages) out.addPage(p);
      }
      const bytes = await out.save();
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      if (openAfter) {
        await loadFromBytes(ab, 'Combinado.pdf');
        toast.success('PDFs combinados');
        api.close();
      } else {
        const saved = await window.api.savePdf('Combinado.pdf', ab);
        if (saved) {
          toast.success('Guardado');
          api.close();
        }
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Error al combinar: ' + (e?.message ?? 'desconocido'));
    } finally {
      setBusy(false);
    }
  }

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-secondary">
        Selecciona los PDFs a combinar, ordénalos arrastrando, y guarda el resultado.
      </p>

      <button className="btn-secondary" onClick={addFiles}>
        <Plus size={16} /> Agregar PDFs
      </button>

      {files.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={files.map((f) => f.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="max-h-64 overflow-y-auto rounded border border-page-border">
              {files.map((f, i) => (
                <MergeItem key={f.id} file={f} index={i} onRemove={() => remove(f.id)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {files.length > 0 && (
        <div className="text-xs text-ink-secondary">
          {files.length} archivos · {formatBytes(totalSize)}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-ghost" onClick={api.close} disabled={busy}>
          Cancelar
        </button>
        <button
          className="btn-secondary"
          onClick={() => doMerge(true)}
          disabled={busy || files.length < 2}
        >
          Abrir resultado
        </button>
        <button
          className="btn-primary"
          onClick={() => doMerge(false)}
          disabled={busy || files.length < 2}
        >
          {busy ? 'Combinando…' : 'Combinar y guardar'}
        </button>
      </div>
    </div>
  );
}

function MergeItem({
  file,
  index,
  onRemove,
}: {
  file: MergeFile;
  index: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: file.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 border-b border-page-border px-2 py-2 last:border-b-0"
    >
      <button {...attributes} {...listeners} className="drag-handle text-ink0">
        <GripVertical size={16} />
      </button>
      <span className="w-6 text-right text-xs text-ink0">{index + 1}.</span>
      <FileText size={16} className="text-amazon-orange" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ink">{file.name}</div>
        <div className="text-xs text-ink-secondary">{formatBytes(file.size)}</div>
      </div>
      <button
        className="rounded p-1 text-amazon-link-hover hover:bg-red-50"
        onClick={onRemove}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export function showMergeDialog() {
  openModal('Combinar PDFs', (api) => <MergeView api={api} />, 'max-w-2xl');
}
