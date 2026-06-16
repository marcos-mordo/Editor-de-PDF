import { describe, it, expect } from 'vitest';
import {
  pointDistance,
  toLength,
  toArea,
  polygonAreaPt2,
  formatMeasure,
} from './measure';

describe('measure', () => {
  it('computes point distance', () => {
    expect(pointDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('converts points to inches (72 pt = 1 in)', () => {
    expect(toLength(72, 'in')).toBeCloseTo(1, 6);
    expect(toLength(144, 'in')).toBeCloseTo(2, 6);
  });

  it('converts points to mm and cm', () => {
    expect(toLength(72, 'mm')).toBeCloseTo(25.4, 4);
    expect(toLength(72, 'cm')).toBeCloseTo(2.54, 4);
  });

  it('applies a drawing scale to length', () => {
    // 72 pt = 1 in, scale 100 → 100 in
    expect(toLength(72, 'in', 100)).toBeCloseTo(100, 6);
  });

  it('computes area with scale squared', () => {
    // 72x72 pt = 1 in², scale 2 → 4 in²
    expect(toArea(72 * 72, 'in', 2)).toBeCloseTo(4, 6);
  });

  it('computes polygon area via shoelace', () => {
    // unit square scaled to 10x10 points
    const sq = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonAreaPt2(sq)).toBe(100);
  });

  it('formats measurements', () => {
    expect(formatMeasure(2.5, 'cm')).toBe('2.5 cm');
    expect(formatMeasure(150.4, 'mm')).toBe('150 mm');
    expect(formatMeasure(4, 'in', true)).toBe('4 in²');
  });
});
