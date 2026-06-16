import { describe, it, expect } from 'vitest';
import {
  PDFDocument,
  StandardFonts,
  PDFName,
  PDFArray,
  PDFRawStream,
  PDFHexString,
  PDFString,
  PDFNumber,
} from 'pdf-lib';
import {
  encryptPdf,
  computeKey,
  computeO,
  computeU,
  objectKey,
  computeP,
} from './pdf-encrypt';
import { aesCbcDecrypt, aesCbcEncrypt } from './crypto-primitives';
import { inflateSync } from 'node:zlib';

describe('crypto primitives', () => {
  it('AES-128-CBC encrypt → decrypt round-trips', async () => {
    const key = new Uint8Array(16).fill(7);
    const msg = new TextEncoder().encode('The quick brown fox jumps');
    const enc = await aesCbcEncrypt(key, msg);
    expect(enc.length).toBeGreaterThan(16); // IV + ciphertext
    const dec = await aesCbcDecrypt(key, enc);
    expect(new TextDecoder().decode(dec)).toBe('The quick brown fox jumps');
  });
});

describe('Standard Security Handler key derivation', () => {
  it('U recomputed from the user password matches stored U (Algorithm 6)', () => {
    const user = 'secret';
    const owner = 'owner-pw';
    const id0 = new Uint8Array(16).fill(0xab);
    const P = computeP({ printing: true, copying: true, modifying: true, annotating: true });
    const O = computeO(owner, user);
    const key = computeKey(user, O, P, id0);
    const U = computeU(key, id0);

    // Verify: a reader given the user password derives the same key and U.
    const key2 = computeKey(user, O, P, id0);
    const U2 = computeU(key2, id0);
    expect([...U2.subarray(0, 16)]).toEqual([...U.subarray(0, 16)]);
  });

  it('wrong password derives a different key (so /U would not match)', () => {
    const id0 = new Uint8Array(16).fill(0x11);
    const P = computeP({ printing: true, copying: true, modifying: true, annotating: true });
    const O = computeO('owner', 'right');
    const right = computeU(computeKey('right', O, P, id0), id0);
    const wrong = computeU(computeKey('wrong', O, P, id0), id0);
    expect([...right.subarray(0, 16)]).not.toEqual([...wrong.subarray(0, 16)]);
  });
});

describe('encryptPdf end-to-end', () => {
  it('encrypts content so it byte-exactly round-trips with the password', async () => {
    // "TopSecret123" is stored by pdf-lib as the hex string below.
    const HEX_MARKER = '546F70536563726574313233'; // hex of "TopSecret123"

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([300, 120]).drawText('TopSecret123', { x: 20, y: 60, size: 20, font });
    const plainBytes = await doc.save();

    // Capture the original (inflated) content stream for an identity check.
    const plainDoc = await PDFDocument.load(plainBytes);
    let plainContent: Uint8Array | null = null;
    for (const [, obj] of plainDoc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream) {
        try {
          const inf = inflateSync(Buffer.from(obj.contents));
          if (new TextDecoder('latin1').decode(inf).includes(HEX_MARKER)) {
            plainContent = new Uint8Array(inf);
          }
        } catch {
          /* not the content stream */
        }
      }
    }
    expect(plainContent).not.toBeNull();

    // Encrypt.
    const enc = await PDFDocument.load(plainBytes);
    await encryptPdf(enc, {
      userPassword: 'pass123',
      permissions: { printing: true, copying: false, modifying: false, annotating: true },
    });
    const encryptedBytes = await enc.save({ useObjectStreams: false });

    // The encrypted file must declare encryption and no longer expose the text.
    const asLatin1 = Array.from(encryptedBytes).map((b) => String.fromCharCode(b)).join('');
    expect(asLatin1).toContain('/Encrypt');
    expect(asLatin1).toContain('/AESV2');
    expect(asLatin1).not.toContain(HEX_MARKER);

    // Decrypt as a compliant reader would, using the password.
    const reader = await PDFDocument.load(encryptedBytes, { ignoreEncryption: true });
    const ctx = reader.context;
    const encDict = ctx.lookup(reader.context.trailerInfo.Encrypt) as any;
    const O = encDict.get(PDFName.of('O')).asBytes();
    const P = (encDict.get(PDFName.of('P')) as PDFNumber).asNumber();
    const idArr = ctx.lookup(reader.context.trailerInfo.ID) as PDFArray;
    const id0 = (idArr.get(0) as PDFHexString).asBytes();
    const fileKey = computeKey('pass123', O, P, id0);

    let recovered: Uint8Array | null = null;
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const objKey = objectKey(fileKey, ref.objectNumber, ref.generationNumber);
      try {
        const decrypted = await aesCbcDecrypt(objKey, obj.contents);
        const inf = new Uint8Array(inflateSync(Buffer.from(decrypted)));
        if (new TextDecoder('latin1').decode(inf).includes(HEX_MARKER)) {
          recovered = inf;
          break;
        }
      } catch {
        /* wrong key / not this stream */
      }
    }
    expect(recovered).not.toBeNull();
    // Byte-exact round trip: decrypted content === original content.
    expect(Buffer.from(recovered!).equals(Buffer.from(plainContent!))).toBe(true);
  });

  it('produces a different output each run (random IV/ID)', async () => {
    const make = async () => {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      doc.addPage([200, 80]).drawText('x', { x: 10, y: 40, size: 12, font });
      const d = await PDFDocument.load(await doc.save());
      await encryptPdf(d, { userPassword: 'p' });
      return d.save({ useObjectStreams: false });
    };
    const a = await make();
    const b = await make();
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
