/**
 * Low-level crypto primitives for the PDF Standard Security Handler.
 * Kept dependency-light and environment-agnostic (Node + browser) so they
 * can be unit-tested with Vitest.
 */
import SparkMD5 from 'spark-md5';

/** The 32-byte password-padding string from the PDF spec (Algorithm 2). */
export const PASSWORD_PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56,
  0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

export function md5(data: Uint8Array): Uint8Array {
  const spark = new SparkMD5.ArrayBuffer();
  spark.append(
    data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer,
  );
  return hexToBytes(spark.end());
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

export function concat(...arrays: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const a of arrays) len += a.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

/** Latin-1 / byte encoding of a password string. */
export function passwordBytes(pw: string): Uint8Array {
  const out = new Uint8Array(pw.length);
  for (let i = 0; i < pw.length; i++) out[i] = pw.charCodeAt(i) & 0xff;
  return out;
}

/** Pad or truncate a password to exactly 32 bytes (Algorithm 2 step a). */
export function padPassword(pw: string): Uint8Array {
  const pb = passwordBytes(pw);
  const out = new Uint8Array(32);
  if (pb.length >= 32) {
    out.set(pb.subarray(0, 32));
  } else {
    out.set(pb);
    out.set(PASSWORD_PAD.subarray(0, 32 - pb.length), pb.length);
  }
  return out;
}

/** Symmetric RC4 (used only for /O and /U computation, never for content). */
export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 0xff;
    b = (b + s[a]) & 0xff;
    [s[a], s[b]] = [s[b], s[a]];
    out[k] = data[k] ^ s[(s[a] + s[b]) & 0xff];
  }
  return out;
}

/** Cryptographically-random bytes (works in browser + Node). */
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** AES-128-CBC encrypt with the standard PDF layout: output = IV ++ ciphertext (PKCS#7). */
export async function aesCbcEncrypt(
  key: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const iv = randomBytes(16);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    { name: 'AES-CBC' },
    false,
    ['encrypt'],
  );
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: iv as BufferSource },
    cryptoKey,
    data as BufferSource,
  );
  return concat(iv, new Uint8Array(ct));
}

/** AES-128-CBC decrypt (used in tests / round-trip verification). */
export async function aesCbcDecrypt(
  key: Uint8Array,
  ivAndCt: Uint8Array,
): Promise<Uint8Array> {
  const iv = ivAndCt.subarray(0, 16);
  const ct = ivAndCt.subarray(16);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    { name: 'AES-CBC' },
    false,
    ['decrypt'],
  );
  const pt = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: iv as BufferSource },
    cryptoKey,
    ct as BufferSource,
  );
  return new Uint8Array(pt);
}
