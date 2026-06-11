import { useEffect, useRef, useCallback, useState } from 'react';
import { useDocument } from '../../stores/document';
import { PageView } from './PageView';

interface PanState {
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
}

export function PdfViewer() {
  const doc = useDocument((s) => s.doc);
  const zoom = useDocument((s) => s.zoom);
  const setZoom = useDocument((s) => s.setZoom);
  const setCurrentPage = useDocument((s) => s.setCurrentPage);
  const containerRef = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState<PanState | null>(null);

  const onVisible = useCallback(
    (displayIndex: number) => setCurrentPage(displayIndex + 1),
    [setCurrentPage],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = 0;
  }, [doc?.id]);

  // Middle-mouse-button drag-to-pan. Works regardless of which tool is
  // selected — same UX as Photoshop / Figma / most pro editors.
  useEffect(() => {
    if (!panning) return;
    function onMove(e: MouseEvent) {
      const c = containerRef.current;
      if (!c || !panning) return;
      c.scrollLeft = panning.scrollLeft - (e.clientX - panning.startX);
      c.scrollTop = panning.scrollTop - (e.clientY - panning.startY);
    }
    function onUp() {
      setPanning(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [panning]);

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 1) return; // middle button only
    const c = containerRef.current;
    if (!c) return;
    e.preventDefault();
    setPanning({
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: c.scrollLeft,
      scrollTop: c.scrollTop,
    });
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }

  // Ctrl/Cmd + wheel = zoom in/out, centered roughly on cursor.
  function onWheel(e: React.WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom(Math.max(0.25, Math.min(5, zoom * factor)));
  }

  if (!doc) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto bg-page-alt-2 px-4 py-6"
      onMouseDown={onMouseDown}
      onWheel={onWheel}
      style={{ cursor: panning ? 'grabbing' : undefined }}
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
