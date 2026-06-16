/**
 * TRUE redaction — unlike a white/black box drawn on top (which leaves the
 * underlying text recoverable by copy-paste or extraction), this removes the
 * text that falls inside the redaction rectangle from the page content stream
 * AND draws an opaque black box over the area.
 *
 * Approach: walk the content stream tracking the text position (same machinery
 * as the text editor), and for every show-text operator whose baseline falls
 * inside the rectangle, blank its string. Then a black rectangle is drawn by
 * the caller so the area is visually covered too.
 */
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFArray,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from 'pdf-lib';
import { tokenize, type Token } from './tokenizer';

export interface RedactRect {
  /** PDF user-space rectangle (origin bottom-left). */
  x: number;
  y: number;
  width: number;
  height: number;
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)) as any,
    );
  }
  return s;
}

function binaryStringToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function mat3Translate(m: number[], tx: number, ty: number): number[] {
  const [a, b, c, d, e, f] = m;
  return [a, b, c, d, tx * a + ty * c + e, tx * b + ty * d + f];
}

/**
 * Removes text inside the given rectangles from a page's content stream.
 * Returns the number of text operators blanked.
 */
export function removeTextInRects(
  doc: PDFDocument,
  pageIndex: number,
  rects: RedactRect[],
): number {
  if (rects.length === 0) return 0;
  const ctx = doc.context;
  const page = doc.getPage(pageIndex);
  const contentsObj = page.node.get(PDFName.of('Contents'));
  if (!contentsObj) return 0;

  // Concatenate content streams.
  const resolved = ctx.lookup(contentsObj);
  const parts: Uint8Array[] = [];
  if (resolved instanceof PDFArray) {
    for (let i = 0; i < resolved.size(); i++) {
      const s = ctx.lookup(resolved.get(i));
      if (s instanceof PDFRawStream) {
        try {
          parts.push(decodePDFRawStream(s).decode());
        } catch {
          /* skip */
        }
      }
    }
  } else if (resolved instanceof PDFRawStream) {
    try {
      parts.push(decodePDFRawStream(resolved).decode());
    } catch {
      return 0;
    }
  }
  if (parts.length === 0) return 0;

  let totalLen = 0;
  for (const p of parts) totalLen += p.length + 1;
  const joined = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) {
    joined.set(p, off);
    off += p.length;
    joined[off] = 0x0a;
    off += 1;
  }
  const content = bytesToBinaryString(joined);
  const tokens = tokenize(content);

  function inAnyRect(x: number, y: number, h: number): boolean {
    // Consider the baseline point and the cap height of the glyphs.
    for (const r of rects) {
      const within =
        x >= r.x - 1 &&
        x <= r.x + r.width + 1 &&
        y + h * 0.3 >= r.y - 1 &&
        y <= r.y + r.height + 1;
      if (within) return true;
    }
    return false;
  }

  // Walk operators tracking the text matrix; blank show-text ops inside a rect.
  let operands: Token[] = [];
  let textMatrix = [1, 0, 0, 1, 0, 0];
  let lineMatrix = [1, 0, 0, 1, 0, 0];
  let leading = 0;
  let fontSize = 0;
  const edits: { start: number; end: number; replacement: string }[] = [];

  function numAt(i: number): number {
    const t = operands[i];
    return t && t.type === 'num' && t.num !== undefined ? t.num : 0;
  }

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type !== 'op') {
      operands.push(tk);
      continue;
    }
    const op = tk.text!;
    switch (op) {
      case 'BT':
        textMatrix = [1, 0, 0, 1, 0, 0];
        lineMatrix = [1, 0, 0, 1, 0, 0];
        break;
      case 'Tf':
        if (operands.length >= 1) fontSize = numAt(operands.length - 1);
        break;
      case 'TL':
        if (operands.length >= 1) leading = numAt(operands.length - 1);
        break;
      case 'Tm':
        if (operands.length >= 6) {
          const b = operands.length - 6;
          textMatrix = [
            numAt(b),
            numAt(b + 1),
            numAt(b + 2),
            numAt(b + 3),
            numAt(b + 4),
            numAt(b + 5),
          ];
          lineMatrix = textMatrix.slice();
        }
        break;
      case 'Td':
        if (operands.length >= 2) {
          lineMatrix = mat3Translate(lineMatrix, numAt(operands.length - 2), numAt(operands.length - 1));
          textMatrix = lineMatrix.slice();
        }
        break;
      case 'TD':
        if (operands.length >= 2) {
          const ty = numAt(operands.length - 1);
          leading = -ty;
          lineMatrix = mat3Translate(lineMatrix, numAt(operands.length - 2), ty);
          textMatrix = lineMatrix.slice();
        }
        break;
      case 'T*':
        lineMatrix = mat3Translate(lineMatrix, 0, -leading);
        textMatrix = lineMatrix.slice();
        break;
      case 'Tj':
      case "'":
      case '"': {
        if (op === "'" || op === '"') {
          lineMatrix = mat3Translate(lineMatrix, 0, -leading);
          textMatrix = lineMatrix.slice();
        }
        const strTok = [...operands].reverse().find((t) => t.type === 'string');
        if (strTok && inAnyRect(textMatrix[4], textMatrix[5], fontSize || 10)) {
          edits.push({ start: strTok.start, end: tk.end, replacement: `()${op}` });
        }
        break;
      }
      case 'TJ': {
        const arrOpen = [...operands].reverse().find((t) => t.type === 'arr_open');
        if (arrOpen && inAnyRect(textMatrix[4], textMatrix[5], fontSize || 10)) {
          edits.push({ start: arrOpen.start, end: tk.end, replacement: `[]TJ` });
        }
        break;
      }
      default:
        break;
    }
    operands = [];
  }

  if (edits.length === 0) return 0;

  // Apply edits from last to first so offsets stay valid.
  edits.sort((a, b) => b.start - a.start);
  let out = content;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }

  const newBytes = binaryStringToBytes(out);
  const newDict = ctx.obj({}) as any;
  newDict.set(PDFName.of('Length'), PDFNumber.of(newBytes.length));
  const newStream = PDFRawStream.of(newDict, newBytes);
  const newRef = ctx.register(newStream);
  page.node.set(PDFName.of('Contents'), newRef);
  return edits.length;
}
