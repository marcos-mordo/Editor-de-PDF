import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from '../../lib/pdfjs';
import { useAnnotations, type Annotation } from '../../stores/annotations';
import { useTools } from '../../stores/tools';
import { AnnotationLayer, type TextItemData } from './AnnotationLayer';

const EMPTY_ANNOTATIONS: Annotation[] = [];
const EMPTY_TEXT_ITEMS: TextItemData[] = [];

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
  const [textItems, setTextItems] = useState<TextItemData[]>(EMPTY_TEXT_ITEMS);
  const [pdfPageHeight, setPdfPageHeight] = useState(0);
  const [pdfPageWidth, setPdfPageWidth] = useState(0);

  const annotations = useAnnotations(
    (s) => s.byPage[pageNumber] ?? EMPTY_ANNOTATIONS,
  );
  const activeTool = useTools((s) => s.active);

  /**
   * Samples the rendered canvas around a given PDF-space rect to find the
   * dominant background color. Used by the text editor so the "cover"
   * rectangle blends with whatever is behind the text (white, coloured
   * block, watermark, image) instead of always being plain white.
   */
  const sampleBackgroundColor = useCallback(
    (pdfX: number, pdfY: number, pdfW: number, pdfH: number): string => {
      const canvas = canvasRef.current;
      if (!canvas || pdfPageHeight <= 0) return '#FFFFFF';
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return '#FFFFFF';
      const dpr = window.devicePixelRatio || 1;
      const scale = zoom * dpr;
      const cx = Math.round(pdfX * scale);
      const cyTop = Math.round((pdfPageHeight - pdfY - pdfH) * scale);
      const cw = Math.max(1, Math.round(pdfW * scale));
      const ch = Math.max(1, Math.round(pdfH * scale));
      const samples: number[][] = [];
      function maybeSample(x: number, y: number) {
        if (x < 0 || y < 0 || x >= canvas!.width || y >= canvas!.height) return;
        try {
          const d = ctx!.getImageData(x, y, 1, 1).data;
          samples.push([d[0], d[1], d[2]]);
        } catch {
          /* tainted canvas? */
        }
      }
      const margin = Math.max(2, Math.round(ch * 0.2));
      // Eight points just outside the rect: 4 sides centred + 4 corners
      maybeSample(cx + cw / 2, cyTop - margin);
      maybeSample(cx + cw / 2, cyTop + ch + margin);
      maybeSample(cx - margin, cyTop + ch / 2);
      maybeSample(cx + cw + margin, cyTop + ch / 2);
      maybeSample(cx - margin, cyTop - margin);
      maybeSample(cx + cw + margin, cyTop - margin);
      maybeSample(cx - margin, cyTop + ch + margin);
      maybeSample(cx + cw + margin, cyTop + ch + margin);
      if (samples.length === 0) return '#FFFFFF';
      // Average the samples — close enough for solid colours and a graceful
      // degradation for textured/watermarked backgrounds.
      let r = 0,
        g = 0,
        b = 0;
      for (const s of samples) {
        r += s[0];
        g += s[1];
        b += s[2];
      }
      const n = samples.length;
      r = Math.round(r / n);
      g = Math.round(g / n);
      b = Math.round(b / n);
      const hex = (v: number) => v.toString(16).padStart(2, '0');
      return `#${hex(r)}${hex(g)}${hex(b)}`;
    },
    [zoom, pdfPageHeight],
  );

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel?: () => void; promise: Promise<void> } | null = null;

    (async () => {
      const page = await pdf.getPage(pageNumber);
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;

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

        // Render text layer + capture text items for the inline text editor.
        const textLayer = textLayerRef.current;
        if (textLayer) {
          textLayer.innerHTML = '';
          textLayer.style.width = `${cssWidth}px`;
          textLayer.style.height = `${cssHeight}px`;
          try {
            const textContent = await page.getTextContent();
            const view = page.view;
            const pdfH = view[3] - view[1];
            const pdfW = view[2] - view[0];
            const items: TextItemData[] = [];
            for (const item of textContent.items as any[]) {
              if (!item.str || !item.transform) continue;
              const span = document.createElement('span');
              span.textContent = item.str;
              span.style.position = 'absolute';
              const tx = item.transform;
              const cssX = tx[4] * zoom;
              const cssY = (pdfH - tx[5]) * zoom - item.height * zoom;
              span.style.left = `${cssX}px`;
              span.style.top = `${cssY}px`;
              span.style.fontSize = `${item.height * zoom}px`;
              span.style.color = 'transparent';
              span.style.whiteSpace = 'pre';
              span.style.userSelect = 'text';
              textLayer.appendChild(span);
              items.push({
                str: item.str,
                x: tx[4],
                y: tx[5],
                width: item.width ?? 0,
                height: item.height ?? 0,
                fontName: item.fontName ?? '',
              });
            }
            if (!cancelled) {
              setTextItems(items.length > 0 ? items : EMPTY_TEXT_ITEMS);
              setPdfPageHeight(pdfH);
              setPdfPageWidth(pdfW);
            }
          } catch {
            if (!cancelled) setTextItems(EMPTY_TEXT_ITEMS);
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
          className="absolute top-0 left-0 leading-none opacity-100"
          style={{
            mixBlendMode: 'multiply',
            pointerEvents: activeTool === 'edit-text' ? 'none' : 'auto',
          }}
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
            textItems={textItems}
            pdfPageHeight={pdfPageHeight}
            pdfPageWidth={pdfPageWidth}
            sampleBackgroundColor={sampleBackgroundColor}
          />
        )}
      </div>
    </div>
  );
}
