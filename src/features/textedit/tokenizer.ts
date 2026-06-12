/**
 * A tokenizer for PDF content streams.
 *
 * Works on a "binary string" (one JS char per byte) so we can preserve exact
 * byte offsets — essential for rewriting only the text we changed and leaving
 * every other byte of the stream untouched.
 */

export type TokenType =
  | 'num'
  | 'string' // literal (...) or hex <...>
  | 'name' // /Name
  | 'op' // operator like Tj, TJ, Tf, BT, ET, rg, g, k
  | 'arr_open' // [
  | 'arr_close' // ]
  | 'dict_open' // <<
  | 'dict_close'; // >>

export interface Token {
  type: TokenType;
  /** Source slice [start, end) in the binary string. */
  start: number;
  end: number;
  /** For numbers: the numeric value. */
  num?: number;
  /** For names/operators: the textual value (without leading slash). */
  text?: string;
  /** For strings: the decoded raw bytes and whether it was hex. */
  bytes?: number[];
  hex?: boolean;
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMS = new Set([
  0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25,
]); // ( ) < > [ ] { } / %

function isWS(c: number) {
  return WHITESPACE.has(c);
}
function isDelim(c: number) {
  return DELIMS.has(c);
}

export function tokenize(s: string): Token[] {
  const tokens: Token[] = [];
  const n = s.length;
  let i = 0;

  function code(idx: number) {
    return s.charCodeAt(idx) & 0xff;
  }

  while (i < n) {
    const c = code(i);

    // Whitespace
    if (isWS(c)) {
      i++;
      continue;
    }

    // Comment: % .... to end of line
    if (c === 0x25) {
      while (i < n && code(i) !== 0x0a && code(i) !== 0x0d) i++;
      continue;
    }

    // Literal string (...)
    if (c === 0x28) {
      const start = i;
      i++;
      const bytes: number[] = [];
      let depth = 1;
      while (i < n && depth > 0) {
        const ch = code(i);
        if (ch === 0x5c) {
          // backslash escape
          i++;
          if (i >= n) break;
          const e = code(i);
          switch (e) {
            case 0x6e: bytes.push(0x0a); i++; break; // \n
            case 0x72: bytes.push(0x0d); i++; break; // \r
            case 0x74: bytes.push(0x09); i++; break; // \t
            case 0x62: bytes.push(0x08); i++; break; // \b
            case 0x66: bytes.push(0x0c); i++; break; // \f
            case 0x28: bytes.push(0x28); i++; break; // \(
            case 0x29: bytes.push(0x29); i++; break; // \)
            case 0x5c: bytes.push(0x5c); i++; break; // backslash
            default:
              if (e >= 0x30 && e <= 0x37) {
                // octal escape, up to 3 digits
                let oct = '';
                let k = 0;
                while (k < 3 && i < n && code(i) >= 0x30 && code(i) <= 0x37) {
                  oct += s[i];
                  i++;
                  k++;
                }
                bytes.push(parseInt(oct, 8) & 0xff);
              } else if (e === 0x0a || e === 0x0d) {
                // line continuation: skip newline
                i++;
              } else {
                bytes.push(e);
                i++;
              }
          }
        } else if (ch === 0x28) {
          depth++;
          bytes.push(ch);
          i++;
        } else if (ch === 0x29) {
          depth--;
          if (depth > 0) bytes.push(ch);
          i++;
        } else {
          bytes.push(ch);
          i++;
        }
      }
      tokens.push({ type: 'string', start, end: i, bytes, hex: false });
      continue;
    }

    // Hex string <...> or dict open <<
    if (c === 0x3c) {
      if (i + 1 < n && code(i + 1) === 0x3c) {
        tokens.push({ type: 'dict_open', start: i, end: i + 2 });
        i += 2;
        continue;
      }
      const start = i;
      i++;
      let hexStr = '';
      while (i < n && code(i) !== 0x3e) {
        const ch = code(i);
        if (!isWS(ch)) hexStr += s[i];
        i++;
      }
      i++; // consume '>'
      if (hexStr.length % 2 === 1) hexStr += '0';
      const bytes: number[] = [];
      for (let k = 0; k + 2 <= hexStr.length; k += 2) {
        bytes.push(parseInt(hexStr.slice(k, k + 2), 16) & 0xff);
      }
      tokens.push({ type: 'string', start, end: i, bytes, hex: true });
      continue;
    }

    // Dict close >>
    if (c === 0x3e) {
      if (i + 1 < n && code(i + 1) === 0x3e) {
        tokens.push({ type: 'dict_close', start: i, end: i + 2 });
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // Array brackets
    if (c === 0x5b) {
      tokens.push({ type: 'arr_open', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === 0x5d) {
      tokens.push({ type: 'arr_close', start: i, end: i + 1 });
      i++;
      continue;
    }

    // Name /Foo
    if (c === 0x2f) {
      const start = i;
      i++;
      let name = '';
      while (i < n && !isWS(code(i)) && !isDelim(code(i))) {
        name += s[i];
        i++;
      }
      tokens.push({ type: 'name', start, end: i, text: name });
      continue;
    }

    // Number
    if (
      (c >= 0x30 && c <= 0x39) ||
      c === 0x2b ||
      c === 0x2d ||
      c === 0x2e
    ) {
      const start = i;
      let numStr = '';
      while (
        i < n &&
        ((code(i) >= 0x30 && code(i) <= 0x39) ||
          code(i) === 0x2b ||
          code(i) === 0x2d ||
          code(i) === 0x2e ||
          code(i) === 0x65 || // e (exponent, rare)
          code(i) === 0x45)
      ) {
        numStr += s[i];
        i++;
      }
      const num = parseFloat(numStr);
      tokens.push({ type: 'num', start, end: i, num: Number.isNaN(num) ? 0 : num });
      continue;
    }

    // Operator / keyword (letters and a few symbols like *, ', ")
    {
      const start = i;
      let op = '';
      while (i < n && !isWS(code(i)) && !isDelim(code(i))) {
        op += s[i];
        i++;
      }
      if (op.length === 0) {
        // Unknown single char — skip to avoid infinite loop.
        i++;
        continue;
      }
      tokens.push({ type: 'op', start, end: i, text: op });
      continue;
    }
  }

  return tokens;
}
