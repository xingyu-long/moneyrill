import crypto from 'node:crypto';
import fs from 'node:fs';

const keyPath = () => process.env.KEY_FILE || 'secrets/token.key';

/** Why the token key cannot be used, in words that say what to do; null when it is fine. */
export function tokenKeyProblem(): string | null {
  let text: string;
  try {
    text = fs.readFileSync(keyPath(), 'utf8').trim();
  } catch (e: any) {
    const why =
      e.code === 'EACCES'
        ? 'it is not readable by this process. The container runs as user id 1000 (node): make the file readable by that user (chmod 644, or chown 1000)'
        : e.code === 'ENOENT'
          ? 'it does not exist. Run ./scripts/setup.sh to create one, and keep it: connections cannot be decrypted without it'
          : String(e.message);
    return `Cannot read the token key ${keyPath()}: ${why}.`;
  }
  return /^[0-9a-f]{64}$/i.test(text)
    ? null
    : `The token key ${keyPath()} must be 64 hex characters (openssl rand -hex 32).`;
}

const key = () => {
  const problem = tokenKeyProblem();
  if (problem) throw new Error(problem);
  return Buffer.from(fs.readFileSync(keyPath(), 'utf8').trim(), 'hex');
};
export function encrypt(value: string) {
  const iv = crypto.randomBytes(12),
    c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(value), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}
export function decrypt(value: string) {
  const b = Buffer.from(value, 'base64'),
    d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString();
}
