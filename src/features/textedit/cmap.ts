/**
 * Parses a PDF font's /ToUnicode CMap stream into bidirectional maps:
 *   - decode: glyph code (integer) -> Unicode string  (for reading PDF text)
 *   - encode: Unicode string -> glyph code (integer)  (for writing new text)
 *
 * A ToUnicode CMap is the bridge between the bytes inside a `(...) Tj` /
 * `<...> Tj` operator and the actual characters they render. Without it we
 * can't reliably know what a subset/CID font's codes mean — which is exactly
 * why naive byte-matching fails on PDFs exported from Canva, design tools and
 * many CV builders (they use Type0/Identity-H fonts with arbitrary code
 * assignments).
 *
 * Supported CMap constructs:
 *   - codespacerange (to learn the code byte width: 1 or 2 bytes typically)
 *   - bfchar         (<src> <dstUTF16BE>)
 *   - bfrange        (<lo> <hi> <dstUTF16BE>)  and  (<lo> <hi> [<d0> <d1> ...])
 */

export interface FontCMap {
  /** Number of bytes per glyph code (1 for simple fonts, 2 for Identity-H). */
  codeBytes: number;
  /** glyph code -> unicode string */
  decode: Map<number, string>;
  /** unicode string -> glyph code (first assignment wins) */
  encode: Map<string, number>;
}

/** Convert a UTF-16BE hex string ("0044", "00660069") into a JS string. */
function utf16beHexToString(hex: string): string {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    if (!Number.isNaN(code)) out += String.fromCharCode(code);
  }
  // Odd leftover (1-byte dst, rare) — treat as a single code unit.
  if (hex.length % 4 === 2) {
    const code = parseInt(hex.slice(hex.length - 2), 16);
    if (!Number.isNaN(code)) out += String.fromCharCode(code);
  }
  return out;
}

export function parseToUnicodeCMap(cmapText: string): FontCMap {
  const decode = new Map<number, string>();
  const encode = new Map<string, number>();
  let codeBytes = 1;

  // --- codespacerange: determine the code width from the first entry ---
  const csMatch = cmapText.match(
    /begincodespacerange([\s\S]*?)endcodespacerange/,
  );
  if (csMatch) {
    const firstHex = csMatch[1].match(/<([0-9A-Fa-f]+)>/);
    if (firstHex) {
      codeBytes = Math.max(1, Math.round(firstHex[1].length / 2));
    }
  }

  // --- bfchar blocks ---
  const bfcharBlocks = cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g);
  for (const block of bfcharBlocks) {
    const body = block[1];
    const pairRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(body)) !== null) {
      const code = parseInt(m[1], 16);
      const uni = utf16beHexToString(m[2]);
      if (uni) {
        decode.set(code, uni);
        if (!encode.has(uni)) encode.set(uni, code);
      }
    }
  }

  // --- bfrange blocks ---
  const bfrangeBlocks = cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g);
  for (const block of bfrangeBlocks) {
    const body = block[1];
    // Form A: <lo> <hi> <dst>
    const rangeRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let m: RegExpExecArray | null;
    while ((m = rangeRe.exec(body)) !== null) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      const dstBase = m[3];
      // Increment the LAST UTF-16 code unit across the range.
      const baseStr = utf16beHexToString(dstBase);
      if (!baseStr) continue;
      const baseLast = baseStr.charCodeAt(baseStr.length - 1);
      const prefix = baseStr.slice(0, -1);
      for (let code = lo, k = 0; code <= hi && k < 65536; code++, k++) {
        const uni = prefix + String.fromCharCode(baseLast + k);
        decode.set(code, uni);
        if (!encode.has(uni)) encode.set(uni, code);
      }
    }
    // Form B: <lo> <hi> [ <d0> <d1> ... ]
    const arrRangeRe =
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
    while ((m = arrRangeRe.exec(body)) !== null) {
      const lo = parseInt(m[1], 16);
      const items = m[3].match(/<([0-9A-Fa-f]+)>/g) ?? [];
      for (let i = 0; i < items.length; i++) {
        const hex = items[i].replace(/[<>]/g, '');
        const uni = utf16beHexToString(hex);
        const code = lo + i;
        if (uni) {
          decode.set(code, uni);
          if (!encode.has(uni)) encode.set(uni, code);
        }
      }
    }
  }

  return { codeBytes, decode, encode };
}

/**
 * Decode a sequence of raw bytes (the literal content of a Tj/hex string)
 * into Unicode using the given CMap. Returns the decoded string and the
 * per-character code list so callers can map character offsets back to codes.
 */
export function decodeBytes(
  bytes: number[],
  cmap: FontCMap,
): { text: string; codes: number[] } {
  let text = '';
  const codes: number[] = [];
  const step = cmap.codeBytes;
  for (let i = 0; i + step <= bytes.length; i += step) {
    let code = 0;
    for (let b = 0; b < step; b++) code = (code << 8) | bytes[i + b];
    const uni = cmap.decode.get(code);
    if (uni !== undefined) {
      text += uni;
    } else {
      // Unknown code: fall back to Latin-1 interpretation of the low byte.
      text += String.fromCharCode(code & 0xff);
    }
    codes.push(code);
  }
  return { text, codes };
}

/**
 * Encode a Unicode string back to glyph-code bytes using the CMap's inverse
 * map. Returns null if ANY character has no code in this font (i.e. the glyph
 * isn't present in the embedded subset) — the caller then knows it must
 * substitute a fully-embedded font instead.
 */
export function encodeText(text: string, cmap: FontCMap): number[] | null {
  const out: number[] = [];
  const step = cmap.codeBytes;
  for (const ch of text) {
    // `for..of` iterates by code point; CMaps key by UTF-16 unit, so also
    // try the raw char. Most Latin text is single-unit so this is fine.
    let code = cmap.encode.get(ch);
    if (code === undefined && ch.length === 1) {
      code = cmap.encode.get(ch);
    }
    if (code === undefined) return null;
    for (let b = step - 1; b >= 0; b--) {
      out.push((code >> (b * 8)) & 0xff);
    }
  }
  return out;
}
