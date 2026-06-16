import { describe, it, expect } from 'vitest';
import { parseToUnicodeCMap, decodeBytes, encodeText } from './cmap';

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
endcmap`;

describe('parseToUnicodeCMap (CID/Type0 2-byte fonts)', () => {
  const cmap = parseToUnicodeCMap(CMAP);

  it('detects 2-byte code width from codespacerange', () => {
    expect(cmap.codeBytes).toBe(2);
  });

  it('decodes bfchar entries', () => {
    expect(cmap.decode.get(0x002c)).toBe('M');
    expect(cmap.decode.get(0x0003)).toBe(' ');
    expect(cmap.decode.get(0x0011)).toBe('P');
  });

  it('decodes bfrange entries incrementing the code unit', () => {
    expect(cmap.decode.get(0x0058)).toBe('e');
    expect(cmap.decode.get(0x0059)).toBe('f');
    expect(cmap.decode.get(0x005a)).toBe('g');
  });

  it('round-trips encode → decode for an in-font word', () => {
    const enc = encodeText('Marcos', cmap);
    expect(enc).not.toBeNull();
    expect(enc!.length).toBe(12); // 6 chars × 2 bytes
    expect(decodeBytes(enc!, cmap).text).toBe('Marcos');
  });

  it('returns null when a glyph is missing from the subset', () => {
    expect(encodeText('MaX', cmap)).toBeNull();
  });

  it('decodes a 2-byte byte stream correctly', () => {
    // M a r → 002C 0044 0055
    const { text } = decodeBytes([0x00, 0x2c, 0x00, 0x44, 0x00, 0x55], cmap);
    expect(text).toBe('Mar');
  });
});

describe('parseToUnicodeCMap (bfrange with array form)', () => {
  const cmap = parseToUnicodeCMap(`begincodespacerange
<00> <FF>
endcodespacerange
1 beginbfrange
<41> <43> [<0058> <0059> <005A>]
endbfrange`);

  it('uses 1-byte codes for single-byte codespace', () => {
    expect(cmap.codeBytes).toBe(1);
  });

  it('maps array-form ranges', () => {
    expect(cmap.decode.get(0x41)).toBe('X');
    expect(cmap.decode.get(0x42)).toBe('Y');
    expect(cmap.decode.get(0x43)).toBe('Z');
  });
});
