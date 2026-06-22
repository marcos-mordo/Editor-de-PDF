/**
 * Bates numbering — the sequential, fixed-width identifiers stamped on legal
 * and business documents (e.g. "ACME-000042"). Pure and unit-testable; the
 * dialog stamps the resulting strings onto each page.
 */
export interface BatesOptions {
  /** Text before the number, e.g. "ACME-". */
  prefix?: string;
  /** Text after the number. */
  suffix?: string;
  /** Zero-padded width of the numeric part. Default 6. */
  digits?: number;
  /** First number in the sequence. Default 1. */
  start?: number;
}

/**
 * Format the Bates label for the `index`-th page (0-based). The number is
 * `start + index`, zero-padded to `digits`. If the number is longer than
 * `digits` it is shown in full (never truncated).
 */
export function formatBates(index: number, options: BatesOptions = {}): string {
  const prefix = options.prefix ?? '';
  const suffix = options.suffix ?? '';
  const digits = Math.max(1, options.digits ?? 6);
  const start = options.start ?? 1;
  const n = start + index;
  const body = String(Math.max(0, Math.trunc(n))).padStart(digits, '0');
  return `${prefix}${body}${suffix}`;
}

/** The last label in a run of `count` pages — handy for a UI preview. */
export function batesRangePreview(count: number, options: BatesOptions = {}): string {
  if (count <= 0) return '';
  const first = formatBates(0, options);
  if (count === 1) return first;
  return `${first} … ${formatBates(count - 1, options)}`;
}
