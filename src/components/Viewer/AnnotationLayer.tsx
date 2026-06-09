import { useRef, useState, useCallback, useEffect } from 'react';
import { useTools } from '../../stores/tools';
import {
  useAnnotations,
  type Annotation,
  type Point,
} from '../../stores/annotations';
import { pushHistory } from '../../stores/history';

interface Props {
  pageNumber: number;
  width: number;
  height: number;
  zoom: number;
  rotation: number;
  annotations: Annotation[];
  toolActive: boolean;
}

/**
 * Converts a screen point on the rendered page to PDF user space
 * (origin bottom-left, unrotated coordinates).
 */
function screenToPdf(
  screenX: number,
  screenY: number,
  pageWidth: number,
  pageHeight: number,
  zoom: number,
  rotation: number,
): Point {
  // First normalize to "rendered" space (zoom=1)
  const rx = screenX / zoom;
  const ry = screenY / zoom;
  // Inverse rotation. The rendered viewport has rotation applied; we need
  // unrotated coordinates inside the page's natural orientation.
  const ph = rotation % 180 === 0 ? pageHeight / zoom : pageWidth / zoom;
  const pw = rotation % 180 === 0 ? pageWidth / zoom : pageHeight / zoom;
  let ux = rx;
  let uy = ry;
  switch (rotation) {
    case 0:
      ux = rx;
      uy = ph - ry;
      break;
    case 90:
      ux = ry;
      uy = rx;
      // swap
      break;
    case 180:
      ux = pw - rx;
      uy = ry;
      break;
    case 270:
      ux = pw - ry;
      uy = ph - rx;
      break;
  }
  return { x: ux, y: uy };
}

export function AnnotationLayer({
  pageNumber,
  width,
  height,
  zoom,
  rotation,
  annotations,
  toolActive,
}: Props) {
  // Specific selectors — avoid `useTools()` without selector, which
  // re-renders this layer on every unrelated tool state change.
  const toolActive2 = useTools((s) => s.active);
  const toolColor = useTools((s) => s.color);
  const toolStrokeWidth = useTools((s) => s.strokeWidth);
  const toolOpacity = useTools((s) => s.opacity);
  const toolFontSize = useTools((s) => s.fontSize);
  const toolFontFamily = useTools((s) => s.fontFamily);
  const tool = {
    active: toolActive2,
    color: toolColor,
    strokeWidth: toolStrokeWidth,
    opacity: toolOpacity,
    fontSize: toolFontSize,
    fontFamily: toolFontFamily,
  };
  const addAnnotation = useAnnotations((s) => s.add);
  const removeAnnotation = useAnnotations((s) => s.remove);
  const selectAnnotation = useAnnotations((s) => s.select);
  const updateAnnotation = useAnnotations((s) => s.update);
  const selectedId = useAnnotations((s) => s.selectedId);

  function editTextAnnotation(a: Annotation) {
    const next = prompt('Editar texto:', a.text ?? '');
    if (next === null) return;
    pushHistory();
    updateAnnotation(a.id, { text: next });
  }

  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<null | {
    start: Point;
    end: Point;
    points?: Point[];
  }>(null);

  const startInteraction = useCallback(
    (e: React.PointerEvent) => {
      if (!toolActive) return;
      if (tool.active === 'note' || tool.active === 'text') {
        const rect = svgRef.current!.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const p = screenToPdf(sx, sy, width, height, zoom, rotation);
        if (tool.active === 'text') {
          const text = prompt('Texto a insertar:');
          if (text && text.trim()) {
            pushHistory();
            addAnnotation({
              type: 'text',
              pageNumber,
              x: p.x,
              y: p.y,
              width: 200,
              height: tool.fontSize + 4,
              color: tool.color,
              opacity: 1,
              text,
              fontSize: tool.fontSize,
              fontFamily: tool.fontFamily,
            });
          }
        } else {
          const note = prompt('Contenido de la nota:');
          if (note && note.trim()) {
            pushHistory();
            addAnnotation({
              type: 'note',
              pageNumber,
              x: p.x,
              y: p.y,
              width: 24 / zoom,
              height: 24 / zoom,
              color: tool.color,
              opacity: 0.95,
              text: note,
            });
          }
        }
        return;
      }
      const rect = svgRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setDraft({ start: { x: sx, y: sy }, end: { x: sx, y: sy }, points: [{ x: sx, y: sy }] });
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [toolActive, tool, width, height, zoom, rotation, pageNumber, addAnnotation],
  );

  const moveInteraction = useCallback(
    (e: React.PointerEvent) => {
      if (!draft) return;
      const rect = svgRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setDraft((d) =>
        d
          ? {
              start: d.start,
              end: { x: sx, y: sy },
              points: d.points ? [...d.points, { x: sx, y: sy }] : undefined,
            }
          : null,
      );
    },
    [draft],
  );

  const endInteraction = useCallback(() => {
    if (!draft) return;
    const start = draft.start;
    const end = draft.end;
    const minScreen = Math.min(start.x, end.x);
    const maxScreen = Math.max(start.x, end.x);
    const minScreenY = Math.min(start.y, end.y);
    const maxScreenY = Math.max(start.y, end.y);
    if (
      Math.abs(maxScreen - minScreen) < 3 &&
      Math.abs(maxScreenY - minScreenY) < 3 &&
      tool.active !== 'draw'
    ) {
      setDraft(null);
      return;
    }
    const tl = screenToPdf(minScreen, minScreenY, width, height, zoom, rotation);
    const br = screenToPdf(maxScreen, maxScreenY, width, height, zoom, rotation);
    const x = Math.min(tl.x, br.x);
    const y = Math.min(tl.y, br.y);
    const w = Math.abs(br.x - tl.x);
    const h = Math.abs(br.y - tl.y);

    if (tool.active === 'draw' && draft.points) {
      const pts = draft.points.map((p) =>
        screenToPdf(p.x, p.y, width, height, zoom, rotation),
      );
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      pushHistory();
      addAnnotation({
        type: 'draw',
        pageNumber,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        color: tool.color,
        opacity: tool.opacity,
        strokeWidth: tool.strokeWidth,
        points: pts,
      });
    } else if (
      tool.active === 'highlight' ||
      tool.active === 'underline' ||
      tool.active === 'strikethrough'
    ) {
      pushHistory();
      addAnnotation({
        type: tool.active,
        pageNumber,
        x,
        y,
        width: w,
        height: h,
        color: tool.color,
        opacity: tool.active === 'highlight' ? 0.4 : 1,
        strokeWidth: tool.strokeWidth,
      });
    } else if (
      tool.active === 'rect' ||
      tool.active === 'circle' ||
      tool.active === 'arrow'
    ) {
      pushHistory();
      addAnnotation({
        type: tool.active,
        pageNumber,
        x,
        y,
        width: w,
        height: h,
        color: tool.color,
        opacity: tool.opacity,
        strokeWidth: tool.strokeWidth,
      });
    } else if (tool.active === 'replace-text') {
      // "Redact and replace": cover the original area with a white rectangle
      // and place a new text annotation on top. The user types the replacement
      // text; we auto-fit font size to the rectangle height.
      if (w < 4 || h < 4) {
        setDraft(null);
        return;
      }
      const newText = prompt('Texto que reemplaza esta área:');
      if (newText && newText.trim()) {
        pushHistory();
        // Filled white rectangle covering the original text (strokeWidth=0 -> filled)
        addAnnotation({
          type: 'rect',
          pageNumber,
          x: x - 1,
          y: y - 1,
          width: w + 2,
          height: h + 2,
          color: '#FFFFFF',
          opacity: 1,
          strokeWidth: 0,
        });
        // New text on top — font size scales with the box height
        const fontSize = Math.max(8, Math.min(72, h * 0.75));
        addAnnotation({
          type: 'text',
          pageNumber,
          x: x + 2,
          y: y + (h - fontSize) / 2,
          width: w,
          height: fontSize + 4,
          color: '#000000',
          opacity: 1,
          text: newText,
          fontSize,
          fontFamily: 'Helvetica',
        });
      }
    }
    setDraft(null);
  }, [draft, tool, width, height, zoom, rotation, pageNumber, addAnnotation]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore when typing in inputs
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        pushHistory();
        removeAnnotation(selectedId);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, removeAnnotation]);

  // Convert PDF-space annotation to screen-space for rendering
  function pdfToScreen(a: Annotation): { x: number; y: number; w: number; h: number } {
    const ph = rotation % 180 === 0 ? height / zoom : width / zoom;
    const pw = rotation % 180 === 0 ? width / zoom : height / zoom;
    let sx = a.x;
    let sy = a.y;
    let sw = a.width;
    let sh = a.height;
    switch (rotation) {
      case 0:
        sx = a.x;
        sy = ph - a.y - a.height;
        sw = a.width;
        sh = a.height;
        break;
      case 90:
        sx = a.y;
        sy = a.x;
        sw = a.height;
        sh = a.width;
        break;
      case 180:
        sx = pw - a.x - a.width;
        sy = a.y;
        sw = a.width;
        sh = a.height;
        break;
      case 270:
        sx = pw - a.y - a.height;
        sy = ph - a.x - a.width;
        sw = a.height;
        sh = a.width;
        break;
    }
    return {
      x: sx * zoom,
      y: sy * zoom,
      w: sw * zoom,
      h: sh * zoom,
    };
  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`annotation-layer ${toolActive ? 'active' : ''}`}
      style={{ cursor: toolActive ? 'crosshair' : 'default' }}
      onPointerDown={startInteraction}
      onPointerMove={moveInteraction}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
    >
      {/* Existing annotations */}
      {annotations.map((a) => {
        const s = pdfToScreen(a);
        const selected = a.id === selectedId;
        const stroke = selected ? '#3b82f6' : a.color;
        const strokeW = (a.strokeWidth ?? 2) * (selected ? 1.5 : 1);
        const onClick = (e: React.MouseEvent) => {
          e.stopPropagation();
          selectAnnotation(a.id);
        };
        switch (a.type) {
          case 'highlight':
            return (
              <rect
                key={a.id}
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                fill={a.color}
                opacity={a.opacity}
                onClick={onClick}
                style={{ cursor: 'pointer' }}
              />
            );
          case 'underline':
            return (
              <line
                key={a.id}
                x1={s.x}
                y1={s.y + s.h}
                x2={s.x + s.w}
                y2={s.y + s.h}
                stroke={a.color}
                strokeWidth={strokeW}
                onClick={onClick}
                style={{ cursor: 'pointer' }}
              />
            );
          case 'strikethrough':
            return (
              <line
                key={a.id}
                x1={s.x}
                y1={s.y + s.h / 2}
                x2={s.x + s.w}
                y2={s.y + s.h / 2}
                stroke={a.color}
                strokeWidth={strokeW}
                onClick={onClick}
                style={{ cursor: 'pointer' }}
              />
            );
          case 'rect': {
            const sw0 = a.strokeWidth ?? 2;
            return (
              <rect
                key={a.id}
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                fill={sw0 === 0 ? a.color : 'none'}
                stroke={sw0 === 0 ? 'none' : stroke}
                strokeWidth={sw0 === 0 ? 0 : strokeW}
                opacity={a.opacity}
                onClick={onClick}
                style={{ cursor: 'pointer' }}
              />
            );
          }
          case 'circle':
            return (
              <ellipse
                key={a.id}
                cx={s.x + s.w / 2}
                cy={s.y + s.h / 2}
                rx={s.w / 2}
                ry={s.h / 2}
                fill="none"
                stroke={stroke}
                strokeWidth={strokeW}
                opacity={a.opacity}
                onClick={onClick}
                style={{ cursor: 'pointer' }}
              />
            );
          case 'arrow': {
            const x1 = s.x;
            const y1 = s.y;
            const x2 = s.x + s.w;
            const y2 = s.y + s.h;
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const headLen = 12;
            const a1x = x2 - headLen * Math.cos(angle - Math.PI / 6);
            const a1y = y2 - headLen * Math.sin(angle - Math.PI / 6);
            const a2x = x2 - headLen * Math.cos(angle + Math.PI / 6);
            const a2y = y2 - headLen * Math.sin(angle + Math.PI / 6);
            return (
              <g key={a.id} onClick={onClick} style={{ cursor: 'pointer' }}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={stroke}
                  strokeWidth={strokeW}
                  opacity={a.opacity}
                />
                <polygon
                  points={`${x2},${y2} ${a1x},${a1y} ${a2x},${a2y}`}
                  fill={stroke}
                  opacity={a.opacity}
                />
              </g>
            );
          }
          case 'draw': {
            if (!a.points || a.points.length < 2) return null;
            const screenPoints = a.points
              .map((p) => {
                const tmp: Annotation = { ...a, x: p.x, y: p.y, width: 0, height: 0 };
                const s2 = pdfToScreen(tmp);
                return `${s2.x},${s2.y}`;
              })
              .join(' ');
            return (
              <polyline
                key={a.id}
                points={screenPoints}
                fill="none"
                stroke={stroke}
                strokeWidth={strokeW}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={a.opacity}
                onClick={onClick}
                style={{ cursor: 'pointer' }}
              />
            );
          }
          case 'text':
            return (
              <text
                key={a.id}
                x={s.x}
                y={s.y + s.h * 0.8}
                fill={a.color}
                fontSize={(a.fontSize ?? 14) * zoom}
                fontFamily={a.fontFamily ?? 'Helvetica'}
                onClick={onClick}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  editTextAnnotation(a);
                }}
                style={{ cursor: 'text', userSelect: 'none' }}
              >
                <title>Doble click para editar</title>
                {a.text}
              </text>
            );
          case 'note':
            return (
              <g
                key={a.id}
                onClick={onClick}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  editTextAnnotation(a);
                }}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={s.x}
                  y={s.y}
                  width={Math.max(24, s.w)}
                  height={Math.max(24, s.h)}
                  fill={a.color}
                  opacity={a.opacity}
                  rx={3}
                />
                <text
                  x={s.x + 6}
                  y={s.y + 18}
                  fontSize={14}
                  fill="#000"
                  fontFamily="sans-serif"
                >
                  ✎
                </text>
                <title>{a.text} (doble click para editar)</title>
              </g>
            );
          case 'image':
          case 'signature':
            if (!a.imageData) return null;
            return (
              <image
                key={a.id}
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                href={a.imageData}
                onClick={onClick}
                style={{ cursor: 'pointer' }}
              />
            );
          default:
            return null;
        }
      })}

      {/* Draft (in-progress) */}
      {draft && tool.active !== 'note' && tool.active !== 'text' && (
        <>
          {tool.active === 'draw' && draft.points && (
            <polyline
              points={draft.points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={tool.color}
              strokeWidth={tool.strokeWidth}
              strokeLinecap="round"
              opacity={tool.opacity}
            />
          )}
          {(tool.active === 'highlight') && (
            <rect
              x={Math.min(draft.start.x, draft.end.x)}
              y={Math.min(draft.start.y, draft.end.y)}
              width={Math.abs(draft.end.x - draft.start.x)}
              height={Math.abs(draft.end.y - draft.start.y)}
              fill={tool.color}
              opacity={0.4}
            />
          )}
          {(tool.active === 'rect') && (
            <rect
              x={Math.min(draft.start.x, draft.end.x)}
              y={Math.min(draft.start.y, draft.end.y)}
              width={Math.abs(draft.end.x - draft.start.x)}
              height={Math.abs(draft.end.y - draft.start.y)}
              fill="none"
              stroke={tool.color}
              strokeWidth={tool.strokeWidth}
              opacity={tool.opacity}
            />
          )}
          {tool.active === 'replace-text' && (
            <rect
              x={Math.min(draft.start.x, draft.end.x)}
              y={Math.min(draft.start.y, draft.end.y)}
              width={Math.abs(draft.end.x - draft.start.x)}
              height={Math.abs(draft.end.y - draft.start.y)}
              fill="#FF9900"
              fillOpacity={0.2}
              stroke="#FF9900"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          )}
          {tool.active === 'circle' && (
            <ellipse
              cx={(draft.start.x + draft.end.x) / 2}
              cy={(draft.start.y + draft.end.y) / 2}
              rx={Math.abs(draft.end.x - draft.start.x) / 2}
              ry={Math.abs(draft.end.y - draft.start.y) / 2}
              fill="none"
              stroke={tool.color}
              strokeWidth={tool.strokeWidth}
              opacity={tool.opacity}
            />
          )}
          {tool.active === 'arrow' && (
            <line
              x1={draft.start.x}
              y1={draft.start.y}
              x2={draft.end.x}
              y2={draft.end.y}
              stroke={tool.color}
              strokeWidth={tool.strokeWidth}
              opacity={tool.opacity}
            />
          )}
          {(tool.active === 'underline' || tool.active === 'strikethrough') && (
            <line
              x1={Math.min(draft.start.x, draft.end.x)}
              y1={
                tool.active === 'underline'
                  ? Math.max(draft.start.y, draft.end.y)
                  : (draft.start.y + draft.end.y) / 2
              }
              x2={Math.max(draft.start.x, draft.end.x)}
              y2={
                tool.active === 'underline'
                  ? Math.max(draft.start.y, draft.end.y)
                  : (draft.start.y + draft.end.y) / 2
              }
              stroke={tool.color}
              strokeWidth={tool.strokeWidth}
            />
          )}
        </>
      )}
    </svg>
  );
}
