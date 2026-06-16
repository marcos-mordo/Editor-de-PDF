import { describe, it, expect } from 'vitest';
import { tokenize } from './tokenizer';

describe('tokenize (PDF content stream)', () => {
  it('reads a literal string Tj', () => {
    const t = tokenize('(Hello) Tj');
    const str = t.find((x) => x.type === 'string');
    expect(str?.hex).toBe(false);
    expect(String.fromCharCode(...(str?.bytes ?? []))).toBe('Hello');
    expect(t.some((x) => x.type === 'op' && x.text === 'Tj')).toBe(true);
  });

  it('reads a hex string', () => {
    const t = tokenize('<48656C6C6F> Tj');
    const str = t.find((x) => x.type === 'string');
    expect(str?.hex).toBe(true);
    expect(String.fromCharCode(...(str?.bytes ?? []))).toBe('Hello');
  });

  it('handles escapes inside literal strings', () => {
    const t = tokenize('(a\\(b\\)c\\\\d) Tj');
    const str = t.find((x) => x.type === 'string');
    expect(String.fromCharCode(...(str?.bytes ?? []))).toBe('a(b)c\\d');
  });

  it('handles octal escapes', () => {
    const t = tokenize('(\\101) Tj'); // \101 octal = 65 = 'A'
    const str = t.find((x) => x.type === 'string');
    expect(String.fromCharCode(...(str?.bytes ?? []))).toBe('A');
  });

  it('distinguishes dict open from hex string', () => {
    const t = tokenize('<< /Foo 1 >>');
    expect(t[0].type).toBe('dict_open');
    expect(t[t.length - 1].type).toBe('dict_close');
  });

  it('parses names, numbers and arrays', () => {
    const t = tokenize('/F1 12 Tf [(a) -50 (b)] TJ');
    expect(t.find((x) => x.type === 'name')?.text).toBe('F1');
    expect(t.find((x) => x.type === 'num')?.num).toBe(12);
    expect(t.some((x) => x.type === 'arr_open')).toBe(true);
    expect(t.some((x) => x.type === 'arr_close')).toBe(true);
    expect(t.some((x) => x.type === 'op' && x.text === 'TJ')).toBe(true);
  });

  it('preserves byte offsets for round-trip splicing', () => {
    const src = 'BT (Hi) Tj ET';
    const t = tokenize(src);
    const str = t.find((x) => x.type === 'string')!;
    expect(src.slice(str.start, str.end)).toBe('(Hi)');
  });

  it('skips comments', () => {
    const t = tokenize('% this is a comment\n(x) Tj');
    expect(t.find((x) => x.type === 'string')).toBeTruthy();
  });
});
