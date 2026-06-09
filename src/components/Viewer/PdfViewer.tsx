import { useEffect, useRef, useCallback } from 'react';
import { useDocument } from '../../stores/document';
import { PageView } from './PageView';

export function PdfViewer() {
  const doc = useDocument((s) => s.doc);
  const zoom = useDocument((s) => s.zoom);
  const setCurrentPage = useDocument((s) => s.setCurrentPage);
  const containerRef = useRef<HTMLDivElement>(null);

  const onVisible = useCallback(
    (displayIndex: number) => setCurrentPage(displayIndex + 1),
    [setCurrentPage],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = 0;
  }, [doc?.id]);

  if (!doc) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto bg-page-alt-2 px-4 py-6"
    >
      <div className="flex flex-col items-center">
        {doc.pagesOrder.map((pageNumber, idx) => (
          <PageView
            key={`${doc.id}-${pageNumber}-${idx}`}
            pdf={doc.proxy}
            pageNumber={pageNumber}
            displayIndex={idx}
            rotation={doc.pageRotations[pageNumber] ?? 0}
            zoom={zoom}
            onVisible={onVisible}
          />
        ))}
      </div>
    </div>
  );
}
