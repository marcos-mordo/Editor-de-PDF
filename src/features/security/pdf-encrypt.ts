/**
 * Real PDF encryption — the Standard Security Handler, V=4 / R=4 with the
 * AESV2 crypt filter (AES-128-CBC). Produces files that open password-
 * protected in Adobe Acrobat, Chrome, Firefox and any spec-compliant reader.
 *
 * This replaces the previous placeholder that only tagged metadata. The
 * algorithms follow ISO 32000-1 §7.6 (Algorithms 2, 3, 5 and 1).
 *
 * Usage:
 *   await encryptPdf(pdfDoc, { userPassword, ownerPassword, permissions });
 *   const bytes = await pdfDoc.save({ useObjectStreams: false });
 */
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  PDFHexString,
  PDFDict,
  PDFArray,
  PDFStream,
  PDFRawStream,
  PDFRef,
  type PDFObject,
} from 'pdf-lib';
import {
  md5,
  rc4,
  concat,
  padPassword,
  randomBytes,
  bytesToHex,
  aesCbcEncrypt,
} from './crypto-primitives';
import { buildR6 } from './crypto-256';

export interface Permissions {
  printing: boolean;
  copying: boolean;
  modifying: boolean;
  annotating: boolean;
}

const KEY_LEN = 16; // 128-bit
const AES_SALT = new Uint8Array([0x73, 0x41, 0x6c, 0x54]); // "sAlT"

/** Build the 32-bit permissions flags (P), as a signed integer. */
export function computeP(perm: Permissions): number {
  // Start with the reserved high bits set (per spec, bits 13–32 are 1) and
  // the two low reserved bits clear.
  let p = -1; // 0xFFFFFFFF, all bits set
  p &= ~0b1; // bit 1 reserved 0
  p &= ~0b10; // bit 2 reserved 0
  if (!perm.printing) p &= ~(1 << 2); // bit 3
  if (!perm.modifying) p &= ~(1 << 3); // bit 4
  if (!perm.copying) p &= ~(1 << 4); // bit 5
  if (!perm.annotating) p &= ~(1 << 5); // bit 6
  // bit 9 (fill forms) follows "modifying"; bit 11 (assemble) follows
  // "modifying"; bit 12 (print high-res) follows "printing".
  if (!perm.modifying) {
    p &= ~(1 << 8);
    p &= ~(1 << 10);
  }
  if (!perm.printing) p &= ~(1 << 11);
  return p | 0; // force signed 32-bit
}

function p32le(p: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = p & 0xff;
  out[1] = (p >>> 8) & 0xff;
  out[2] = (p >>> 16) & 0xff;
  out[3] = (p >>> 24) & 0xff;
  return out;
}

/** Algorithm 3: compute the /O (owner) entry. */
export function computeO(ownerPw: string, userPw: string): Uint8Array {
  const padded = padPassword(ownerPw || userPw);
  let hash = md5(padded);
  for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, KEY_LEN));
  const rc4key = hash.subarray(0, KEY_LEN);
  let enc = rc4(rc4key, padPassword(userPw));
  for (let i = 1; i <= 19; i++) {
    const k = new Uint8Array(KEY_LEN);
    for (let b = 0; b < KEY_LEN; b++) k[b] = rc4key[b] ^ i;
    enc = rc4(k, enc);
  }
  return enc; // 32 bytes
}

/** Algorithm 2: compute the file encryption key. */
export function computeKey(
  userPw: string,
  O: Uint8Array,
  P: number,
  id0: Uint8Array,
): Uint8Array {
  const input = concat(padPassword(userPw), O, p32le(P), id0);
  let hash = md5(input);
  for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, KEY_LEN));
  return hash.subarray(0, KEY_LEN);
}

/** Algorithm 5: compute the /U (user) entry for R>=3. */
export function computeU(key: Uint8Array, id0: Uint8Array): Uint8Array {
  const h = md5(concat(padPassword(''), id0));
  let enc = rc4(key, h);
  for (let i = 1; i <= 19; i++) {
    const k = new Uint8Array(KEY_LEN);
    for (let b = 0; b < KEY_LEN; b++) k[b] = key[b] ^ i;
    enc = rc4(k, enc);
  }
  // Pad to 32 bytes with arbitrary (zero) bytes.
  return concat(enc, new Uint8Array(16));
}

/** Algorithm 1 (AESV2): derive the per-object AES key. */
export function objectKey(
  fileKey: Uint8Array,
  objNum: number,
  gen: number,
): Uint8Array {
  const ext = concat(
    fileKey,
    new Uint8Array([objNum & 0xff, (objNum >> 8) & 0xff, (objNum >> 16) & 0xff]),
    new Uint8Array([gen & 0xff, (gen >> 8) & 0xff]),
    AES_SALT,
  );
  const n = Math.min(fileKey.length + 5, 16);
  return md5(ext).subarray(0, n);
}

/**
 * Encrypts the document in place and writes the /Encrypt dictionary. After
 * this, save with `{ useObjectStreams: false }` so every object is a plain,
 * individually-encrypted indirect object.
 */
export async function encryptPdf(
  doc: PDFDocument,
  opts: {
    userPassword: string;
    ownerPassword?: string;
    permissions?: Permissions;
    /** Use AES-256 (V5/R6, PDF 2.0) instead of AES-128 (V4/R4). */
    aes256?: boolean;
  },
): Promise<void> {
  const ctx = doc.context;
  const userPw = opts.userPassword;
  const ownerPw = opts.ownerPassword || opts.userPassword;
  const perm: Permissions = opts.permissions ?? {
    printing: true,
    copying: true,
    modifying: true,
    annotating: true,
  };
  const aes256 = !!opts.aes256;

  // Stable document ID (first element feeds the V4 key derivation; for R6 it's
  // informational but readers still expect a /ID).
  const id0 = randomBytes(16);

  const P = computeP(perm);

  // Key material differs per revision. In R6 every object is encrypted with the
  // 32-byte file key directly (no per-object derivation); in R4 each object
  // gets its own AESV2 key via Algorithm 1.
  let O: Uint8Array;
  let U: Uint8Array;
  let fileKey: Uint8Array;
  let r6: { UE: Uint8Array; OE: Uint8Array; Perms: Uint8Array } | null = null;
  if (aes256) {
    const m = await buildR6(userPw, ownerPw, P, true);
    O = m.O;
    U = m.U;
    fileKey = m.fileKey;
    r6 = { UE: m.UE, OE: m.OE, Perms: m.Perms };
  } else {
    O = computeO(ownerPw, userPw);
    fileKey = computeKey(userPw, O, P, id0);
    U = computeU(fileKey, id0);
  }

  // Collect every indirect object BEFORE adding the /Encrypt dict so we never
  // encrypt the security dictionary itself.
  const objects = ctx.enumerateIndirectObjects();

  // Encrypt strings & streams. subtle.encrypt is async, so gather tasks.
  const tasks: Promise<void>[] = [];

  function walk(obj: PDFObject, key: Uint8Array) {
    if (obj instanceof PDFString || obj instanceof PDFHexString) {
      // Handled by the parent via replacement (see encryptStringValue).
      return;
    }
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const el = obj.get(i);
        if (el instanceof PDFString || el instanceof PDFHexString) {
          tasks.push(
            encryptStringValue(el, key).then((rep) => obj.set(i, rep)),
          );
        } else {
          walk(el, key);
        }
      }
    } else if (obj instanceof PDFDict) {
      for (const [k, v] of obj.entries()) {
        if (v instanceof PDFString || v instanceof PDFHexString) {
          tasks.push(
            encryptStringValue(v, key).then((rep) => obj.set(k, rep)),
          );
        } else {
          walk(v, key);
        }
      }
    }
  }

  async function encryptStringValue(
    s: PDFString | PDFHexString,
    key: Uint8Array,
  ): Promise<PDFHexString> {
    const plain = s.asBytes();
    const enc = await aesCbcEncrypt(key, plain);
    return PDFHexString.of(bytesToHex(enc));
  }

  for (const [ref, obj] of objects) {
    const key = aes256
      ? fileKey
      : objectKey(fileKey, ref.objectNumber, ref.generationNumber);
    if (obj instanceof PDFStream) {
      // Encrypt the stream's raw (already-filtered) bytes.
      if (obj instanceof PDFRawStream) {
        const plain = obj.contents;
        tasks.push(
          aesCbcEncrypt(key, plain).then((enc) => {
            (obj as any).contents = enc;
            obj.dict.set(PDFName.of('Length'), PDFNumber.of(enc.length));
          }),
        );
      }
      // Encrypt strings inside the stream dictionary too.
      walk(obj.dict, key);
    } else {
      walk(obj, key);
    }
  }

  await Promise.all(tasks);

  // Build and register the /Encrypt dictionary.
  const encryptDict = aes256
    ? ctx.obj({
        Filter: PDFName.of('Standard'),
        V: PDFNumber.of(5),
        R: PDFNumber.of(6),
        Length: PDFNumber.of(256),
        CF: ctx.obj({
          StdCF: ctx.obj({
            CFM: PDFName.of('AESV3'),
            Length: PDFNumber.of(32),
            AuthEvent: PDFName.of('DocOpen'),
          }),
        }),
        StmF: PDFName.of('StdCF'),
        StrF: PDFName.of('StdCF'),
        O: PDFHexString.of(bytesToHex(O)),
        U: PDFHexString.of(bytesToHex(U)),
        OE: PDFHexString.of(bytesToHex(r6!.OE)),
        UE: PDFHexString.of(bytesToHex(r6!.UE)),
        Perms: PDFHexString.of(bytesToHex(r6!.Perms)),
        P: PDFNumber.of(P),
        EncryptMetadata: true,
      })
    : ctx.obj({
        Filter: PDFName.of('Standard'),
        V: PDFNumber.of(4),
        R: PDFNumber.of(4),
        Length: PDFNumber.of(KEY_LEN * 8),
        CF: ctx.obj({
          StdCF: ctx.obj({
            CFM: PDFName.of('AESV2'),
            Length: PDFNumber.of(KEY_LEN),
            AuthEvent: PDFName.of('DocOpen'),
          }),
        }),
        StmF: PDFName.of('StdCF'),
        StrF: PDFName.of('StdCF'),
        O: PDFHexString.of(bytesToHex(O)),
        U: PDFHexString.of(bytesToHex(U)),
        P: PDFNumber.of(P),
      });
  const encryptRef = ctx.register(encryptDict);

  // Wire up the trailer: /Encrypt reference + stable /ID.
  ctx.trailerInfo.Encrypt = encryptRef;
  const idHex = PDFHexString.of(bytesToHex(id0));
  ctx.trailerInfo.ID = ctx.obj([idHex, idHex]) as PDFArray;
}
