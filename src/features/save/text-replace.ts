/**
 * True text replacement inside a PDF's content stream — no cover rectangles,
 * no overlays. Modifies the raw drawing operators that emit glyphs on the
 * page so the original text is literally replaced with the new text.
 *
 * Why this exists: pdf-lib's high-level API only lets you DRAW NEW content
 * on top of existing pages. To actually CHANGE existing text we have to
 * read the page's content stream, find the Tj/TJ operator that produces
 * the original glyphs, and rewrite its argument.
 *
 * This module tries several common encodings (literal strings, TJ arrays,
 * hex strings). When the original text is found, it's replaced in place
 * and the modified content stream is written back. When no encoding
 * matches (e.g. CID fonts, glyphs split across many operators), the
 * function returns false and the caller falls back to the cover approach.
 */

import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from 'pdf-lib';

export interface TextReplaceResult {
  success: boolean;
  /** When success is true, this is the kind of pattern that matched. */
  pattern?: 'literal-Tj' | 'literal-TJ' | 'hex-Tj' | 'hex-TJ';
}

export async function tryReplaceTextInPage(
  pdfDoc: PDFDocument,
  pageIndex: number,
  oldText: string,
  newText: string,
): Promise<TextReplaceResult> {
  if (!oldText || oldText === newText) {
    return { success: false };
  }

  const page = pdfDoc.getPage(pageIndex);
  const contentsKey = PDFName.of('Contents');
  const contentsObj = page.node.get(contentsKey);
  if (!contentsObj) return { success: false };

  const ctx = pdfDoc.context;

  // Build list of (ref, stream) pairs so we can write back to the exact slot.
  type Slot = {
    /** Index into the contents array, or -1 if Contents is a single ref. */
    arrayIndex: number;
    ref: PDFRef | undefined;
    stream: PDFRawStream;
  };
  const slots: Slot[] = [];
  const resolved = ctx.lookup(contentsObj);
  if (resolved instanceof PDFArray) {
    for (let i = 0; i < resolved.size(); i++) {
      const entry = resolved.get(i);
      const ref = entry instanceof PDFRef ? entry : undefined;
      const stream = ctx.lookup(entry);
      if (stream instanceof PDFRawStream) {
        slots.push({ arrayIndex: i, ref, stream });
      }
    }
  } else if (resolved instanceof PDFRawStream) {
    slots.push({
      arrayIndex: -1,
      ref: contentsObj instanceof PDFRef ? contentsObj : undefined,
      stream: resolved,
    });
  }

  for (const slot of slots) {
    let decoded: Uint8Array;
    try {
      decoded = decodePDFRawStream(slot.stream).decode();
    } catch {
      continue;
    }

    // Bytes → binary-safe string (one char per byte, no UTF interpretation).
    const content = bytesToBinaryString(decoded);

    const result = tryReplaceInContent(content, oldText, newText);
    if (!result) continue;

    const newBytes = binaryStringToBytes(result.content);
    const newDict = ctx.obj({}) as any;
    newDict.set(PDFName.of('Length'), PDFNumber.of(newBytes.length));
    const newStream = PDFRawStream.of(newDict, newBytes);
    const newRef = ctx.register(newStream);

    if (slot.arrayIndex >= 0 && resolved instanceof PDFArray) {
      resolved.set(slot.arrayIndex, newRef);
    } else {
      page.node.set(contentsKey, newRef);
    }
    return { success: true, pattern: result.pattern };
  }

  return { success: false };
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let s = '';
  // Chunk to avoid call-stack overflow on huge streams.
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

interface ReplaceMatch {
  content: string;
  pattern: TextReplaceResult['pattern'];
}

function tryReplaceInContent(
  content: string,
  oldText: string,
  newText: string,
): ReplaceMatch | null {
  // 1) Literal string Tj operator: (oldText) Tj
  {
    const re = new RegExp(
      `\\(${escapeRegex(escapePdfString(oldText))}\\)(\\s*)Tj`,
    );
    if (re.test(content)) {
      return {
        content: content.replace(re, `(${escapePdfString(newText)})$1Tj`),
        pattern: 'literal-Tj',
      };
    }
  }

  // 2) TJ array with a single string: [(oldText)] TJ (kerning sometimes present)
  {
    const re = new RegExp(
      `\\[\\s*\\(${escapeRegex(escapePdfString(oldText))}\\)\\s*\\](\\s*)TJ`,
    );
    if (re.test(content)) {
      return {
        content: content.replace(re, `[(${escapePdfString(newText)})]$1TJ`),
        pattern: 'literal-TJ',
      };
    }
  }

  // 3) Hex string Tj: <hex> Tj
  {
    const oldHex = textToHex(oldText);
    const newHex = textToHex(newText);
    const re = new RegExp(
      `<\\s*${escapeRegex(oldHex)}\\s*>(\\s*)Tj`,
      'i',
    );
    if (re.test(content)) {
      return {
        content: content.replace(re, `<${newHex}>$1Tj`),
        pattern: 'hex-Tj',
      };
    }
  }

  // 4) TJ array with hex: [<hex>] TJ
  {
    const oldHex = textToHex(oldText);
    const newHex = textToHex(newText);
    const re = new RegExp(
      `\\[\\s*<\\s*${escapeRegex(oldHex)}\\s*>\\s*\\](\\s*)TJ`,
      'i',
    );
    if (re.test(content)) {
      return {
        content: content.replace(re, `[<${newHex}>]$1TJ`),
        pattern: 'hex-TJ',
      };
    }
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapePdfString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function textToHex(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    out += (s.charCodeAt(i) & 0xff).toString(16).padStart(2, '0');
  }
  return out.toUpperCase();
}
