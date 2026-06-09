import { useEffect, useState } from 'react';
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
import { RotateCw, Trash2 } from 'lucide-react';
import { useDocument } from '../../stores/document';
import { pushHistory } from '../../stores/history';
import { cn } from '../../lib/utils';

export function ThumbnailsPanel() {
  const doc = useDocument((s) => s.doc);
  const currentPage = useDocument((s) => s.currentPage);
  const setCurrentPage = useDocument((s) => s.setCurrentPage);
  const reorderPages = useDocument((s) => s.reorderPages);
  const rotatePage = useDocument((s) => s.rotatePage);
  const deletePages = useDocument((s) => s.deletePages);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-ink-secondary">
        Abre un PDF para ver sus páginas.
      </div>
    );
  }

  const ids = doc.pagesOrder.map((p, i) => `${p}-${i}`);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(doc!.pagesOrder, oldIndex, newIndex);
    pushHistory();
    reorderPages(next);
  }

  return (
    <div className="h-full overflow-y-auto p-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {doc.pagesOrder.map((pageNumber, idx) => (
            <ThumbnailItem
              key={`${pageNumber}-${idx}`}
              id={`${pageNumber}-${idx}`}
              pageNumber={pageNumber}
              displayIndex={idx}
              rotation={doc.pageRotations[pageNumber] ?? 0}
              isActive={currentPage === idx + 1}
              onClick={() => setCurrentPage(idx + 1)}
              onRotate={() => {
                pushHistory();
                rotatePage(pageNumber, 90);
              }}
              onDelete={() => {
                if (doc.pagesOrder.length === 1) {
                  alert('No puedes eliminar la última página.');
                  return;
                }
                if (confirm(`¿Eliminar página ${idx + 1}?`)) {
                  pushHistory();
                  deletePages([pageNumber]);
                }
              }}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface ItemProps {
  id: string;
  pageNumber: number;
  displayIndex: number;
  rotation: number;
  isActive: boolean;
  onClick: () => void;
  onRotate: () => void;
  onDelete: () => void;
}

function ThumbnailItem({
  id,
  pageNumber,
  displayIndex,
  rotation,
  isActive,
  onClick,
  onRotate,
  onDelete,
}: ItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const doc = useDocument((s) => s.doc);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!doc) return;
      const page = await doc.proxy.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 0.25, rotation });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
      if (cancelled) return;
      setThumbUrl(canvas.toDataURL('image/png'));
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, rotation]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative mb-2 cursor-pointer rounded border-2 p-1 transition-colors',
        isActive
          ? 'border-amazon-orange bg-amazon-yellow/10'
          : 'border-transparent hover:bg-page-alt',
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <div
          {...attributes}
          {...listeners}
          className="drag-handle flex h-full items-center px-1 text-ink-muted"
          onClick={(e) => e.stopPropagation()}
        >
          ⋮⋮
        </div>
        <div className="flex-1">
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={`Página ${displayIndex + 1}`}
              className="w-full rounded border border-page-border bg-white"
            />
          ) : (
            <div className="aspect-[1/1.4] w-full animate-pulse rounded bg-page-alt" />
          )}
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs font-medium text-ink-secondary">
              {displayIndex + 1}
            </span>
            <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                className="rounded p-1 text-ink-secondary hover:bg-page-alt-2 hover:text-ink"
                onClick={(e) => {
                  e.stopPropagation();
                  onRotate();
                }}
                title="Rotar 90°"
              >
                <RotateCw size={13} />
              </button>
              <button
                className="rounded p-1 text-amazon-link-hover hover:bg-red-50"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                title="Eliminar"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
