import { describe, it, expect } from 'vitest';
import {
  hash2B,
  buildR6,
  fileKeyFromUserPassword,
  fileKeyFromOwnerPassword,
} from './crypto-256';

describe('AES-256 (R6) key derivation', () => {
  it('Algorithm 2.B is deterministic and 32 bytes', async () => {
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const a = await hash2B('s3cr3t', salt, new Uint8Array(0));
    const b = await hash2B('s3cr3t', salt, new Uint8Array(0));
    expect(a.length).toBe(32);
    expect([...a]).toEqual([...b]);
  });

  it('different passwords produce different hashes', async () => {
    const salt = new Uint8Array(8).fill(9);
    const a = await hash2B('right', salt, new Uint8Array(0));
    const b = await hash2B('wrong', salt, new Uint8Array(0));
    expect([...a]).not.toEqual([...b]);
  });

  it('recovers the file key from the USER password', async () => {
    const m = await buildR6('user-pw', 'owner-pw', -44, true);
    const fk = await fileKeyFromUserPassword('user-pw', m.U, m.UE);
    expect(fk).not.toBeNull();
    expect([...fk!]).toEqual([...m.fileKey]);
  });

  it('recovers the file key from the OWNER password', async () => {
    const m = await buildR6('user-pw', 'owner-pw', -44, true);
    const fk = await fileKeyFromOwnerPassword('owner-pw', m.O, m.OE, m.U);
    expect(fk).not.toBeNull();
    expect([...fk!]).toEqual([...m.fileKey]);
  });

  it('rejects a wrong user password (returns null)', async () => {
    const m = await buildR6('user-pw', 'owner-pw', -44, true);
    const fk = await fileKeyFromUserPassword('nope', m.U, m.UE);
    expect(fk).toBeNull();
  });

  it('produces the canonical entry sizes (U/O 48, UE/OE 32, Perms 16)', async () => {
    const m = await buildR6('a', 'b', -1, true);
    expect(m.U.length).toBe(48);
    expect(m.O.length).toBe(48);
    expect(m.UE.length).toBe(32);
    expect(m.OE.length).toBe(32);
    expect(m.Perms.length).toBe(16);
    expect(m.fileKey.length).toBe(32);
  });
});
