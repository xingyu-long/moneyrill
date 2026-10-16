import type { FastifyInstance } from 'fastify';
import { isApiRequest, routedPath } from '../lib/route.ts';
import { changeBody, setupBody } from '../lib/schemas.ts';
import { clearedCookie, sessionCookie, type AuthService } from '../auth/service.ts';

const OPEN = [
  '/api/health',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/setup',
  '/api/auth/logout',
];

export function authRoutes(app: FastifyInstance, auth: AuthService) {
  // Everything under /api needs a session, except the open endpoints.
  app.addHook('onRequest', async (req, reply) => {
    if (!isApiRequest(req) || OPEN.includes(routedPath(req))) return;
    const status = await auth.status(req.headers.cookie);
    if (!status.authenticated)
      return reply.code(401).send({
        error: status.configured
          ? 'Sign in required'
          : 'No passphrase is set yet. Open the app in a browser to create one.',
      });
  });
  app.get('/api/auth/status', async (req) => auth.status(req.headers.cookie));
  app.post('/api/auth/login', async (req, reply) => {
    const token = await auth.login((req.body as any)?.passphrase, req.ip);
    const secure = req.headers['x-forwarded-proto'] === 'https';
    reply.header('Set-Cookie', sessionCookie(token, secure));
    return { ok: true };
  });
  app.post('/api/auth/setup', async (req, reply) => {
    const body = setupBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Enter a passphrase' });
    const token = await auth.setup(body.data.passphrase, req.ip);
    const secure = req.headers['x-forwarded-proto'] === 'https';
    reply.header('Set-Cookie', sessionCookie(token, secure));
    return { ok: true };
  });
  app.post('/api/auth/passphrase', async (req, reply) => {
    const body = changeBody.safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({ error: 'Enter your passphrase and a new one' });
    const token = await auth.change(
      body.data.current,
      body.data.passphrase,
      req.headers.cookie,
      req.ip,
    );
    const secure = req.headers['x-forwarded-proto'] === 'https';
    reply.header('Set-Cookie', sessionCookie(token, secure));
    return { ok: true };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    await auth.logout(req.headers.cookie);
    reply.header('Set-Cookie', clearedCookie);
    return { ok: true };
  });
}
