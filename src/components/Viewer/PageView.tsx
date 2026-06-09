import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from '../../lib/pdfjs';
import { useAnnotations, type Annotation } from '../../stores/annotations';
import { useTools } from '../../stores/tools';
import { AnnotationLayer } from './AnnotationLayer';

// Module-level stable empty array. Returning a fresh [] from a selector
// breaks React's useSyncExternalStore contract and causes a re-render
// loop (React error #185 — Maximum update depth exceeded).
const EMPTY_ANNOTATIONS: Annotation[] = [];

interface Props {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  displayIndex: number;
  rotation: number;
  zoom: number;
  onVisible: (pageDisplayIndex: number) => void;
}

export function PageView({
  pdf,
  pageNumber,
  displayIndex,
  rotation,
  zoom,
  onVisible,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const annotations = useAnnotations(
    (s) => s.byPage[pageNumber] ?? EMPTY_ANNOTATIONS,
  );
  const activeTool = useTools((s) => s.active);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel?: () => void; promise: Promise<void> } | null = null;

    (async () => {
      const page = await pdf.getPage(pageNumber);
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;

      // Canonical HiDPI pattern for PDF.js:
      // - render the viewport at scale * devicePixelRatio
      // - set canvas internal size to those pixels
      // - set CSS display size to scale (browser scales down)
      // PDF.js draws at the correct internal resolution; the GPU scales
      // back, producing crisp output even on 200-300% displays.
      const dpr = window.devicePixelRatio || 1;
      const renderScale = zoom * dpr;
      const viewport = page.getViewport({ scale: renderScale, rotation });
      const cssWidth = viewport.width / dpr;
      const cssHeight = viewport.height / dpr;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;

      try {
        const task = page.render({ canvasContext: ctx, viewport, canvas } as any);
        renderTask = task as any;
        await task.promise;
        if (cancelled) return;
        setSize({ w: cssWidth, h: cssHeight });

        // Render text layer for selection / search (positions in CSS pixels)
        const textLayer = textLayerRef.current;
        if (textLayer) {
          textLayer.innerHTML = '';
          textLayer.style.width = `${cssWidth}px`;
          textLayer.style.height = `${cssHeight}px`;
          try {
            const textContent = await page.getTextContent();
            const view = page.view;
            const pdfPageHeight = view[3] - view[1];
            for (const item of textContent.items as any[]) {
              if (!item.str) continue;
              const span = document.createElement('span');
              span.textContent = item.str;
              span.style.position = 'absolute';
              const tx = item.transform;
              const cssX = tx[4] * zoom;
              const cssY = (pdfPageHeight - tx[5]) * zoom - item.height * zoom;
              span.style.left = `${cssX}px`;
              span.style.top = `${cssY}px`;
              span.style.fontSize = `${item.height * zoom}px`;
              span.style.color = 'transparent';
              span.style.whiteSpace = 'pre';
              span.style.userSelect = 'text';
              textLayer.appendChild(span);
            }
          } catch {
            /* text content not available */
          }
        }
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error('Render error', err);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel?.();
      } catch {
        /* noop */
      }
    };
  }, [pdf, pageNumber, zoom, rotation]);

  // Visibility tracking
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.5) {
            onVisible(displayIndex);
          }
        }
      },
      { threshold: [0.5] },
    );
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [displayIndex, onVisible]);

  return (
    <div
      ref={wrapperRef}
      className="relative mx-auto my-3"
      data-page-number={pageNumber}
      data-display-index={displayIndex}
    >
      <div className="absolute -top-6 left-0 text-xs font-medium text-ink-secondary select-none">
        Página {displayIndex + 1}
        {rotation !== 0 ? ` · rot ${rotation}°` : ''}
      </div>
      <div className="relative">
        <canvas ref={canvasRef} className="pdf-page-canvas" />
        <div
          ref={textLayerRef}
          className="absolute top-0 left-0 leading-none opacity-100 pointer-events-auto"
          style={{ mixBlendMode: 'multiply' }}
        />
        {size && (
          <AnnotationLayer
            pageNumber={pageNumber}
            width={size.w}
            height={size.h}
            zoom={zoom}
            rotation={rotation}
            annotations={annotations}
            toolActive={activeTool !== 'select' && activeTool !== 'hand'}
          />
        )}
      </div>
    </div>
  );
}
