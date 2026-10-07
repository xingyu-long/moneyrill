import { pool } from '../db/pool.ts';
import type { PassphraseRecord } from './passphrase.ts';

export interface AuthStore {
  getPassphrase(): Promise<PassphraseRecord | null>;
  setPassphrase(record: PassphraseRecord | null): Promise<void>;
  createSession(tokenHash: string, expiresAt: Date): Promise<void>;
  hasSession(tokenHash: string): Promise<boolean>;
  deleteSession(tokenHash: string): Promise<void>;
}

export class DbAuthStore implements AuthStore {
  async getPassphrase() {
    const row = (await pool.query("SELECT value FROM settings WHERE key='auth_passphrase'"))
      .rows[0];
    return (row?.value as PassphraseRecord) ?? null;
  }
  async setPassphrase(record: PassphraseRecord | null) {
    if (record === null) {
      await pool.query("DELETE FROM settings WHERE key='auth_passphrase'");
    } else {
      await pool.query(
        `INSERT INTO settings(key,value) VALUES('auth_passphrase',$1)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        [JSON.stringify(record)],
      );
    }
    // Changing or clearing the passphrase signs every device out.
    await pool.query('DELETE FROM sessions');
  }
  async createSession(tokenHash: string, expiresAt: Date) {
    await pool.query('DELETE FROM sessions WHERE expires_at < now()');
    await pool.query('INSERT INTO sessions(token_hash, expires_at) VALUES($1,$2)', [
      tokenHash,
      expiresAt,
    ]);
  }
  async hasSession(tokenHash: string) {
    return (
      (
        await pool.query('SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at > now()', [
          tokenHash,
        ])
      ).rowCount === 1
    );
  }
  async deleteSession(tokenHash: string) {
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash]);
  }
}

/** In-memory store for tests. */
export class MemoryAuthStore implements AuthStore {
  passphrase: PassphraseRecord | null = null;
  sessions = new Map<string, Date>();
  async getPassphrase() {
    return this.passphrase;
  }
  async setPassphrase(record: PassphraseRecord | null) {
    this.passphrase = record;
    this.sessions.clear();
  }
  async createSession(tokenHash: string, expiresAt: Date) {
    this.sessions.set(tokenHash, expiresAt);
  }
  async hasSession(tokenHash: string) {
    const expires = this.sessions.get(tokenHash);
    return !!expires && expires.getTime() > Date.now();
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
}
