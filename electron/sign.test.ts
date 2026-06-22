import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  signPdfBuffer,
  createSelfSignedP12,
  verifyPdfSignature,
} from './sign';

async function makePdf(text = 'Documento a firmar'): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([400, 200]).drawText(text, { x: 30, y: 120, size: 16, font });
  const bytes = await doc.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}

describe('PDF digital signatures (PKCS#7)', () => {
  it('creates a self-signed digital ID loadable as a PKCS#12', () => {
    const p12 = createSelfSignedP12({ commonName: 'Marcos Test' }, 'pw');
    expect(p12.length).toBeGreaterThan(500);
    // Re-parse it to confirm it is a real, password-protected P12.
    const forge = require('node-forge');
    const asn1 = forge.asn1.fromDer(p12.toString('binary'));
    const p12Obj = forge.pkcs12.pkcs12FromAsn1(asn1, 'pw');
    expect(p12Obj.safeContents.length).toBeGreaterThan(0);
  });

  it('signs a PDF and embeds an adbe.pkcs7.detached signature', async () => {
    const pdf = await makePdf();
    const p12 = createSelfSignedP12({ commonName: 'Marcos Test' }, 'secret');
    const signed = await signPdfBuffer(pdf, p12, 'secret', {
      reason: 'Aprobado',
      location: 'Madrid',
      name: 'Marcos',
    });
    const s = signed.toString('latin1');
    expect(s).toContain('/Type /Sig');
    expect(s).toContain('adbe.pkcs7.detached');
    expect(s).toContain('/ByteRange');
    expect(s).toContain('Adobe.PPKLite');
  });

  it('the signature verifies cryptographically and binds to the bytes', async () => {
    const pdf = await makePdf('Contrato vinculante');
    const p12 = createSelfSignedP12(
      { commonName: 'Ana Firmante', organization: 'ACME' },
      'k',
    );
    const signed = await signPdfBuffer(pdf, p12, 'k', { reason: 'Conforme' });

    const v = verifyPdfSignature(signed);
    expect(v.signed).toBe(true);
    expect(v.digestMatches).toBe(true); // digest binds to the real document
    expect(v.valid).toBe(true); // signature checks out against the cert
    expect(v.coversWholeFile).toBe(true);
    expect(v.signerCommonName).toBe('Ana Firmante');
  });

  it('detects tampering: editing a signed byte breaks the digest', async () => {
    const pdf = await makePdf('Original intacto');
    const p12 = createSelfSignedP12({ commonName: 'X' }, 'k');
    const signed = await signPdfBuffer(pdf, p12, 'k');

    // Flip a byte inside the first signed range (the document body).
    const tampered = Buffer.from(signed);
    tampered[20] = tampered[20] ^ 0xff;

    const v = verifyPdfSignature(tampered);
    expect(v.digestMatches).toBe(false);
  });

  it('reports unsigned PDFs as not signed', async () => {
    const pdf = await makePdf();
    const v = verifyPdfSignature(pdf);
    expect(v.signed).toBe(false);
  });
});
