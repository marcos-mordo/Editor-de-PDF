import { useRef, useState, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useTools } from '../../stores/tools';
import {
  useAnnotations,
  type Annotation,
  type Point,
} from '../../stores/annotations';
import { useDocument } from '../../stores/document';
import { pushHistory } from '../../stores/history';
import { showPrompt } from '../../components/Modal/prompt';

export interface TextItemData {
  str: string;
  /** PDF coords (origin bottom-left). x = baseline left, y = baseline bottom. */
  x: number;
  y: number;
  /** Width of the text item in PDF coords. */
  width: number;
  /** Height (font size approx) in PDF coords. */
  height: number;
  fontName: string;
}

interface Props {
  pageNumber: number;
  width: number;
  height: number;
  zoom: number;
  rotation: number;
  annotations: Annotation[];
  toolActive: boolean;
  textItems: TextItemData[];
  pdfPageHeight: number;
  pdfPageWidth: number;
  /** Sample the canvas around a PDF-space rect to find the background colour. */
  sampleBackgroundColor?: (
    pdfX: number,
    pdfY: number,
    pdfW: number,
    pdfH: number,
  ) => string;
}

function screenToPdf(
  screenX: number,
  screenY: number,
  pageWidth: number,
  pageHeight: number,
  zoom: number,
  rotation: number,
): Point {
  const rx = screenX / zoom;
  const ry = screenY / zoom;
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

interface InlineEdit {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  px: number;
  py: number;
  pw: number;
  ph: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  text: string;
  /** Original text when editing existing PDF text — used so save can find it in the content stream. */
  originalText?: string;
  /** "add" = new text. "edit-existing" = replace original PDF text. "edit-annotation" = modify an existing annotation. */
  mode: 'add' | 'edit-existing' | 'edit-annotation';
  annotationId?: string;
}

/**
 * Group a clicked text item with adjacent items on the same line that have
 * no large horizontal gap between them. This makes "click on a word"
 * actually select the whole word (and continuous neighbours), not just
 * a single character span — PDF text content is often very granular.
 */
/** Heuristic: extract bold/italic from a PDF font name like "Inter-Bold". */
function detectWeightStyle(fontName: string): { bold: boolean; italic: boolean } {
  const lower = (fontName || '').toLowerCase();
  return {
    bold: /bold|black|heavy|demi|semibold/.test(lower),
    italic: /italic|oblique|slant/.test(lower),
  };
}

function findTextRunAt(
  pdfX: number,
  pdfY: number,
  items: TextItemData[],
): TextItemData[] {
  // Forgiving hit test: a PDF text item's y is the BASELINE, so the glyphs
  // extend upward (cap height) and a little below (descenders). Clicking is
  // imprecise, so pad the box generously and, when several boxes overlap,
  // pick the item whose centre is nearest the click. This is the difference
  // between "I clicked the word and nothing happened" and it just working.
  let clicked: TextItemData | undefined;
  let bestDist = Infinity;
  for (const it of items) {
    if (!it.str || it.width <= 0) continue;
    const h = it.height > 0 ? it.height : 8;
    const padX = Math.max(1, h * 0.15);
    const padBelow = Math.max(2, h * 0.5); // descenders + slack
    const padAbove = Math.max(2, h * 0.4);
    const x0 = it.x - padX;
    const x1 = it.x + it.width + padX;
    const y0 = it.y - padBelow;
    const y1 = it.y + h + padAbove;
    if (pdfX >= x0 && pdfX <= x1 && pdfY >= y0 && pdfY <= y1) {
      const cx = it.x + it.width / 2;
      const cy = it.y + h / 2;
      const d = Math.hypot(pdfX - cx, pdfY - cy);
      if (d < bestDist) {
        bestDist = d;
        clicked = it;
      }
    }
  }
  if (!clicked) return [];

  // Same-line items: same baseline y (within tolerance) and same font height.
  const yTol = Math.max(1, clicked.height * 0.2);
  const hTol = Math.max(1, clicked.height * 0.3);
  const sameLine = items
    .filter(
      (it) =>
        Math.abs(it.y - clicked.y) <= yTol &&
        Math.abs(it.height - clicked.height) <= hTol,
    )
    .sort((a, b) => a.x - b.x);

  const idx = sameLine.indexOf(clicked);
  if (idx < 0) return [clicked];

  // Allowed gap between items to still consider them part of the same "run".
  // ~1.5x font height covers typical word-spacing.
  const maxGap = clicked.height * 1.5;

  let start = idx;
  let end = idx;
  while (start > 0) {
    const prev = sameLine[start - 1];
    const curr = sameLine[start];
    const gap = curr.x - (prev.x + prev.width);
    if (gap > maxGap) break;
    start--;
  }
  while (end < sameLine.length - 1) {
    const curr = sameLine[end];
    const next = sameLine[end + 1];
    const gap = next.x - (curr.x + curr.width);
    if (gap > maxGap) break;
    end++;
  }
  return sameLine.slice(start, end + 1);
}

export function AnnotationLayer({
  pageNumber,
  width,
  height,
  zoom,
  rotation,
  annotations,
  toolActive,
  textItems,
  pdfPageHeight,
  pdfPageWidth,
  sampleBackgroundColor,
}: Props) {
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

  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<null | {
    start: Point;
    end: Point;
    points?: Point[];
  }>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const inlineRef = useRef<HTMLTextAreaElement | null>(null);
  // Highlight box shown when hovering editable text with the edit-text tool,
  // so the user sees exactly what will be edited before clicking.
  const [hoverRect, setHoverRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  useEffect(() => {
    if (inlineEdit && inlineRef.current) {
      inlineRef.current.focus();
      if (inlineEdit.mode === 'add') {
        inlineRef.current.select();
      } else {
        // Place cursor at the end so user can keep typing immediately
        const len = inlineRef.current.value.length;
        inlineRef.current.setSelectionRange(len, len);
      }
    }
  }, [inlineEdit]);

  function commitInlineEdit() {
    if (!inlineEdit) return;
    const text = inlineEdit.text;
    if (text.length === 0 && inlineEdit.mode !== 'edit-annotation') {
      setInlineEdit(null);
      return;
    }

    if (inlineEdit.mode === 'edit-annotation' && inlineEdit.annotationId) {
      pushHistory();
      if (text.trim() === '') {
        removeAnnotation(inlineEdit.annotationId);
      } else {
        updateAnnotation(inlineEdit.annotationId, { text });
      }
      setInlineEdit(null);
      return;
    }

    if (inlineEdit.mode === 'edit-existing') {
      const edit = inlineEdit;
      const original = edit.originalText ?? '';
      // No real change → just close.
      if (text === original) {
        setInlineEdit(null);
        return;
      }
      setInlineEdit(null);
      // Edit the ORIGINAL PDF text directly (rewrites the content stream,
      // re-renders the real page — no overlay, no cover box).
      pushHistory();
      const t = toast.loading('Editando texto…');
      useDocument
        .getState()
        .applyTextEdit(pageNumber, original, text, {
          x: edit.px,
          y: edit.py,
          size: edit.fontSize,
          fontFamily: edit.fontFamily,
        })
        .then((ok) => {
          toast.dismiss(t);
          if (ok) {
            toast.success('Texto editado', { duration: 1200 });
          } else {
            // The engine couldn't locate/edit this text in the stream
            // (unusual encoding). Fall back to the cover approach so the
            // user's edit isn't lost, and tell them why.
            const bg = sampleBackgroundColor
              ? sampleBackgroundColor(edit.px, edit.py, edit.pw, edit.ph)
              : '#FFFFFF';
            addAnnotation({
              type: 'text-replace',
              pageNumber,
              x: edit.px,
              y: edit.py,
              width: Math.max(edit.pw, text.length * edit.fontSize * 0.55),
              height: edit.fontSize + 4,
              color: edit.color,
              opacity: 1,
              text,
              oldText: original,
              backgroundColor: bg,
              fontSize: edit.fontSize,
              fontFamily: edit.fontFamily,
            });
            toast('Texto editado (modo compatible)', { icon: 'ℹ️' });
          }
        })
        .catch(() => {
          toast.dismiss(t);
          toast.error('No se pudo editar el texto');
        });
      return;
    }

    // "add" mode → new text annotation
    pushHistory();
    addAnnotation({
      type: 'text',
      pageNumber,
      x: inlineEdit.px,
      y: inlineEdit.py,
      width: Math.max(inlineEdit.pw, 50),
      height: inlineEdit.fontSize + 4,
      color: inlineEdit.color,
      opacity: 1,
      text,
      fontSize: inlineEdit.fontSize,
      fontFamily: inlineEdit.fontFamily,
    });
    setInlineEdit(null);
  }

  function cancelInlineEdit() {
    setInlineEdit(null);
  }

  async function openEditModal(a: Annotation) {
    const next = await showPrompt({
      title: a.type === 'note' ? 'Editar nota' : 'Editar texto',
      defaultValue: a.text ?? '',
      multiline: a.type === 'note',
    });
    if (next === null) return;
    pushHistory();
    updateAnnotation(a.id, { text: next });
  }

  /** PDF-space rect → screen-space rect. */
  function pdfRectToScreen(x: number, y: number, w: number, h: number) {
    const ph = rotation % 180 === 0 ? height / zoom : width / zoom;
    const pw = rotation % 180 === 0 ? width / zoom : height / zoom;
    let sx = x;
    let sy = y;
    let sw = w;
    let sh = h;
    switch (rotation) {
      case 0:
        sx = x;
        sy = ph - y - h;
        sw = w;
        sh = h;
        break;
      case 90:
        sx = y;
        sy = x;
        sw = h;
        sh = w;
        break;
      case 180:
        sx = pw - x - w;
        sy = y;
        sw = w;
        sh = h;
        break;
      case 270:
        sx = pw - y - h;
        sy = ph - x - w;
        sw = h;
        sh = w;
        break;
    }
    return { x: sx * zoom, y: sy * zoom, w: sw * zoom, h: sh * zoom };
  }

  function startEditExistingTextAt(sx: number, sy: number) {
    const p = screenToPdf(sx, sy, width, height, zoom, rotation);
    const run = findTextRunAt(p.x, p.y, textItems);
    if (run.length === 0) return false;
    const sortedRun = [...run].sort((a, b) => a.x - b.x);
    // Compute combined bounds of the run
    const minX = Math.min(...sortedRun.map((r) => r.x));
    const maxX = Math.max(...sortedRun.map((r) => r.x + r.width));
    const minY = Math.min(...sortedRun.map((r) => r.y));
    const maxH = Math.max(...sortedRun.map((r) => r.height));
    const pw = maxX - minX;
    const ph = maxH;
    const px = minX;
    const py = minY;
    const screen = pdfRectToScreen(px, py, pw, ph);
    // Reconstruct the text preserving spaces: PDF often splits a single
    // visible line into multiple text items with no explicit space chars
    // — the gap between items IS the space. Detect that gap and put a
    // space back.
    let text = '';
    for (let i = 0; i < sortedRun.length; i++) {
      if (i > 0) {
        const prev = sortedRun[i - 1];
        const curr = sortedRun[i];
        const gap = curr.x - (prev.x + prev.width);
        const spaceWidth = Math.max(prev.height * 0.2, 1);
        if (
          gap >= spaceWidth &&
          !prev.str.endsWith(' ') &&
          !curr.str.startsWith(' ')
        ) {
          text += ' ';
        }
      }
      text += sortedRun[i].str;
    }
    // Pick the dominant font name across the run — we use this to choose a
    // matching standard font (bold/italic/serif/mono) when the content-stream
    // edit can't apply and we have to fall back to drawing on top.
    const fontFamily = sortedRun[0]?.fontName || 'Helvetica';
    setInlineEdit({
      sx: screen.x,
      sy: screen.y,
      sw: Math.max(screen.w + 40, 120),
      sh: Math.max(screen.h, 24),
      px,
      py,
      pw,
      ph,
      fontSize: maxH,
      fontFamily,
      color: '#000000',
      text,
      originalText: text,
      mode: 'edit-existing',
    });
    return true;
  }

  const startInteraction = useCallback(
    (e: React.PointerEvent) => {
      if (!toolActive) return;
      if (inlineEdit) return;
      if (e.button !== 0) return; // only left button

      const svgRect = svgRef.current!.getBoundingClientRect();
      const sx = e.clientX - svgRect.left;
      const sy = e.clientY - svgRect.top;

      if (tool.active === 'edit-text') {
        // Click on a word/run of existing PDF text → inline edit.
        if (!startEditExistingTextAt(sx, sy)) {
          // No text under cursor — show an "add text here" inline editor
          const p = screenToPdf(sx, sy, width, height, zoom, rotation);
          const fontSize = 14;
          setInlineEdit({
            sx,
            sy: sy - fontSize * zoom * 0.3,
            sw: 220,
            sh: fontSize * zoom * 1.4,
            px: p.x,
            py: p.y,
            pw: 220 / zoom,
            ph: fontSize * 1.4,
            fontSize,
            fontFamily: 'Helvetica',
            color: '#000000',
            text: '',
            mode: 'add',
          });
        }
        return;
      }

      if (tool.active === 'note') {
        const p = screenToPdf(sx, sy, width, height, zoom, rotation);
        showPrompt({
          title: 'Nueva nota',
          placeholder: 'Contenido de la nota...',
          multiline: true,
        }).then((note) => {
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
        });
        return;
      }

      if (tool.active === 'text') {
        const p = screenToPdf(sx, sy, width, height, zoom, rotation);
        const fontSize = tool.fontSize;
        setInlineEdit({
          sx,
          sy: sy - fontSize * zoom * 0.3,
          sw: 220,
          sh: fontSize * zoom * 1.4,
          px: p.x,
          py: p.y,
          pw: 220 / zoom,
          ph: fontSize * 1.4,
          fontSize,
          fontFamily: tool.fontFamily,
          color: tool.color,
          text: '',
          mode: 'add',
        });
        return;
      }

      setDraft({
        start: { x: sx, y: sy },
        end: { x: sx, y: sy },
        points: [{ x: sx, y: sy }],
      });
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [
      toolActive,
      tool,
      width,
      height,
      zoom,
      rotation,
      pageNumber,
      addAnnotation,
      inlineEdit,
      textItems,
    ],
  );

  /** Bounds (screen-space) of the editable text run under a screen point. */
  function hoverRunRect(sx: number, sy: number) {
    const p = screenToPdf(sx, sy, width, height, zoom, rotation);
    const run = findTextRunAt(p.x, p.y, textItems);
    if (run.length === 0) return null;
    const minX = Math.min(...run.map((r) => r.x));
    const maxX = Math.max(...run.map((r) => r.x + r.width));
    const minY = Math.min(...run.map((r) => r.y));
    const maxH = Math.max(...run.map((r) => r.height));
    return pdfRectToScreen(minX, minY, maxX - minX, maxH);
  }

  const moveInteraction = useCallback(
    (e: React.PointerEvent) => {
      const rect = svgRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (draft) {
        setDraft((d) =>
          d
            ? {
                start: d.start,
                end: { x: sx, y: sy },
                points: d.points ? [...d.points, { x: sx, y: sy }] : undefined,
              }
            : null,
        );
        return;
      }

      // Hover preview for the text editor.
      if (tool.active === 'edit-text' && !inlineEdit) {
        setHoverRect(hoverRunRect(sx, sy));
      } else if (hoverRect) {
        setHoverRect(null);
      }
    },
    [draft, tool.active, inlineEdit, hoverRect, textItems, width, height, zoom, rotation],
  );

  const leaveInteraction = useCallback(() => {
    if (hoverRect) setHoverRect(null);
  }, [hoverRect]);

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
    } else if (tool.active === 'eraser') {
      if (w >= 2 && h >= 2) {
        pushHistory();
        addAnnotation({
          type: 'rect',
          pageNumber,
          x,
          y,
          width: w,
          height: h,
          color: '#FFFFFF',
          opacity: 1,
          strokeWidth: 0,
        });
      }
    }
    setDraft(null);
  }, [draft, tool, width, height, zoom, rotation, pageNumber, addAnnotation]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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

  function pdfToScreen(a: Annotation): { x: number; y: number; w: number; h: number } {
    return pdfRectToScreen(a.x, a.y, a.width, a.height);
  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`annotation-layer ${toolActive ? 'active' : ''}`}
      style={{
        cursor: toolActive
          ? tool.active === 'eraser'
            ? 'cell'
            : tool.active === 'text' ||
                tool.active === 'note' ||
                tool.active === 'edit-text'
              ? 'text'
              : 'crosshair'
          : 'default',
      }}
      onPointerDown={startInteraction}
      onPointerMove={moveInteraction}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      onPointerLeave={leaveInteraction}
    >
      {/* Hover highlight: shows the editable text run under the cursor. */}
      {hoverRect && tool.active === 'edit-text' && !inlineEdit && (
        <rect
          x={hoverRect.x - 2}
          y={hoverRect.y - 2}
          width={hoverRect.w + 4}
          height={hoverRect.h + 4}
          fill="#FF9900"
          fillOpacity={0.12}
          stroke="#FF9900"
          strokeWidth={1.5}
          rx={2}
          pointerEvents="none"
        />
      )}
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
                const s2 = pdfRectToScreen(p.x, p.y, 0, 0);
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
          case 'text': {
            const ws = detectWeightStyle(a.fontFamily ?? '');
            return (
              <text
                key={a.id}
                x={s.x}
                y={s.y + s.h * 0.8}
                fill={a.color}
                fontSize={(a.fontSize ?? 14) * zoom}
                fontFamily={a.fontFamily ?? 'Helvetica'}
                fontWeight={ws.bold ? 'bold' : 'normal'}
                fontStyle={ws.italic ? 'italic' : 'normal'}
                onClick={onClick}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setInlineEdit({
                    sx: s.x,
                    sy: s.y,
                    sw: Math.max(120, s.w),
                    sh: Math.max(28, s.h),
                    px: a.x,
                    py: a.y,
                    pw: a.width,
                    ph: a.height,
                    fontSize: a.fontSize ?? 14,
                    fontFamily: a.fontFamily ?? 'Helvetica',
                    color: a.color,
                    text: a.text ?? '',
                    mode: 'edit-annotation',
                    annotationId: a.id,
                  });
                }}
                style={{ cursor: 'text', userSelect: 'none' }}
              >
                <title>Doble click para editar</title>
                {a.text}
              </text>
            );
          }
          case 'note':
            return (
              <g
                key={a.id}
                onClick={onClick}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openEditModal(a);
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
          case 'text-replace': {
            // Visual preview while viewing — the saved PDF will either
            // (a) modify the content stream directly (no cover) or
            // (b) fall back to drawing this cover + text. Either way the
            // user sees the same result on screen during editing.
            const bg = a.backgroundColor ?? '#FFFFFF';
            const wsR = detectWeightStyle(a.fontFamily ?? '');
            return (
              <g key={a.id} onClick={onClick} style={{ cursor: 'pointer' }}>
                <rect
                  x={s.x - 1}
                  y={s.y - 1}
                  width={s.w + 2}
                  height={s.h + 2}
                  fill={bg}
                  opacity={1}
                />
                <text
                  x={s.x}
                  y={s.y + s.h * 0.8}
                  fill={a.color}
                  fontSize={(a.fontSize ?? 14) * zoom}
                  fontFamily={a.fontFamily ?? 'Helvetica'}
                  fontWeight={wsR.bold ? 'bold' : 'normal'}
                  fontStyle={wsR.italic ? 'italic' : 'normal'}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setInlineEdit({
                      sx: s.x,
                      sy: s.y,
                      sw: Math.max(120, s.w),
                      sh: Math.max(28, s.h),
                      px: a.x,
                      py: a.y,
                      pw: a.width,
                      ph: a.height,
                      fontSize: a.fontSize ?? 14,
                      fontFamily: a.fontFamily ?? 'Helvetica',
                      color: a.color,
                      text: a.text ?? '',
                      originalText: a.oldText ?? a.text,
                      mode: 'edit-annotation',
                      annotationId: a.id,
                    });
                  }}
                  style={{ cursor: 'text', userSelect: 'none' }}
                >
                  <title>Doble click para editar</title>
                  {a.text}
                </text>
              </g>
            );
          }
          default:
            return null;
        }
      })}

      {draft && tool.active !== 'note' && tool.active !== 'text' && tool.active !== 'edit-text' && (
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
          {tool.active === 'highlight' && (
            <rect
              x={Math.min(draft.start.x, draft.end.x)}
              y={Math.min(draft.start.y, draft.end.y)}
              width={Math.abs(draft.end.x - draft.start.x)}
              height={Math.abs(draft.end.y - draft.start.y)}
              fill={tool.color}
              opacity={0.4}
            />
          )}
          {tool.active === 'rect' && (
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
          {tool.active === 'eraser' && (
            <rect
              x={Math.min(draft.start.x, draft.end.x)}
              y={Math.min(draft.start.y, draft.end.y)}
              width={Math.abs(draft.end.x - draft.start.x)}
              height={Math.abs(draft.end.y - draft.start.y)}
              fill="#FFFFFF"
              fillOpacity={0.7}
              stroke="#FF9900"
              strokeWidth={1.5}
              strokeDasharray="4 4"
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

      {inlineEdit && (
        <foreignObject
          x={inlineEdit.sx}
          y={inlineEdit.sy}
          width={Math.max(inlineEdit.sw, 120)}
          height={Math.max(inlineEdit.sh + 8, 32)}
          style={{ overflow: 'visible' }}
        >
          <textarea
            ref={inlineRef}
            value={inlineEdit.text}
            onChange={(e) =>
              setInlineEdit((s) => (s ? { ...s, text: e.target.value } : null))
            }
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelInlineEdit();
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitInlineEdit();
              }
            }}
            onBlur={() => commitInlineEdit()}
            placeholder={inlineEdit.mode === 'add' ? 'Escribe aquí…' : ''}
            style={{
              width: '100%',
              height: '100%',
              minHeight: 28,
              fontSize: inlineEdit.fontSize * zoom,
              fontFamily: inlineEdit.fontFamily,
              fontWeight: detectWeightStyle(inlineEdit.fontFamily).bold
                ? 'bold'
                : 'normal',
              fontStyle: detectWeightStyle(inlineEdit.fontFamily).italic
                ? 'italic'
                : 'normal',
              color: inlineEdit.color,
              background: 'rgba(255, 255, 255, 0.97)',
              border: '2px solid #FF9900',
              boxShadow: '0 0 0 4px rgba(255, 153, 0, 0.2)',
              borderRadius: 4,
              padding: '2px 4px',
              outline: 'none',
              resize: 'none',
              boxSizing: 'border-box',
              lineHeight: 1.1,
              whiteSpace: 'pre',
            }}
          />
        </foreignObject>
      )}
    </svg>
  );
}
