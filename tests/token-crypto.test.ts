import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keytest-'));
const keyFile = path.join(dir, 'token.key');
fs.writeFileSync(keyFile, 'a'.repeat(64));
process.env.KEY_FILE = keyFile;
const { encrypt, decrypt } = await import('../server/services/token-crypto.ts');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('encrypted tokens round-trip and are not stored in plain text', () => {
  const token = 'access-production-1234';
  const sealed = encrypt(token);
  assert.notEqual(sealed, token);
  assert.ok(!Buffer.from(sealed, 'base64').toString('latin1').includes(token));
  assert.equal(decrypt(sealed), token);
});

test('every encryption uses a fresh nonce', () => {
  assert.notEqual(encrypt('same'), encrypt('same'));
});

test('tampered ciphertext is rejected', () => {
  const buf = Buffer.from(encrypt('secret'), 'base64');
  buf[buf.length - 1] ^= 1;
  assert.throws(() => decrypt(buf.toString('base64')));
});

test('a missing, unreadable or malformed key is explained, not a bare stack trace', async () => {
  const { tokenKeyProblem } = await import('../server/services/token-crypto.ts');
  assert.equal(tokenKeyProblem(), null);
  const was = process.env.KEY_FILE;
  try {
    process.env.KEY_FILE = path.join(dir, 'missing.key');
    assert.match(tokenKeyProblem()!, /does not exist.*setup\.sh/);
    assert.throws(() => encrypt('x'), /does not exist/);
    const bad = path.join(dir, 'bad.key');
    fs.writeFileSync(bad, 'not hex');
    process.env.KEY_FILE = bad;
    assert.match(tokenKeyProblem()!, /64 hex characters/);
    const locked = path.join(dir, 'locked.key');
    fs.writeFileSync(locked, 'a'.repeat(64), { mode: 0o000 });
    process.env.KEY_FILE = locked;
    if (process.getuid?.() !== 0) assert.match(tokenKeyProblem()!, /not readable.*user id 1000/);
  } finally {
    process.env.KEY_FILE = was;
  }
});
