import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  clamp,
  stripPdfExt,
  toArrayBuffer,
  generateId,
} from './utils';

describe('formatBytes', () => {
  it('formats common sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
  });
});

describe('clamp', () => {
  it('clamps within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe('stripPdfExt', () => {
  it('removes a trailing .pdf (case-insensitive)', () => {
    expect(stripPdfExt('file.pdf')).toBe('file');
    expect(stripPdfExt('file.PDF')).toBe('file');
    expect(stripPdfExt('no-ext')).toBe('no-ext');
    expect(stripPdfExt('a.pdf.pdf')).toBe('a.pdf');
  });
});

describe('toArrayBuffer', () => {
  it('returns a standalone ArrayBuffer of the exact view', () => {
    const u8 = new Uint8Array([1, 2, 3, 4]);
    const ab = toArrayBuffer(u8.subarray(1, 3));
    expect(ab.byteLength).toBe(2);
    expect(new Uint8Array(ab)).toEqual(new Uint8Array([2, 3]));
  });
});

describe('generateId', () => {
  it('produces non-empty, reasonably unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(ids.size).toBeGreaterThan(990);
  });
});
