import crypto from 'node:crypto';
import { hashPassphrase, verifyPassphrase } from './passphrase.ts';
import { newSetupCode, setupCodeMatches } from './setup-code.ts';
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
      // First run in LAN mode: the sign-in page offers to create the passphrase, with the setup code.
      setup: this.alwaysRequired && !configured,
      setupCode: this.alwaysRequired && !configured,
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
        'No passphrase is set yet. Open the app in a browser to create one.',
        503,
      );
    const now = Date.now();
    const state = this.checkLock(client, now);
    if (typeof passphrase !== 'string' || !(await verifyPassphrase(passphrase, record))) {
      await this.fail(client, state, now);
      throw new AuthError('Incorrect passphrase', 401);
    }
    return this.startSession(client, now);
  }

  /**
   * First run: choose the passphrase and sign in. Only while none exists. In LAN mode it also needs the
   * one-time setup code printed on the host (./scripts/setup-code.sh), counted against the same lockout as sign-in.
   */
  async setup(passphrase: unknown, code: unknown, client = 'local'): Promise<string> {
    if (await this.store.getPassphrase()) throw new AuthError('A passphrase is already set', 409);
    const now = Date.now();
    const state = this.checkLock(client, now);
    if (this.alwaysRequired) {
      const stored = await this.store.getSetupCode();
      if (!stored || Date.parse(stored.expiresAt) <= now)
        throw new AuthError(
          'There is no valid setup code. Run ./scripts/setup-code.sh on the computer hosting the app.',
          403,
        );
      if (!setupCodeMatches(code, stored, now)) {
        await this.fail(client, state, now);
        throw new AuthError('Incorrect setup code', 403);
      }
    }
    if (typeof passphrase !== 'string') throw new AuthError('Enter a passphrase', 400);
    let record;
    try {
      record = await hashPassphrase(passphrase);
    } catch (e: any) {
      throw new AuthError(e.message, 400);
    }
    if (!(await this.store.createPassphrase(record)))
      throw new AuthError('A passphrase is already set', 409);
    return this.startSession(client, now);
  }

  /** Makes a fresh setup code for the host's terminal; null when a passphrase already exists. */
  async issueSetupCode() {
    if (await this.store.getPassphrase()) return null;
    const { code, record } = newSetupCode();
    await this.store.setSetupCode(record);
    return code;
  }

  private checkLock(client: string, now: number) {
    const state = this.attempts.get(client) ?? { failures: 0, lockedUntil: 0 };
    if (now < state.lockedUntil)
      throw new AuthError(
        `Too many attempts. Try again in ${Math.ceil((state.lockedUntil - now) / 60000)} minutes.`,
        429,
      );
    return state;
  }

  private async fail(
    client: string,
    state: { failures: number; lockedUntil: number },
    now: number,
  ) {
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
  }

  private async startSession(client: string, now: number) {
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
