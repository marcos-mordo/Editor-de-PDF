/**
 * Pixel-level visual diff between two rendered PDF pages. Pure and
 * canvas-agnostic so it can be unit-tested in Node: it takes two RGBA buffers
 * of the same size and returns a highlighted diff image plus a change ratio.
 */
export interface PixelDiffOptions {
  /** Per-channel difference (0–255) above which a pixel counts as changed. */
  threshold?: number;
  /** RGB used to paint changed pixels. Default magenta. */
  highlight?: [number, number, number];
  /** 0–1 dim factor for unchanged pixels in the output. Default 0.5. */
  dim?: number;
}

export interface PixelDiffResult {
  /** RGBA diff image: dimmed base with changed pixels painted in `highlight`. */
  data: Uint8ClampedArray;
  /** Number of pixels that differ beyond the threshold. */
  changed: number;
  /** Total pixels compared. */
  total: number;
  /** changed / total, in [0, 1]. */
  ratio: number;
}

/**
 * Compare two equal-sized RGBA buffers. `a` is the original/base page (used as
 * the dimmed backdrop); `b` is the page being compared against it.
 */
export function diffPixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  options: PixelDiffOptions = {},
): PixelDiffResult {
  const threshold = options.threshold ?? 32;
  const [hr, hg, hb] = options.highlight ?? [255, 0, 200];
  const dim = options.dim ?? 0.5;

  const total = width * height;
  const out = new Uint8ClampedArray(total * 4);
  let changed = 0;

  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const dr = Math.abs(a[p] - b[p]);
    const dg = Math.abs(a[p + 1] - b[p + 1]);
    const db = Math.abs(a[p + 2] - b[p + 2]);
    const da = Math.abs(a[p + 3] - b[p + 3]);
    const maxDelta = Math.max(dr, dg, db, da);

    if (maxDelta > threshold) {
      changed++;
      out[p] = hr;
      out[p + 1] = hg;
      out[p + 2] = hb;
      out[p + 3] = 255;
    } else {
      // Dim the base toward white so highlighted changes stand out.
      out[p] = 255 - (255 - a[p]) * dim;
      out[p + 1] = 255 - (255 - a[p + 1]) * dim;
      out[p + 2] = 255 - (255 - a[p + 2]) * dim;
      out[p + 3] = 255;
    }
  }

  return { data: out, changed, total, ratio: total === 0 ? 0 : changed / total };
}
