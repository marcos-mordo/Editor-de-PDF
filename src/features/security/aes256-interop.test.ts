/**
 * Gold-standard interop: a file we encrypt with AES-256 (V5/R6) must open in
 * Mozilla's pdf.js — the same engine Firefox and many viewers ship — with the
 * correct password, and refuse to open without it. This proves the /Encrypt
 * dictionary and key derivation are spec-compliant, not just self-consistent.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { encryptPdf } from './pdf-encrypt';

async function makeR6(password: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 120]).drawText('SecretPayload', { x: 20, y: 60, size: 18, font });
  const plain = await doc.save();
  const enc = await PDFDocument.load(plain);
  await encryptPdf(enc, { userPassword: password, ownerPassword: 'owner-x', aes256: true });
  return enc.save({ useObjectStreams: false });
}

// pdf.js (legacy build) spins up a fake worker on the main thread in Node when
// pointed at its worker module; that's enough to exercise the security handler.
async function loadPdfjs() {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const require = createRequire(import.meta.url);
  const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  return pdfjs;
}

describe('AES-256 (R6) interop with pdf.js', () => {
  it('opens with the correct password and extracts the text', async () => {
    const pdfjs = await loadPdfjs();
    const data = await makeR6('s3cr3t-pw');
    const task = pdfjs.getDocument({
      data: new Uint8Array(data),
      password: 's3cr3t-pw',
      isEvalSupported: false,
      useSystemFonts: false,
    });
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(1);
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((i: any) => i.str).join('');
    expect(text).toContain('SecretPayload');
    await pdf.destroy();
  }, 30000);

  it('opens with the OWNER password too', async () => {
    const pdfjs = await loadPdfjs();
    const data = await makeR6('user-pw');
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(data),
      password: 'owner-x',
      isEvalSupported: false,
    }).promise;
    expect(pdf.numPages).toBe(1);
    await pdf.destroy();
  }, 30000);

  it('throws PasswordException without a password', async () => {
    const pdfjs = await loadPdfjs();
    const data = await makeR6('needed');
    await expect(
      pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise,
    ).rejects.toMatchObject({ name: 'PasswordException' });
  }, 30000);

  it('throws on a wrong password', async () => {
    const pdfjs = await loadPdfjs();
    const data = await makeR6('correct');
    await expect(
      pdfjs.getDocument({
        data: new Uint8Array(data),
        password: 'incorrect',
        isEvalSupported: false,
      }).promise,
    ).rejects.toMatchObject({ name: 'PasswordException' });
  }, 30000);
});
