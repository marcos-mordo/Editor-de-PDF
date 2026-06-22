/**
 * Batch ("Action Wizard") operations as pure byte→byte transforms, so the same
 * code path that powers the single-document dialogs can run unattended over
 * many files. Each function takes PDF bytes and returns new PDF bytes.
 */
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { formatBates, type BatesOptions } from '../layout/bates';

function hexToRgb(hex: string) {
  const m = hex.replace('#', '');
  return rgb(
    parseInt(m.slice(0, 2), 16) / 255,
    parseInt(m.slice(2, 4), 16) / 255,
    parseInt(m.slice(4, 6), 16) / 255,
  );
}

export interface WatermarkOptions {
  text: string;
  fontSize?: number;
  opacity?: number;
  color?: string;
  rotation?: number;
  tile?: boolean;
}

/** Stamp a text watermark on every page. */
export async function watermarkPdf(
  input: Uint8Array | ArrayBuffer,
  opts: WatermarkOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = opts.fontSize ?? 60;
  const opacity = opts.opacity ?? 0.2;
  const color = hexToRgb(opts.color ?? '#C40000');
  const rotation = opts.rotation ?? 45;

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    if (opts.tile) {
      const step = size * 4;
      for (let y = 0; y < height + step; y += step) {
        for (let x = -step; x < width + step; x += step) {
          page.drawText(opts.text, { x, y, size, font, color, opacity, rotate: degrees(rotation) });
        }
      }
    } else {
      const tw = font.widthOfTextAtSize(opts.text, size);
      page.drawText(opts.text, {
        x: (width - tw) / 2,
        y: height / 2,
        size,
        font,
        color,
        opacity,
        rotate: degrees(rotation),
      });
    }
  }
  return doc.save();
}

export type BatesCorner =
  | 'bottom-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'top-right'
  | 'top-left';

export interface BatchBatesOptions extends BatesOptions {
  fontSize?: number;
  color?: string;
  corner?: BatesCorner;
  margin?: number;
}

/**
 * Stamp Bates numbers on every page. `startIndex` is the running sequence
 * offset so numbering can continue across files. Returns the new bytes and the
 * page count consumed (add it to `startIndex` for the next file).
 */
export async function batesPdf(
  input: Uint8Array | ArrayBuffer,
  opts: BatchBatesOptions,
  startIndex = 0,
): Promise<{ bytes: Uint8Array; pages: number }> {
  const doc = await PDFDocument.load(input, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = opts.fontSize ?? 10;
  const color = hexToRgb(opts.color ?? '#C40000');
  const corner = opts.corner ?? 'bottom-right';
  const margin = opts.margin ?? 24;
  const pages = doc.getPages();

  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    const label = formatBates(startIndex + i, opts);
    const w = font.widthOfTextAtSize(label, size);
    let x = width - margin - w;
    let y = margin;
    switch (corner) {
      case 'bottom-left': x = margin; y = margin; break;
      case 'bottom-center': x = (width - w) / 2; y = margin; break;
      case 'top-right': x = width - margin - w; y = height - margin - size; break;
      case 'top-left': x = margin; y = height - margin - size; break;
      default: x = width - margin - w; y = margin;
    }
    page.drawText(label, { x, y, size, font, color });
  });

  return { bytes: await doc.save(), pages: pages.length };
}
