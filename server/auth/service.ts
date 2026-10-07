import crypto from 'node:crypto';
import { verifyPassphrase } from './passphrase.ts';
import type { AuthStore } from './store.ts';

export const COOKIE = 'sw_session';
const SESSION_DAYS = 30;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_TRACKED = 1000;

export class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

const sha = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function readCookie(header: string | undefined, name: string) {
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name)
      return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean) {
  const maxAge = SESSION_DAYS * 24 * 3600;
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
export const clearedCookie = `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

export class AuthService {
  store: AuthStore;
  alwaysRequired: boolean;
  // Failed attempts are counted per client address, so one stranger cannot lock the owner out.
  private attempts = new Map<string, { failures: number; lockedUntil: number }>();
  private delayMs: number;

  /** alwaysRequired: sign-in is mandatory (LAN mode) even before a passphrase exists. */
  constructor(store: AuthStore, opts: { alwaysRequired?: boolean; failureDelayMs?: number } = {}) {
    this.store = store;
    this.alwaysRequired = !!opts.alwaysRequired;
    this.delayMs = opts.failureDelayMs ?? 400;
  }

  async status(cookieHeader?: string) {
    const configured = (await this.store.getPassphrase()) !== null;
    return {
      required: this.alwaysRequired || configured,
      configured,
      authenticated: await this.isAuthenticated(cookieHeader),
    };
  }

  async isAuthenticated(cookieHeader?: string) {
    const token = readCookie(cookieHeader, COOKIE);
    return token ? this.store.hasSession(sha(token)) : false;
  }

  async login(passphrase: unknown, client = 'local'): Promise<string> {
    const record = await this.store.getPassphrase();
    if (!record)
      throw new AuthError(
        'No passphrase is set yet. Run ./scripts/set-passphrase.sh on the computer hosting the app.',
        503,
      );
    const now = Date.now();
    const state = this.attempts.get(client) ?? { failures: 0, lockedUntil: 0 };
    if (now < state.lockedUntil)
      throw new AuthError(
        `Too many attempts. Try again in ${Math.ceil((state.lockedUntil - now) / 60000)} minutes.`,
        429,
      );
    if (typeof passphrase !== 'string' || !(await verifyPassphrase(passphrase, record))) {
      if (++state.failures >= MAX_FAILURES) {
        state.lockedUntil = now + LOCKOUT_MS;
        state.failures = 0;
      }
      this.attempts.delete(client);
      this.attempts.set(client, state);
      // Bounded memory: forget the oldest addresses first.
      while (this.attempts.size > MAX_TRACKED)
        this.attempts.delete(this.attempts.keys().next().value!);
      await new Promise((r) => setTimeout(r, this.delayMs));
      throw new AuthError('Incorrect passphrase', 401);
    }
    this.attempts.delete(client);
    const token = crypto.randomBytes(32).toString('base64url');
    await this.store.createSession(sha(token), new Date(now + SESSION_DAYS * 24 * 3600 * 1000));
    return token;
  }

  async logout(cookieHeader?: string) {
    const token = readCookie(cookieHeader, COOKIE);
    if (token) await this.store.deleteSession(sha(token));
  }
}
