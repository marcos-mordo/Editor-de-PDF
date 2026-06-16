import { describe, it, expect } from 'vitest';
import {
  PDFDocument,
  StandardFonts,
  PDFName,
  PDFArray,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import { encryptPdf } from './pdf-encrypt';
import { decryptPdf } from './pdf-decrypt';
import { inflateSync } from 'node:zlib';

function bytesToStr(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** Decoded content of the page stream that contains the marker. */
function contentWithMarker(doc: PDFDocument, marker: string): string | null {
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    try {
      // decodePDFRawStream applies the stream's filters (FlateDecode) already.
      const decoded = decodePDFRawStream(obj).decode();
      const text = bytesToStr(decoded);
      if (text.includes(marker)) return text;
    } catch {
      /* not it */
    }
  }
  return null;
}

async function makeEncrypted(password: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 120]).drawText('SecretPayload', { x: 20, y: 60, size: 18, font });
  doc.setTitle('My Title');
  const plain = await doc.save();
  const enc = await PDFDocument.load(plain);
  await encryptPdf(enc, { userPassword: password });
  const encryptedBytes = await enc.save({ useObjectStreams: false });
  return { encryptedBytes, plainTitleHex: '4D79205469746C65' }; // "My Title"
}

describe('decryptPdf', () => {
  const MARKER = '5365637265745061796C6F6164'; // hex of "SecretPayload"

  it('decrypts with the correct password and recovers the content', async () => {
    const { encryptedBytes } = await makeEncrypted('open-sesame');
    const res = await decryptPdf(encryptedBytes, 'open-sesame');
    expect(res.ok).toBe(true);
    expect(res.encrypted).toBe(true);
    expect(res.bytes).toBeTruthy();

    // The decrypted output must be a normal PDF with the original content,
    // and must NOT declare encryption anymore.
    const asLatin1 = bytesToStr(res.bytes!);
    expect(asLatin1).not.toContain('/Encrypt');

    const decDoc = await PDFDocument.load(res.bytes!);
    const content = contentWithMarker(decDoc, MARKER);
    expect(content).not.toBeNull();
    // And the metadata string is back in the clear.
    expect(decDoc.getTitle()).toBe('My Title');
  });

  it('rejects a wrong password', async () => {
    const { encryptedBytes } = await makeEncrypted('right');
    const res = await decryptPdf(encryptedBytes, 'wrong');
    expect(res.ok).toBe(false);
    expect(res.needsPassword).toBe(true);
  });

  it('passes through an unencrypted PDF unchanged', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([200, 80]).drawText('plain', { x: 10, y: 40, size: 12, font });
    const bytes = await doc.save();
    const res = await decryptPdf(bytes, '');
    expect(res.ok).toBe(true);
    expect(res.encrypted).toBe(false);
  });

  it('full round-trip: encrypt then decrypt yields a loadable, editable PDF', async () => {
    const { encryptedBytes } = await makeEncrypted('pw');
    const res = await decryptPdf(encryptedBytes, 'pw');
    expect(res.ok).toBe(true);
    // The decrypted bytes load cleanly without ignoreEncryption.
    const reopened = await PDFDocument.load(res.bytes!);
    expect(reopened.getPageCount()).toBe(1);
  });
});
