/**
 * Real PDF digital signatures (PKCS#7 / CMS detached, SubFilter
 * adbe.pkcs7.detached) — the same mechanism Adobe Acrobat uses for certificate
 * signatures. Runs in the Electron main process where Node's Buffer is
 * available, exposed to the renderer over IPC (`window.api.signPdf`).
 *
 * Capabilities:
 *   - signPdfBuffer:        sign a PDF with a PKCS#12 (.p12/.pfx) digital ID.
 *   - createSelfSignedP12:  mint a self-signed digital ID (like Acrobat's
 *                           "self-signed digital ID"), returned as a .p12.
 *   - verifyPdfSignature:   cryptographically validate an existing signature
 *                           (digest binds to the document + signature checks out
 *                           against the embedded certificate).
 */
import signpdf from '@signpdf/signpdf';
import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import { P12Signer } from '@signpdf/signer-p12';
import forge from 'node-forge';

export interface SignOptions {
  reason?: string;
  location?: string;
  contactInfo?: string;
  name?: string;
}

/** Sign `pdf` with a PKCS#12 bundle and its passphrase. Returns signed bytes. */
export async function signPdfBuffer(
  pdf: Buffer,
  p12: Buffer,
  passphrase: string,
  opts: SignOptions = {},
): Promise<Buffer> {
  const withPlaceholder = plainAddPlaceholder({
    pdfBuffer: pdf,
    reason: opts.reason || 'He revisado este documento',
    contactInfo: opts.contactInfo || '',
    name: opts.name || '',
    location: opts.location || '',
  });
  const signer = new P12Signer(p12, { passphrase });
  const signed = await signpdf.sign(withPlaceholder, signer);
  return signed;
}

/** Create a self-signed digital ID (RSA-2048 / SHA-256) as a PKCS#12 buffer. */
export function createSelfSignedP12(
  opts: {
    commonName: string;
    organization?: string;
    country?: string;
    email?: string;
    years?: number;
  },
  passphrase: string,
): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(
    cert.validity.notBefore.getFullYear() + (opts.years ?? 5),
  );
  const attrs: forge.pki.CertificateField[] = [
    { name: 'commonName', value: opts.commonName },
  ];
  if (opts.organization) attrs.push({ name: 'organizationName', value: opts.organization });
  if (opts.country) attrs.push({ name: 'countryName', value: opts.country });
  if (opts.email) attrs.push({ name: 'emailAddress', value: opts.email });
  cert.setSubject(attrs);
  cert.setIssuer(attrs); // self-signed: issuer == subject
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: true },
    { name: 'extKeyUsage', emailProtection: true, clientAuth: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: '3des',
  });
  const der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(der, 'binary');
}

export interface VerifyResult {
  signed: boolean;
  /** Signature value verifies against the embedded certificate. */
  valid: boolean;
  /** The signed digest binds to the exact bytes of this document. */
  digestMatches: boolean;
  /** /ByteRange covers the whole file (nothing left unsigned). */
  coversWholeFile: boolean;
  signerCommonName?: string;
  reason?: string;
  signedAt?: string;
  error?: string;
}

const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';

/** Cryptographically verify the first signature in `pdf`. */
export function verifyPdfSignature(pdf: Buffer): VerifyResult {
  const result: VerifyResult = {
    signed: false,
    valid: false,
    digestMatches: false,
    coversWholeFile: false,
  };
  try {
    const latin1 = pdf.toString('latin1');
    const brMatch = latin1.match(
      /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/,
    );
    if (!brMatch) return result;
    result.signed = true;
    const r0 = +brMatch[1];
    const r1 = +brMatch[2];
    const r2 = +brMatch[3];
    const r3 = +brMatch[4];

    // The signed content is everything except the /Contents hex value.
    const signedContent = Buffer.concat([
      pdf.subarray(r0, r0 + r1),
      pdf.subarray(r2, r2 + r3),
    ]);
    result.coversWholeFile = r2 + r3 >= pdf.length - 3;

    // /Contents <…> lives in the gap between the two ranges.
    const gap = pdf.subarray(r0 + r1, r2).toString('latin1');
    const hexMatch = gap.match(/<([0-9A-Fa-f]+)>/);
    if (!hexMatch) return result;
    let hex = hexMatch[1].replace(/(00)+$/i, '');
    if (hex.length % 2) hex = hex.slice(0, -1);
    const der = forge.util.hexToBytes(hex);

    const p7 = forge.pkcs7.messageFromAsn1(
      forge.asn1.fromDer(der),
    ) as forge.pkcs7.PkcsSignedData & { rawCapture: any };

    const cert = p7.certificates?.[0];
    if (cert) {
      const cn = cert.subject.getField('CN');
      if (cn) result.signerCommonName = cn.value;
    }

    const attrs = p7.rawCapture.authenticatedAttributes;
    const signature = p7.rawCapture.signature;

    // 1) The messageDigest attribute must equal SHA-256 of the signed content.
    const expectedDigest = forge.md.sha256.create();
    expectedDigest.update(signedContent.toString('binary'));
    const expectedHex = expectedDigest.digest().toHex();
    for (const attr of attrs) {
      const oid = forge.asn1.derToOid(attr.value[0].value);
      if (oid === OID_MESSAGE_DIGEST) {
        const stored = forge.util.bytesToHex(attr.value[1].value[0].value);
        result.digestMatches = stored.toLowerCase() === expectedHex.toLowerCase();
      }
    }

    // 2) The signature must verify over the authenticated attributes (SET OF).
    if (cert) {
      const set = forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.SET,
        true,
        attrs,
      );
      const attrDer = forge.asn1.toDer(set).getBytes();
      const md = forge.md.sha256.create();
      md.update(attrDer);
      try {
        result.valid = (cert.publicKey as forge.pki.rsa.PublicKey).verify(
          md.digest().getBytes(),
          signature,
        );
      } catch {
        result.valid = false;
      }
    }
  } catch (e: any) {
    result.error = e?.message ?? String(e);
  }
  return result;
}
