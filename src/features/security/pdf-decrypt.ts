/**
 * Decrypts password-protected PDFs (Standard Security Handler) so they can be
 * viewed AND edited. Supports the two most common schemes:
 *   - V1/V2, R2–R4 with RC4
 *   - V4, R4 with the AESV2 crypt filter (AES-128-CBC)
 *
 * Produces a clean, unencrypted PDF (the /Encrypt entry is removed). The same
 * crypto primitives that power encryption are reused in the decrypt direction.
 *
 * Returns { ok:false, needsPassword } when the file is encrypted but no/After
 * a wrong password was supplied, so the UI can prompt.
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
import { md5, rc4, concat, padPassword } from './crypto-primitives';
import { aesCbcDecrypt } from './crypto-primitives';
import { computeKey, computeU, objectKey } from './pdf-encrypt';
import {
  fileKeyFromUserPassword,
  fileKeyFromOwnerPassword,
} from './crypto-256';

export interface DecryptResult {
  ok: boolean;
  /** True if the file is encrypted (regardless of success). */
  encrypted: boolean;
  /** Set when ok — the decrypted, unencrypted PDF bytes. */
  bytes?: Uint8Array;
  /** Set when the password is needed or wrong. */
  needsPassword?: boolean;
  reason?: string;
}

const AES_SALT = new Uint8Array([0x73, 0x41, 0x6c, 0x54]);

function getNum(d: PDFDict, key: string, def = 0): number {
  const v = d.get(PDFName.of(key));
  return v instanceof PDFNumber ? v.asNumber() : def;
}

function asBytes(o: PDFObject | undefined): Uint8Array | null {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.asBytes();
  return null;
}

/** RC4 per-object key (V2): md5(fileKey + obj(3) + gen(2))[:min(n+5,16)]. */
function rc4ObjectKey(fileKey: Uint8Array, num: number, gen: number): Uint8Array {
  const ext = concat(
    fileKey,
    new Uint8Array([num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff]),
    new Uint8Array([gen & 0xff, (gen >> 8) & 0xff]),
  );
  return md5(ext).subarray(0, Math.min(fileKey.length + 5, 16));
}

export async function decryptPdf(
  input: Uint8Array,
  password: string,
): Promise<DecryptResult> {
  const doc = await PDFDocument.load(input, { ignoreEncryption: true });
  const ctx = doc.context;
  const encRef = ctx.trailerInfo.Encrypt;
  if (!encRef) {
    return { ok: true, encrypted: false, bytes: input };
  }
  const encDict = ctx.lookup(encRef);
  if (!(encDict instanceof PDFDict)) {
    return { ok: true, encrypted: false, bytes: input };
  }

  const V = getNum(encDict, 'V', 0);
  const R = getNum(encDict, 'R', 0);
  const lengthBits = getNum(encDict, 'Length', 40);
  const O = asBytes(encDict.get(PDFName.of('O')));
  const P = getNum(encDict, 'P', 0) | 0;
  const idArr = ctx.lookup(ctx.trailerInfo.ID);
  let id0: Uint8Array = new Uint8Array(0);
  if (idArr instanceof PDFArray) {
    const b = asBytes(idArr.get(0));
    if (b) id0 = b as Uint8Array;
  }

  if (!O) return { ok: false, encrypted: true, reason: 'Falta /O' };

  // Detect the crypt-filter method (AESV2 / AESV3 vs RC4).
  let useAes = false;
  let aes256 = false;
  if (V >= 4) {
    const cf = ctx.lookup(encDict.get(PDFName.of('CF')));
    const stmF = encDict.get(PDFName.of('StmF'));
    const stdName =
      stmF instanceof PDFName ? stmF.asString().replace(/^\//, '') : 'StdCF';
    if (cf instanceof PDFDict) {
      const std = ctx.lookup(cf.get(PDFName.of(stdName)));
      if (std instanceof PDFDict) {
        const cfm = std.get(PDFName.of('CFM'));
        if (cfm instanceof PDFName && cfm.asString().includes('AESV2')) {
          useAes = true;
        } else if (cfm instanceof PDFName && cfm.asString().includes('AESV3')) {
          useAes = true;
          aes256 = true;
        }
      }
    }
  }

  let key: Uint8Array;
  if (V >= 5 || R >= 6 || aes256) {
    // AES-256 (R6 / AESV3): recover the 32-byte file key from either password.
    const U = asBytes(encDict.get(PDFName.of('U')));
    const UE = asBytes(encDict.get(PDFName.of('UE')));
    const OE = asBytes(encDict.get(PDFName.of('OE')));
    if (!U || !UE) {
      return { ok: false, encrypted: true, reason: 'Faltan /U o /UE (R6)' };
    }
    let fk = await fileKeyFromUserPassword(password, U, UE);
    if (!fk && OE) {
      fk = await fileKeyFromOwnerPassword(password, O!, OE, U);
    }
    if (!fk) {
      return {
        ok: false,
        encrypted: true,
        needsPassword: true,
        reason: 'Contraseña incorrecta',
      };
    }
    key = fk; // 32 bytes — used directly for every object (no per-object key)
  } else {
    const keyLen = V >= 2 ? Math.floor(lengthBits / 8) : 5;
    // Derive the file key from the supplied password and verify it (Alg. 6).
    const k = computeKey(password, O!, P, id0);
    key = keyLen === 16 ? k : k.subarray(0, keyLen);
    // Verify: recompute U and compare to stored /U (first 16 bytes for R>=3).
    const Ustored = asBytes(encDict.get(PDFName.of('U')));
    if (Ustored && R >= 3) {
      const Ucalc = computeU(key, id0);
      const a = Array.from(Ucalc.subarray(0, 16));
      const b = Array.from(Ustored.subarray(0, 16));
      if (a.join(',') !== b.join(',')) {
        return { ok: false, encrypted: true, needsPassword: true, reason: 'Contraseña incorrecta' };
      }
    }
  }

  const encRefObjNum =
    encRef instanceof PDFRef ? encRef.objectNumber : -1;

  // Decrypt strings & streams.
  async function decBytes(
    data: Uint8Array,
    num: number,
    gen: number,
  ): Promise<Uint8Array> {
    if (aes256) {
      // R6: the file key encrypts every object directly (AES-256-CBC).
      return aesCbcDecrypt(key, data);
    }
    if (useAes) {
      const okey = objectKey(key, num, gen); // includes sAlT
      return aesCbcDecrypt(okey, data);
    }
    const okey = rc4ObjectKey(key, num, gen);
    return rc4(okey, data);
  }

  const tasks: Promise<void>[] = [];

  // Each decrypt task is self-contained: if it throws it leaves the value
  // untouched. The password was already validated via /U, so a per-value
  // failure means that value is ALREADY plaintext — e.g. /Producer and
  // /ModDate, which pdf-lib rewrites unencrypted after the encryption pass.
  // Leaving those as-is is exactly correct.
  function decStringInto(
    setter: (rep: PDFHexString) => void,
    bytes: Uint8Array,
    num: number,
    gen: number,
  ) {
    tasks.push(
      decBytes(bytes, num, gen)
        .then((d) => setter(PDFHexString.of(toHex(d))))
        .catch(() => {
          /* already plaintext — keep it */
        }),
    );
  }

  function walk(obj: PDFObject, num: number, gen: number) {
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const el = obj.get(i);
        if (el instanceof PDFString || el instanceof PDFHexString) {
          decStringInto((rep) => obj.set(i, rep), el.asBytes(), num, gen);
        } else {
          walk(el, num, gen);
        }
      }
    } else if (obj instanceof PDFDict) {
      for (const [k, v] of obj.entries()) {
        if (v instanceof PDFString || v instanceof PDFHexString) {
          decStringInto((rep) => obj.set(k, rep), v.asBytes(), num, gen);
        } else {
          walk(v, num, gen);
        }
      }
    }
  }

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (ref.objectNumber === encRefObjNum) continue; // never the /Encrypt dict
    const num = ref.objectNumber;
    const gen = ref.generationNumber;
    if (obj instanceof PDFStream) {
      if (obj instanceof PDFRawStream) {
        const raw = obj;
        tasks.push(
          decBytes(raw.contents, num, gen)
            .then((d) => {
              (raw as any).contents = d;
              raw.dict.set(PDFName.of('Length'), PDFNumber.of(d.length));
            })
            .catch(() => {
              /* stream not encrypted (rare) — keep it */
            }),
        );
      }
      walk(obj.dict, num, gen);
    } else {
      walk(obj, num, gen);
    }
  }

  await Promise.all(tasks);

  // Remove the encryption so the result is a normal PDF.
  delete (ctx.trailerInfo as any).Encrypt;

  const out = await doc.save({ useObjectStreams: false });
  return { ok: true, encrypted: true, bytes: out };
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}
