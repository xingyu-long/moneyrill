import Fastify from 'fastify';
import statics from '@fastify/static';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './lib/config.ts';
import { isAllowedHost, isAllowedOrigin } from './lib/hosts.ts';
import { log } from './lib/log.ts';
import { isApiRequest } from './lib/route.ts';
import { AuthService } from './auth/service.ts';
import { DbAuthStore, type AuthStore } from './auth/store.ts';
import { authRoutes } from './routes/auth.ts';
import { overviewRoutes } from './routes/overview.ts';
import { syncRoutes } from './routes/sync.ts';
import { linkRoutes } from './routes/link.ts';
import { accountRoutes } from './routes/accounts.ts';
import { archiveRoutes } from './routes/archive.ts';
import { ruleRoutes } from './routes/rules.ts';
import { transactionRoutes } from './routes/transactions.ts';
import { reportRoutes } from './routes/reports.ts';
import { investmentRoutes } from './routes/investments.ts';

/**
 * Content-Security-Policy for the bundled page. The only inline script is the theme setter in index.html, allowed by
 * its hash (read from the built page, so editing it never needs a policy change). Plaid Link loads its script and
 * frame from cdn.plaid.com.
 */
export function contentSecurityPolicy(indexHtml: string | null) {
  const hashes = [
    ...(indexHtml ?? '').matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g),
  ].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  return [
    "default-src 'self'",
    `script-src 'self' https://cdn.plaid.com ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.plaid.com",
    'frame-src https://cdn.plaid.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export async function createApp(opts: { authStore?: AuthStore; failureDelayMs?: number } = {}) {
  const app = Fastify({
    logger: false,
    bodyLimit: 12 * 1024 * 1024,
    trustProxy: config.trustProxy,
  });
  let indexHtml: string | null = null;
  try {
    indexHtml = fs.readFileSync(path.resolve('dist', 'index.html'), 'utf8');
  } catch {
    // not built yet (tests): the policy then has no inline-script hash
  }
  const csp = contentSecurityPolicy(indexHtml);
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Content-Security-Policy', csp);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  });
  app.addHook('onRequest', async (req, reply) => {
    if (!isApiRequest(req)) return;
    reply.header('Cache-Control', 'no-store');
    if (!isAllowedHost(req.headers.host, config.allowLan))
      return reply.code(403).send({ error: 'Local access only' });
    if (
      req.headers.origin &&
      !isAllowedOrigin(req.headers.origin, req.headers.host, config.origin, config.allowLan)
    )
      return reply.code(403).send({ error: 'Origin not allowed' });
    if (req.headers['sec-fetch-site'] === 'cross-site')
      return reply.code(403).send({ error: 'Origin not allowed' });
  });
  app.setErrorHandler((error: any, req, reply) => {
    const code = error.response?.data?.error_code || error.message || 'Request failed';
    log.warn('request.failed', { method: req.method, route: req.url.split('?')[0], code });
    return reply.code(error.statusCode || 400).send({ error: code });
  });
  const auth = new AuthService(opts.authStore ?? new DbAuthStore(), {
    failureDelayMs: opts.failureDelayMs,
  });
  authRoutes(app, auth);
  overviewRoutes(app);
  syncRoutes(app);
  linkRoutes(app);
  accountRoutes(app);
  archiveRoutes(app);
  transactionRoutes(app);
  ruleRoutes(app);
  reportRoutes(app);
  investmentRoutes(app);
  await app.register(statics, { root: path.resolve('dist') });
  app.setNotFoundHandler((req, reply) =>
    isApiRequest(req)
      ? reply.code(404).send({ error: 'Unknown endpoint' })
      : reply.sendFile('index.html'),
  );
  return app;
}
