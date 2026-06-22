import { describe, it, expect } from 'vitest';
import { diffPixels } from './pixel-diff';

function solid(width: number, height: number, rgba: [number, number, number, number]) {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = rgba[0];
    buf[i * 4 + 1] = rgba[1];
    buf[i * 4 + 2] = rgba[2];
    buf[i * 4 + 3] = rgba[3];
  }
  return buf;
}

describe('diffPixels', () => {
  it('reports zero change for identical images', () => {
    const a = solid(4, 4, [120, 120, 120, 255]);
    const b = solid(4, 4, [120, 120, 120, 255]);
    const r = diffPixels(a, b, 4, 4);
    expect(r.changed).toBe(0);
    expect(r.ratio).toBe(0);
    expect(r.total).toBe(16);
  });

  it('reports full change for completely different images', () => {
    const a = solid(2, 2, [0, 0, 0, 255]);
    const b = solid(2, 2, [255, 255, 255, 255]);
    const r = diffPixels(a, b, 2, 2);
    expect(r.changed).toBe(4);
    expect(r.ratio).toBe(1);
  });

  it('respects the threshold for small differences', () => {
    const a = solid(2, 2, [100, 100, 100, 255]);
    const b = solid(2, 2, [110, 100, 100, 255]); // delta 10 < default 32
    const r = diffPixels(a, b, 2, 2);
    expect(r.changed).toBe(0);

    const r2 = diffPixels(a, b, 2, 2, { threshold: 5 });
    expect(r2.changed).toBe(4);
  });

  it('paints changed pixels with the highlight color', () => {
    const a = solid(1, 1, [0, 0, 0, 255]);
    const b = solid(1, 1, [255, 255, 255, 255]);
    const r = diffPixels(a, b, 1, 1, { highlight: [10, 20, 30] });
    expect([r.data[0], r.data[1], r.data[2], r.data[3]]).toEqual([10, 20, 30, 255]);
  });

  it('counts only the pixels that actually differ', () => {
    // 2x1 image: left pixel changes, right pixel identical.
    const a = new Uint8ClampedArray([0, 0, 0, 255, 50, 50, 50, 255]);
    const b = new Uint8ClampedArray([255, 255, 255, 255, 50, 50, 50, 255]);
    const r = diffPixels(a, b, 2, 1);
    expect(r.changed).toBe(1);
    expect(r.ratio).toBe(0.5);
  });
});
