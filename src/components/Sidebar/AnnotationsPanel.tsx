import { Trash2 } from 'lucide-react';
import { useAnnotations } from '../../stores/annotations';
import { useDocument } from '../../stores/document';
import { pushHistory } from '../../stores/history';
import { cn } from '../../lib/utils';

const TYPE_LABEL: Record<string, string> = {
  highlight: 'Resaltado',
  underline: 'Subrayado',
  strikethrough: 'Tachado',
  rect: 'Rectángulo',
  circle: 'Elipse',
  arrow: 'Flecha',
  draw: 'Dibujo',
  text: 'Texto',
  note: 'Nota',
  image: 'Imagen',
  signature: 'Firma',
  'text-replace': 'Texto editado',
  redact: 'Redacción',
};

export function AnnotationsPanel() {
  const byPage = useAnnotations((s) => s.byPage);
  const remove = useAnnotations((s) => s.remove);
  const select = useAnnotations((s) => s.select);
  const selectedId = useAnnotations((s) => s.selectedId);
  const setCurrentPage = useDocument((s) => s.setCurrentPage);
  const doc = useDocument((s) => s.doc);

  const all = Object.entries(byPage)
    .flatMap(([page, list]) =>
      list.map((a) => ({ ...a, _pageNumber: Number(page) })),
    )
    .sort((a, b) => a._pageNumber - b._pageNumber);

  if (!doc) {
    return (
      <div className="p-4 text-center text-sm text-ink-secondary">
        Abre un PDF para gestionar anotaciones.
      </div>
    );
  }
  if (all.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-ink-secondary">
        Aún no hay anotaciones.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-2">
      {all.map((a) => {
        const displayIdx = doc.pagesOrder.indexOf(a._pageNumber);
        const displayPage = displayIdx >= 0 ? displayIdx + 1 : a._pageNumber;
        return (
          <div
            key={a.id}
            className={cn(
              'mb-1 cursor-pointer rounded border p-2 text-sm transition-colors',
              selectedId === a.id
                ? 'border-amazon-orange bg-amazon-yellow/10'
                : 'border-transparent hover:bg-page-alt',
            )}
            onClick={() => {
              select(a.id);
              if (displayIdx >= 0) setCurrentPage(displayIdx + 1);
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded border border-page-border"
                    style={{ backgroundColor: a.color }}
                  />
                  <span className="text-xs font-medium text-ink">
                    {TYPE_LABEL[a.type] ?? a.type}
                  </span>
                  <span className="text-xs text-ink-secondary">
                    pág. {displayPage}
                  </span>
                </div>
                {a.text && (
                  <p className="mt-1 truncate text-xs text-ink-secondary">{a.text}</p>
                )}
              </div>
              <button
                className="rounded p-1 text-amazon-link-hover hover:bg-red-50"
                onClick={(e) => {
                  e.stopPropagation();
                  pushHistory();
                  remove(a.id);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
