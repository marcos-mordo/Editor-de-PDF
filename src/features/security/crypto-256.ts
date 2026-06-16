/**
 * AES-256 (R6 / AESV3) primitives for the PDF 2.0 Standard Security Handler —
 * the encryption Adobe Acrobat uses by default. Implements ISO 32000-2
 * Algorithm 2.B (the iterated SHA-256/384/512 + AES-128 hash) and the R6 key
 * derivation for /U, /O, /UE, /OE, /Perms.
 *
 * WebCrypto cannot do AES-CBC without PKCS#7 padding, which Algorithm 2.B and
 * the UE/OE/Perms wrapping require, so aes-js handles those raw blocks. Content
 * streams use standard AES-256-CBC (PKCS#7 + prepended IV) for which WebCrypto
 * is fine.
 */
import aesjs from 'aes-js';
import { concat, randomBytes } from './crypto-primitives';

function passwordBytes(pw: string): Uint8Array {
  // PDF 2.0 uses UTF-8 (SASLprep) for R6 passwords; UTF-8 is the common case.
  return new TextEncoder().encode(pw);
}

async function sha(bytes: Uint8Array, bits: 256 | 384 | 512): Promise<Uint8Array> {
  const algo = bits === 256 ? 'SHA-256' : bits === 384 ? 'SHA-384' : 'SHA-512';
  const digest = await globalThis.crypto.subtle.digest(
    algo,
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  return new Uint8Array(digest);
}

/** AES-128-CBC, no padding (aes-js). Data length must be a multiple of 16. */
function aes128CbcNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const cbc = new aesjs.ModeOfOperation.cbc(key, iv);
  return cbc.encrypt(data);
}

/** AES-256-CBC, no padding, IV = 0 (used to wrap the file key in UE/OE). */
function aes256CbcNoPadZeroIv(key: Uint8Array, data: Uint8Array): Uint8Array {
  const cbc = new aesjs.ModeOfOperation.cbc(key, new Uint8Array(16));
  return cbc.encrypt(data);
}
function aes256CbcNoPadZeroIvDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const cbc = new aesjs.ModeOfOperation.cbc(key, new Uint8Array(16));
  return cbc.decrypt(data);
}

/** AES-256-ECB no padding (used for /Perms). */
function aes256EcbNoPad(key: Uint8Array, data: Uint8Array): Uint8Array {
  const ecb = new aesjs.ModeOfOperation.ecb(key);
  return ecb.encrypt(data);
}
function aes256EcbNoPadDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const ecb = new aesjs.ModeOfOperation.ecb(key);
  return ecb.decrypt(data);
}

/**
 * Algorithm 2.B — the R6 hash. `udata` is empty for the user entries and the
 * 48-byte /U value for the owner entries.
 */
export async function hash2B(
  password: string,
  salt: Uint8Array,
  udata: Uint8Array,
): Promise<Uint8Array> {
  const pw = passwordBytes(password);
  let K = await sha(concat(pw, salt, udata), 256); // 32 bytes
  let round = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // K1 = (pw + K + udata) repeated 64 times
    const block = concat(pw, K, udata);
    const K1 = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) K1.set(block, i * block.length);
    // E = AES-128-CBC-noPad(key=K[0:16], iv=K[16:32], K1)
    const E = aes128CbcNoPad(K.subarray(0, 16), K.subarray(16, 32), K1);
    // mod = sum(first 16 bytes of E) % 3
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += E[i];
    const mod = sum % 3;
    K = await sha(E, mod === 0 ? 256 : mod === 1 ? 384 : 512);
    round++;
    if (round >= 64 && E[E.length - 1] <= round - 32) break;
  }
  return K.subarray(0, 32);
}

export interface R6Material {
  U: Uint8Array; // 48
  O: Uint8Array; // 48
  UE: Uint8Array; // 32
  OE: Uint8Array; // 32
  Perms: Uint8Array; // 16
  fileKey: Uint8Array; // 32
}

/** Build all R6 /Encrypt entries from the passwords + permissions + P. */
export async function buildR6(
  userPw: string,
  ownerPw: string,
  P: number,
  encryptMetadata: boolean,
): Promise<R6Material> {
  const fileKey = randomBytes(32);

  // --- User ---
  const uValSalt = randomBytes(8);
  const uKeySalt = randomBytes(8);
  const uHash = await hash2B(userPw, uValSalt, new Uint8Array(0));
  const U = concat(uHash, uValSalt, uKeySalt); // 48
  const uInter = await hash2B(userPw, uKeySalt, new Uint8Array(0));
  const UE = aes256CbcNoPadZeroIv(uInter, fileKey); // 32

  // --- Owner (udata = U) ---
  const oValSalt = randomBytes(8);
  const oKeySalt = randomBytes(8);
  const oHash = await hash2B(ownerPw, oValSalt, U);
  const O = concat(oHash, oValSalt, oKeySalt); // 48
  const oInter = await hash2B(ownerPw, oKeySalt, U);
  const OE = aes256CbcNoPadZeroIv(oInter, fileKey); // 32

  // --- Perms ---
  const perms = new Uint8Array(16);
  perms[0] = P & 0xff;
  perms[1] = (P >>> 8) & 0xff;
  perms[2] = (P >>> 16) & 0xff;
  perms[3] = (P >>> 24) & 0xff;
  perms[4] = 0xff;
  perms[5] = 0xff;
  perms[6] = 0xff;
  perms[7] = 0xff;
  perms[8] = encryptMetadata ? 0x54 /* 'T' */ : 0x46 /* 'F' */;
  perms[9] = 0x61; // 'a'
  perms[10] = 0x64; // 'd'
  perms[11] = 0x62; // 'b'
  const rnd = randomBytes(4);
  perms.set(rnd, 12);
  const Perms = aes256EcbNoPad(fileKey, perms); // 16

  return { U, O, UE, OE, Perms, fileKey };
}

/** Recover the file key from the user password (returns null if it's wrong). */
export async function fileKeyFromUserPassword(
  userPw: string,
  U: Uint8Array,
  UE: Uint8Array,
): Promise<Uint8Array | null> {
  const valSalt = U.subarray(32, 40);
  const keySalt = U.subarray(40, 48);
  const h = await hash2B(userPw, valSalt, new Uint8Array(0));
  // Validate against U[0:32].
  for (let i = 0; i < 32; i++) if (h[i] !== U[i]) return null;
  const inter = await hash2B(userPw, keySalt, new Uint8Array(0));
  return aes256CbcNoPadZeroIvDecrypt(inter, UE).subarray(0, 32);
}

/** Recover the file key from the owner password (returns null if wrong). */
export async function fileKeyFromOwnerPassword(
  ownerPw: string,
  O: Uint8Array,
  OE: Uint8Array,
  U: Uint8Array,
): Promise<Uint8Array | null> {
  const valSalt = O.subarray(32, 40);
  const keySalt = O.subarray(40, 48);
  const h = await hash2B(ownerPw, valSalt, U);
  for (let i = 0; i < 32; i++) if (h[i] !== O[i]) return null;
  const inter = await hash2B(ownerPw, keySalt, U);
  return aes256CbcNoPadZeroIvDecrypt(inter, OE).subarray(0, 32);
}

export { aes256EcbNoPadDecrypt };
