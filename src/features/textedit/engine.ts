/**
 * The real text-editing engine.
 *
 * Given a pdf-lib document, a page index, the original visible text and the
 * new text, this:
 *   1. Reads the page's font resources and parses each font's ToUnicode CMap.
 *   2. Tokenizes the page content stream.
 *   3. Walks the operators tracking the active font, fill colour and text
 *      position — exactly the state a PDF viewer uses to paint glyphs.
 *   4. Decodes every text-showing operator to Unicode and locates the run
 *      the user edited.
 *   5a. If the new text can be encoded with the SAME embedded font (all glyphs
 *       present in the subset) it rewrites the operator's bytes in place — the
 *       original font, size, colour and position are preserved exactly. No
 *       overlay, no cover.
 *   5b. Otherwise it DELETES the original glyphs from the stream and reports
 *       the captured colour so the caller can repaint the new text with a
 *       fully-embedded standard font matched by weight/style, at the same
 *       position and size. Still no cover rectangle — the original text is
 *       genuinely removed.
 */

import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFRawStream,
  PDFRef,
  PDFNumber,
  decodePDFRawStream,
} from 'pdf-lib';
import {
  parseToUnicodeCMap,
  decodeBytes,
  encodeText,
  type FontCMap,
} from './cmap';
import { tokenize, type Token } from './tokenizer';

export interface EditResult {
  success: boolean;
  /** How the edit was applied. */
  mode?: 'inplace' | 'redraw';
  /** For 'redraw': the original fill colour (0..1 RGB) to repaint with. */
  color?: { r: number; g: number; b: number };
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

/** A CMap that maps single bytes 0x00–0xFF to Latin-1 chars (identity). */
function identityLatin1CMap(codeBytes: number): FontCMap {
  const decode = new Map<number, string>();
  const encode = new Map<string, number>();
  for (let i = 0; i < 256; i++) {
    const ch = String.fromCharCode(i);
    decode.set(i, ch);
    if (!encode.has(ch)) encode.set(ch, i);
  }
  return { codeBytes, decode, encode };
}

/** Resolve the page's /Resources, walking up the page tree if inherited. */
function getResources(
  doc: PDFDocument,
  pageIndex: number,
): PDFDict | undefined {
  const ctx = doc.context;
  let node: PDFDict | undefined = doc.getPage(pageIndex).node;
  let guard = 0;
  while (node && guard++ < 16) {
    const res = node.get(PDFName.of('Resources'));
    if (res) {
      const looked = ctx.lookup(res);
      if (looked instanceof PDFDict) return looked;
    }
    const parent = node.get(PDFName.of('Parent'));
    node = parent ? (ctx.lookup(parent) as PDFDict) : undefined;
  }
  return undefined;
}

/** Build fontName -> CMap for every font in the page resources. */
function buildFontMaps(
  doc: PDFDocument,
  pageIndex: number,
): Map<string, FontCMap> {
  const ctx = doc.context;
  const maps = new Map<string, FontCMap>();
  const resources = getResources(doc, pageIndex);
  if (!resources) return maps;
  const fontsObj = resources.get(PDFName.of('Font'));
  if (!fontsObj) return maps;
  const fontDict = ctx.lookup(fontsObj);
  if (!(fontDict instanceof PDFDict)) return maps;

  for (const [key, value] of fontDict.entries()) {
    const name = key.asString().replace(/^\//, '');
    try {
      const font = ctx.lookup(value);
      if (!(font instanceof PDFDict)) continue;
      const subtypeObj = font.get(PDFName.of('Subtype'));
      const subtype =
        subtypeObj instanceof PDFName ? subtypeObj.asString() : '';
      const isType0 = subtype.includes('Type0');

      const toUni = font.get(PDFName.of('ToUnicode'));
      if (toUni) {
        const stream = ctx.lookup(toUni);
        if (stream instanceof PDFRawStream) {
          const text = bytesToBinaryString(
            decodePDFRawStream(stream).decode(),
          );
          const cmap = parseToUnicodeCMap(text);
          // If the codespace didn't reveal a width but the font is Type0,
          // default to 2-byte codes (Identity-H).
          if (isType0 && cmap.codeBytes < 2) cmap.codeBytes = 2;
          maps.set(name, cmap);
          continue;
        }
      }
      // No ToUnicode: assume identity Latin-1 for simple fonts (works for
      // WinAnsi-encoded Word/browser PDFs). Type0 without ToUnicode is rare
      // and not reliably decodable, but we register a 2-byte identity so the
      // walk doesn't crash.
      maps.set(name, identityLatin1CMap(isType0 ? 2 : 1));
    } catch {
      maps.set(name, identityLatin1CMap(1));
    }
  }
  return maps;
}

interface ShowOp {
  /** Index of the operator token. */
  opIndex: number;
  /** Operator: Tj, TJ, ' or " */
  operator: string;
  /** Region [start, end) covering the operand(s) + operator, for replacement. */
  regionStart: number;
  regionEnd: number;
  /** The string token(s) that make up the shown text. */
  stringTokens: Token[];
  /** Decoded Unicode text. */
  text: string;
  /** Active font resource name. */
  fontName: string;
  /** Active fill colour (0..1 RGB). */
  color: { r: number; g: number; b: number };
  /** Approx text-space origin (translation of the text matrix). */
  tx: number;
  ty: number;
}

function mat3Translate(
  m: number[],
  tx: number,
  ty: number,
): number[] {
  // [1 0 0 1 tx ty] x m  (row-vector convention)
  const [a, b, c, d, e, f] = m;
  return [a, b, c, d, tx * a + ty * c + e, tx * b + ty * d + f];
}

export async function editTextInPage(
  doc: PDFDocument,
  pageIndex: number,
  oldText: string,
  newText: string,
  near?: { x: number; y: number },
): Promise<EditResult> {
  if (!oldText) return { success: false };

  const ctx = doc.context;
  const page = doc.getPage(pageIndex);
  const contentsObj = page.node.get(PDFName.of('Contents'));
  if (!contentsObj) return { success: false };

  // Concatenate all content streams into one binary string.
  const resolved = ctx.lookup(contentsObj);
  const parts: Uint8Array[] = [];
  if (resolved instanceof PDFArray) {
    for (let i = 0; i < resolved.size(); i++) {
      const s = ctx.lookup(resolved.get(i));
      if (s instanceof PDFRawStream) {
        try {
          parts.push(decodePDFRawStream(s).decode());
        } catch {
          /* skip undecodable part */
        }
      }
    }
  } else if (resolved instanceof PDFRawStream) {
    try {
      parts.push(decodePDFRawStream(resolved).decode());
    } catch {
      return { success: false };
    }
  }
  if (parts.length === 0) return { success: false };

  // Join parts with a newline (logical concatenation per PDF spec).
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

  const fonts = buildFontMaps(doc, pageIndex);
  const tokens = tokenize(content);

  // --- Walk operators tracking graphics state ---
  let operands: Token[] = [];
  let fillColor = { r: 0, g: 0, b: 0 };
  let currentFont = '';
  let textMatrix = [1, 0, 0, 1, 0, 0];
  let lineMatrix = [1, 0, 0, 1, 0, 0];
  let leading = 0;
  const showOps: ShowOp[] = [];

  function numAt(idx: number): number {
    const t = operands[idx];
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
      case 'rg': {
        if (operands.length >= 3) {
          fillColor = {
            r: numAt(operands.length - 3),
            g: numAt(operands.length - 2),
            b: numAt(operands.length - 1),
          };
        }
        break;
      }
      case 'g': {
        if (operands.length >= 1) {
          const v = numAt(operands.length - 1);
          fillColor = { r: v, g: v, b: v };
        }
        break;
      }
      case 'k': {
        if (operands.length >= 4) {
          const c = numAt(operands.length - 4);
          const m = numAt(operands.length - 3);
          const y = numAt(operands.length - 2);
          const kk = numAt(operands.length - 1);
          fillColor = {
            r: (1 - c) * (1 - kk),
            g: (1 - m) * (1 - kk),
            b: (1 - y) * (1 - kk),
          };
        }
        break;
      }
      case 'Tf': {
        // /Font size Tf
        const nameTok = operands.find((t) => t.type === 'name');
        if (nameTok) currentFont = nameTok.text!;
        break;
      }
      case 'TL': {
        if (operands.length >= 1) leading = numAt(operands.length - 1);
        break;
      }
      case 'BT': {
        textMatrix = [1, 0, 0, 1, 0, 0];
        lineMatrix = [1, 0, 0, 1, 0, 0];
        break;
      }
      case 'Tm': {
        if (operands.length >= 6) {
          const base = operands.length - 6;
          textMatrix = [
            numAt(base),
            numAt(base + 1),
            numAt(base + 2),
            numAt(base + 3),
            numAt(base + 4),
            numAt(base + 5),
          ];
          lineMatrix = textMatrix.slice();
        }
        break;
      }
      case 'Td': {
        if (operands.length >= 2) {
          lineMatrix = mat3Translate(
            lineMatrix,
            numAt(operands.length - 2),
            numAt(operands.length - 1),
          );
          textMatrix = lineMatrix.slice();
        }
        break;
      }
      case 'TD': {
        if (operands.length >= 2) {
          const ty = numAt(operands.length - 1);
          leading = -ty;
          lineMatrix = mat3Translate(
            lineMatrix,
            numAt(operands.length - 2),
            ty,
          );
          textMatrix = lineMatrix.slice();
        }
        break;
      }
      case 'T*': {
        lineMatrix = mat3Translate(lineMatrix, 0, -leading);
        textMatrix = lineMatrix.slice();
        break;
      }
      case 'Tj':
      case "'":
      case '"': {
        // ' and " also move to next line first
        if (op === "'" || op === '"') {
          lineMatrix = mat3Translate(lineMatrix, 0, -leading);
          textMatrix = lineMatrix.slice();
        }
        const strTok = [...operands].reverse().find((t) => t.type === 'string');
        if (strTok) {
          const cmap = fonts.get(currentFont) ?? identityLatin1CMap(1);
          const { text } = decodeBytes(strTok.bytes ?? [], cmap);
          // region = from string token start to operator end
          showOps.push({
            opIndex: i,
            operator: op,
            regionStart: strTok.start,
            regionEnd: tk.end,
            stringTokens: [strTok],
            text,
            fontName: currentFont,
            color: { ...fillColor },
            tx: textMatrix[4],
            ty: textMatrix[5],
          });
        }
        break;
      }
      case 'TJ': {
        // operands include an array of strings/numbers between arr_open/close
        const arrOpen = [...operands].reverse().find((t) => t.type === 'arr_open');
        const strs = operands.filter((t) => t.type === 'string');
        if (arrOpen && strs.length > 0) {
          const cmap = fonts.get(currentFont) ?? identityLatin1CMap(1);
          let text = '';
          for (const st of strs) {
            text += decodeBytes(st.bytes ?? [], cmap).text;
          }
          showOps.push({
            opIndex: i,
            operator: 'TJ',
            regionStart: arrOpen.start,
            regionEnd: tk.end,
            stringTokens: strs,
            text,
            fontName: currentFont,
            color: { ...fillColor },
            tx: textMatrix[4],
            ty: textMatrix[5],
          });
        }
        break;
      }
      default:
        break;
    }
    operands = [];
  }

  // --- Find the show op(s) matching oldText ---
  const wanted = oldText;
  const wantedNoSpace = oldText.replace(/\s+/g, '');

  // Score candidates: prefer exact text match, then position proximity.
  interface Candidate {
    ops: ShowOp[];
    exact: boolean;
  }
  const candidates: Candidate[] = [];
  for (const sop of showOps) {
    const t = sop.text;
    if (t === wanted || t.replace(/\s+/g, '') === wantedNoSpace) {
      candidates.push({ ops: [sop], exact: true });
    } else if (t.includes(wanted) || t.replace(/\s+/g, '').includes(wantedNoSpace)) {
      candidates.push({ ops: [sop], exact: false });
    }
  }

  if (candidates.length === 0) return { success: false };

  // Pick the candidate nearest the click position (if provided).
  let chosen = candidates[0];
  if (near) {
    let best = Infinity;
    for (const c of candidates) {
      const op = c.ops[0];
      const d = Math.hypot(op.tx - near.x, op.ty - near.y);
      if (d < best) {
        best = d;
        chosen = c;
      }
    }
  } else {
    const exact = candidates.find((c) => c.exact);
    if (exact) chosen = exact;
  }

  const targetOp = chosen.ops[0];
  const cmap = fonts.get(targetOp.fontName) ?? identityLatin1CMap(1);

  // --- Try in-place re-encode with the SAME font ---
  const encoded = encodeText(newText, cmap);
  let mode: 'inplace' | 'redraw';
  let replacement: string;

  if (encoded) {
    // Build a hex string operand and the right operator.
    const hex = encoded
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    if (targetOp.operator === 'TJ') {
      replacement = `[<${hex}>]TJ`;
    } else {
      replacement = `<${hex}>${targetOp.operator}`;
    }
    mode = 'inplace';
  } else {
    // Can't render new glyphs in the embedded subset → remove original text,
    // caller repaints with a substitute font.
    if (targetOp.operator === 'TJ') {
      replacement = `[]TJ`;
    } else {
      replacement = `(${targetOp.operator === '"' ? '' : ''})${targetOp.operator}`;
      // Keep it simple & valid: empty literal string then operator.
      replacement = `()${targetOp.operator}`;
    }
    mode = 'redraw';
  }

  // --- Splice the replacement into the content ---
  const newContent =
    content.slice(0, targetOp.regionStart) +
    replacement +
    content.slice(targetOp.regionEnd);

  const newBytes = binaryStringToBytes(newContent);
  const newDict = ctx.obj({}) as any;
  newDict.set(PDFName.of('Length'), PDFNumber.of(newBytes.length));
  const newStream = PDFRawStream.of(newDict, newBytes);
  const newRef = ctx.register(newStream);
  // Replace the whole Contents with our single rewritten stream.
  page.node.set(PDFName.of('Contents'), newRef);

  return { success: true, mode, color: targetOp.color };
}
