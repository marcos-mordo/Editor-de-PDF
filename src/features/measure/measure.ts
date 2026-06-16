/**
 * Measurement helpers. PDF coordinates are in points (1 pt = 1/72 inch).
 * A measurement converts a point distance/area into a real-world unit, with an
 * optional drawing scale (e.g. a blueprint where 1 cm on the page = 100 cm).
 */

export type MeasureUnit = 'pt' | 'in' | 'mm' | 'cm';

/** Real-world units per PDF point, at the nominal 72 DPI. */
const UNITS_PER_POINT: Record<MeasureUnit, number> = {
  pt: 1,
  in: 1 / 72,
  mm: 25.4 / 72,
  cm: 2.54 / 72,
};

export const UNIT_LABEL: Record<MeasureUnit, string> = {
  pt: 'pt',
  in: 'in',
  mm: 'mm',
  cm: 'cm',
};

/** Distance between two points (in points). */
export function pointDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Convert a point distance to a real-world length in the given unit. */
export function toLength(distancePt: number, unit: MeasureUnit, scale = 1): number {
  return distancePt * UNITS_PER_POINT[unit] * scale;
}

/** Convert a point area (pt²) to a real-world area in unit² (scale applies squared). */
export function toArea(areaPt2: number, unit: MeasureUnit, scale = 1): number {
  const k = UNITS_PER_POINT[unit] * scale;
  return areaPt2 * k * k;
}

/** Shoelace polygon area (in points²) for a closed polygon. */
export function polygonAreaPt2(points: { x: number; y: number }[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function formatMeasure(value: number, unit: MeasureUnit, squared = false): string {
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  return `${rounded} ${UNIT_LABEL[unit]}${squared ? '²' : ''}`;
}
