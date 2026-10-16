import crypto from 'node:crypto';

export type SetupCodeRecord = { hash: string; expiresAt: string };

export const SETUP_CODE_TTL_MS = 60 * 60 * 1000;
// No 0/O/1/I: the code is read off a terminal and typed on another device.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 8;

/** Letters and digits only, upper case: spaces and dashes typed or pasted with the code do not matter. */
export const normalizeSetupCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const hashSetupCode = (code: string) =>
  crypto.createHash('sha256').update(normalizeSetupCode(code)).digest('hex');

/** A new random code (shown as XXXX-XXXX) and the record to store: only its hash is kept. */
export function newSetupCode(now = Date.now()) {
  const bytes = crypto.randomBytes(LENGTH);
  // 256 is a multiple of 32, so the modulo adds no bias.
  const raw = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  const record: SetupCodeRecord = {
    hash: hashSetupCode(code),
    expiresAt: new Date(now + SETUP_CODE_TTL_MS).toISOString(),
  };
  return { code, record };
}

export function setupCodeMatches(code: unknown, record: SetupCodeRecord, now = Date.now()) {
  if (typeof code !== 'string' || Date.parse(record.expiresAt) <= now) return false;
  const given = Buffer.from(hashSetupCode(code));
  const stored = Buffer.from(record.hash);
  return given.length === stored.length && crypto.timingSafeEqual(given, stored);
}
