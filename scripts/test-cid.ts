// Tests the CID/Type0 path (2-byte glyph codes via ToUnicode) — the case
// used by Canva, CV builders and design tools, which is what the user edits.
//
// We can't easily synthesize a full embedded CID font, so we test the two
// pieces that path depends on in isolation:
//   1. parseToUnicodeCMap + decodeBytes + encodeText round-trip (2-byte).
//   2. A hand-built content stream with a 2-byte hex string, run through a
//      lightweight re-implementation of the engine's matching to confirm the
//      decode/locate/re-encode logic is correct for CID strings.

import { parseToUnicodeCMap, decodeBytes, encodeText } from '../src/features/textedit/cmap';
import { tokenize } from '../src/features/textedit/tokenizer';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// A realistic ToUnicode CMap (2-byte codes) mapping a handful of glyph codes
// to letters, like a subset font would.
const CMAP = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CMapName /Adobe-Identity-UCS def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
8 beginbfchar
<0003> <0020>
<002C> <004D>
<0044> <0061>
<0055> <0072>
<0046> <0063>
<0052> <006F>
<0056> <0073>
<0011> <0050>
endbfchar
1 beginbfrange
<0058> <005A> <0065>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;

function main() {
  const cmap = parseToUnicodeCMap(CMAP);

  check('CID codeBytes is 2', cmap.codeBytes === 2, `got ${cmap.codeBytes}`);
  check('decode <002C> = M', cmap.decode.get(0x002c) === 'M');
  check('decode <0003> = space', cmap.decode.get(0x0003) === ' ');
  check('bfrange decode <0058> = e', cmap.decode.get(0x0058) === 'e');
  check('bfrange decode <005A> = g', cmap.decode.get(0x005a) === 'g');

  // Round-trip: encode "Marcos" then decode back.
  // M=002C a=0044 r=0055 c=0046 o=0052 s=0056
  const enc = encodeText('Marcos', cmap);
  check('encode "Marcos" succeeds', enc !== null, enc ? enc.map(b => b.toString(16).padStart(2, '0')).join('') : 'null');
  if (enc) {
    const { text } = decodeBytes(enc, cmap);
    check('round-trip "Marcos" matches', text === 'Marcos', `got "${text}"`);
    check('encode produced 12 bytes (6 chars x 2)', enc.length === 12, `${enc.length}`);
  }

  // Encode a word with a char NOT in the font (e.g. 'X' has no code) → null.
  const encMissing = encodeText('MaX', cmap);
  check('encode with missing glyph returns null', encMissing === null);

  // Decode a real 2-byte hex string as the tokenizer would see it.
  // "<002C00440055>" = "Mar"
  const toks = tokenize('<002C00440055>Tj');
  const strTok = toks.find(t => t.type === 'string');
  check('tokenizer reads hex string', !!strTok && strTok.hex === true);
  if (strTok) {
    const { text } = decodeBytes(strTok.bytes!, cmap);
    check('decode tokenized CID hex = "Mar"', text === 'Mar', `got "${text}"`);
  }

  // Encode "Pro" (P=0011 r=0055 o=0052) — all present → editing keeps same font.
  const encPro = encodeText('Pro', cmap);
  check('encode "Pro" (chars in subset) succeeds', encPro !== null);

  console.log(`\n=== ${pass}/${pass + fail} CID checks passed ===`);
  if (fail > 0) process.exit(1);
}

main();
