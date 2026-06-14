import { StandardFonts } from 'pdf-lib';

/**
 * Maps a PDF font name (whatever the source PDF used) to the closest of
 * pdf-lib's 14 standard fonts. We can't embed arbitrary fonts, but matching
 * the WEIGHT and STYLE (bold/italic/serif/mono) keeps a substituted run as
 * close as possible to the original when the embedded subset can't render
 * the new glyphs.
 */
export function pickStandardFont(name: string): StandardFonts {
  const lower = (name || '').toLowerCase();
  const isBold = /bold|black|heavy|demi|semibold|[-_ ]?bd|extrab/.test(lower);
  const isItalic = /italic|oblique|slant/.test(lower);
  const isSerif = /times|serif|georgia|garamond|cambria|book|roman|minion|merriweather/.test(
    lower,
  );
  const isMono = /courier|mono|consol|menlo|inconsolata|source\s*code/.test(lower);

  if (isMono) {
    if (isBold && isItalic) return StandardFonts.CourierBoldOblique;
    if (isBold) return StandardFonts.CourierBold;
    if (isItalic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (isSerif) {
    if (isBold && isItalic) return StandardFonts.TimesRomanBoldItalic;
    if (isBold) return StandardFonts.TimesRomanBold;
    if (isItalic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (isBold && isItalic) return StandardFonts.HelveticaBoldOblique;
  if (isBold) return StandardFonts.HelveticaBold;
  if (isItalic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}
