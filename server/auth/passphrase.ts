import crypto from 'node:crypto';

export type PassphraseRecord = { salt: string; hash: string; N: number; r: number; p: number };

const KEYLEN = 64;
const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
export const MIN_PASSPHRASE_LENGTH = 12;

const derive = (passphrase: string, salt: Buffer, params: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(
      passphrase.normalize('NFKC'),
      salt,
      KEYLEN,
      { ...params, maxmem: 128 * params.N * params.r * 2 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );

export async function hashPassphrase(passphrase: string): Promise<PassphraseRecord> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH)
    throw new Error(`Use at least ${MIN_PASSPHRASE_LENGTH} characters`);
  const salt = crypto.randomBytes(16);
  const key = await derive(passphrase, salt, PARAMS);
  return { salt: salt.toString('base64'), hash: key.toString('base64'), ...PARAMS };
}

export async function verifyPassphrase(passphrase: string, record: PassphraseRecord) {
  const key = await derive(passphrase, Buffer.from(record.salt, 'base64'), record);
  const expected = Buffer.from(record.hash, 'base64');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
