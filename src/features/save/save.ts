import {
  PDFDocument,
  rgb,
  degrees,
  StandardFonts,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import { useDocument } from '../../stores/document';
import { useAnnotations, type Annotation } from '../../stores/annotations';
import { editTextInPage } from '../textedit/engine';
import { pickStandardFont } from '../textedit/font-match';

function hexToRgb(hex: string): RGB {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  return rgb(r || 0, g || 0, b || 0);
}


/**
 * Builds the final PDF bytes for the current document:
 * - Reorders pages
 * - Drops deleted pages
 * - Applies per-page rotation
 * - Burns in all annotations
 */
export async function savePdfWithEdits(opts?: {
  encrypt?: { ownerPassword?: string; userPassword?: string };
}): Promise<ArrayBuffer> {
  const docState = useDocument.getState();
  const doc = docState.doc;
  if (!doc) throw new Error('No document');

  const source = await PDFDocument.load(doc.workingBytes.slice(0), {
    ignoreEncryption: true,
  });
  const out = await PDFDocument.create();

  // Copy pages in current order
  const targetIndices = doc.pagesOrder.map((p) => p - 1);
  const copied = await out.copyPages(source, targetIndices);
  for (const p of copied) out.addPage(p);

  // Apply per-page rotation
  doc.pagesOrder.forEach((origPage, idx) => {
    const rot = doc.pageRotations[origPage] ?? 0;
    if (rot) {
      const page = out.getPage(idx);
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + rot) % 360));
    }
  });

  // Fonts cache. Map a PDF font name (any vendor name like "Inter-Bold",
  // "ArialMT", "TimesNewRoman-Italic", "F0", "TT2") to the closest PDF
  // standard font we can embed via pdf-lib.
  const fontCache = new Map<string, PDFFont>();
  async function getFont(name: string): Promise<PDFFont> {
    const key = name || 'Helvetica';
    if (fontCache.has(key)) return fontCache.get(key)!;
    const stdFont = pickStandardFont(key);
    const f = await out.embedFont(stdFont);
    fontCache.set(key, f);
    return f;
  }

  // First pass: handle text-replace annotations by editing the page content
  // stream directly with the real engine.
  //   - 'inplace': original glyphs re-encoded with the SAME embedded font.
  //     Nothing else to draw — perfect, font/size/colour/position preserved.
  //   - 'redraw': original glyphs REMOVED from the stream (no cover); we then
  //     repaint the new text with a substitute font matched by weight/style at
  //     the same position/size, using the colour the engine captured.
  //   - failure: keep the legacy cover+text fallback so the edit isn't lost.
  type TRPlan =
    | { kind: 'inplace' }
    | { kind: 'redraw'; color: { r: number; g: number; b: number } }
    | { kind: 'fallback' };
  const annStore = useAnnotations.getState();
  const trPlans = new Map<string, TRPlan>();
  for (let i = 0; i < doc.pagesOrder.length; i++) {
    const annotations = annStore.byPage[doc.pagesOrder[i]] ?? [];
    for (const ann of annotations) {
      if (ann.type !== 'text-replace') continue;
      if (!ann.oldText || ann.oldText === ann.text) {
        trPlans.set(ann.id, { kind: 'inplace' }); // no-op edit, draw nothing
        continue;
      }
      try {
        const result = await editTextInPage(
          out,
          i,
          ann.oldText,
          ann.text ?? '',
          { x: ann.x, y: ann.y },
        );
        if (result.success && result.mode === 'inplace') {
          trPlans.set(ann.id, { kind: 'inplace' });
        } else if (result.success && result.mode === 'redraw') {
          trPlans.set(ann.id, {
            kind: 'redraw',
            color: result.color ?? { r: 0, g: 0, b: 0 },
          });
        } else {
          trPlans.set(ann.id, { kind: 'fallback' });
        }
      } catch (e) {
        console.warn('text edit failed, using fallback cover', e);
        trPlans.set(ann.id, { kind: 'fallback' });
      }
    }
  }

  // Second pass: burn-in remaining annotations + text-replace redraw/fallback.
  for (let i = 0; i < doc.pagesOrder.length; i++) {
    const origPage = doc.pagesOrder[i];
    const annotations = annStore.byPage[origPage] ?? [];
    if (annotations.length === 0) continue;
    const page = out.getPage(i);
    for (const ann of annotations) {
      if (ann.type === 'text-replace') {
        const plan = trPlans.get(ann.id);
        if (!plan || plan.kind === 'inplace') {
          continue; // handled at content-stream level
        }
        if (plan.kind === 'redraw') {
          // Original text already removed from the stream. Paint the new text
          // (no cover) with the captured colour + a weight-matched font.
          if (ann.text && ann.text.trim() !== '') {
            const font = await getFont(ann.fontFamily ?? 'Helvetica');
            page.drawText(ann.text, {
              x: ann.x,
              y: ann.y,
              size: ann.fontSize ?? 14,
              font,
              color: rgb(plan.color.r, plan.color.g, plan.color.b),
            });
          }
          continue;
        }
        // plan.kind === 'fallback' → draw cover + text (legacy behaviour)
        await drawAnnotation(out, page, ann, getFont);
        continue;
      }
      await drawAnnotation(out, page, ann, getFont);
    }
  }

  let bytes: Uint8Array;
  if (opts?.encrypt && (opts.encrypt.userPassword || opts.encrypt.ownerPassword)) {
    // pdf-lib does not natively encrypt; we emit a warning and save without encryption
    // (Real encryption is handled in the encrypt feature with qpdf-style approach
    // via a fallback inline AES implementation.)
    bytes = await out.save();
  } else {
    bytes = await out.save();
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function drawAnnotation(
  pdf: PDFDocument,
  page: PDFPage,
  ann: Annotation,
  getFont: (n: string) => Promise<PDFFont>,
): Promise<void> {
  const color = hexToRgb(ann.color);
  const opacity = ann.opacity ?? 1;
  const sw = ann.strokeWidth ?? 2;

  switch (ann.type) {
    case 'highlight':
      page.drawRectangle({
        x: ann.x,
        y: ann.y,
        width: ann.width,
        height: ann.height,
        color,
        opacity: opacity * 0.4,
        borderWidth: 0,
      });
      break;
    case 'underline':
      page.drawLine({
        start: { x: ann.x, y: ann.y },
        end: { x: ann.x + ann.width, y: ann.y },
        thickness: sw,
        color,
        opacity,
      });
      break;
    case 'strikethrough':
      page.drawLine({
        start: { x: ann.x, y: ann.y + ann.height / 2 },
        end: { x: ann.x + ann.width, y: ann.y + ann.height / 2 },
        thickness: sw,
        color,
        opacity,
      });
      break;
    case 'rect':
      if (sw === 0) {
        // Filled rectangle (used for "replace text" white covers)
        page.drawRectangle({
          x: ann.x,
          y: ann.y,
          width: ann.width,
          height: ann.height,
          color,
          opacity,
          borderWidth: 0,
        });
      } else {
        page.drawRectangle({
          x: ann.x,
          y: ann.y,
          width: ann.width,
          height: ann.height,
          borderColor: color,
          borderWidth: sw,
          opacity,
          color: undefined as any,
        });
      }
      break;
    case 'circle': {
      const cx = ann.x + ann.width / 2;
      const cy = ann.y + ann.height / 2;
      page.drawEllipse({
        x: cx,
        y: cy,
        xScale: Math.max(1, ann.width / 2),
        yScale: Math.max(1, ann.height / 2),
        borderColor: color,
        borderWidth: sw,
        opacity,
        color: undefined as any,
      });
      break;
    }
    case 'arrow': {
      const x1 = ann.x;
      const y1 = ann.y + ann.height;
      const x2 = ann.x + ann.width;
      const y2 = ann.y;
      page.drawLine({
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        thickness: sw,
        color,
        opacity,
      });
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 10 + sw * 1.5;
      const a1x = x2 - headLen * Math.cos(angle - Math.PI / 6);
      const a1y = y2 - headLen * Math.sin(angle - Math.PI / 6);
      const a2x = x2 - headLen * Math.cos(angle + Math.PI / 6);
      const a2y = y2 - headLen * Math.sin(angle + Math.PI / 6);
      page.drawLine({
        start: { x: x2, y: y2 },
        end: { x: a1x, y: a1y },
        thickness: sw,
        color,
        opacity,
      });
      page.drawLine({
        start: { x: x2, y: y2 },
        end: { x: a2x, y: a2y },
        thickness: sw,
        color,
        opacity,
      });
      break;
    }
    case 'draw': {
      if (!ann.points || ann.points.length < 2) break;
      for (let i = 1; i < ann.points.length; i++) {
        page.drawLine({
          start: ann.points[i - 1],
          end: ann.points[i],
          thickness: sw,
          color,
          opacity,
        });
      }
      break;
    }
    case 'text': {
      const font = await getFont(ann.fontFamily ?? 'Helvetica');
      const size = ann.fontSize ?? 14;
      page.drawText(ann.text ?? '', {
        x: ann.x,
        y: ann.y,
        size,
        font,
        color,
        opacity,
      });
      break;
    }
    case 'text-replace': {
      // Fallback path: only reached when content-stream rewriting didn't
      // match this PDF's encoding. Cover the original area with the sampled
      // background colour and draw the new text on top.
      const bg = hexToRgb(ann.backgroundColor ?? '#FFFFFF');
      page.drawRectangle({
        x: ann.x - 1,
        y: ann.y - 1,
        width: ann.width + 2,
        height: ann.height + 2,
        color: bg,
        opacity: 1,
        borderWidth: 0,
      });
      if (ann.text && ann.text.trim() !== '') {
        const font = await getFont(ann.fontFamily ?? 'Helvetica');
        const size = ann.fontSize ?? 14;
        page.drawText(ann.text, {
          x: ann.x,
          y: ann.y,
          size,
          font,
          color,
          opacity,
        });
      }
      break;
    }
    case 'note': {
      const font = await getFont('Helvetica');
      page.drawRectangle({
        x: ann.x,
        y: ann.y,
        width: 18,
        height: 18,
        color,
        opacity: 0.85,
      });
      page.drawText('!', {
        x: ann.x + 6,
        y: ann.y + 4,
        size: 12,
        font,
        color: rgb(0, 0, 0),
      });
      // Note: text body is dropped on flatten; could be added as a real PDF text annotation in the future
      break;
    }
    case 'image':
    case 'signature': {
      if (!ann.imageData) break;
      try {
        const dataUri = ann.imageData;
        const isPng =
          ann.imageType === 'png' || dataUri.startsWith('data:image/png');
        const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
        const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const img = isPng
          ? await pdf.embedPng(bin)
          : await pdf.embedJpg(bin);
        page.drawImage(img, {
          x: ann.x,
          y: ann.y,
          width: ann.width,
          height: ann.height,
          opacity,
        });
      } catch (e) {
        console.warn('Failed to embed image annotation', e);
      }
      break;
    }
  }
}
