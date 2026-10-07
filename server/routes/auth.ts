import type { FastifyInstance } from 'fastify';
import { clearedCookie, sessionCookie, type AuthService } from '../auth/service.ts';

const OPEN = ['/api/health', '/api/auth/status', '/api/auth/login', '/api/auth/logout'];

export function authRoutes(app: FastifyInstance, auth: AuthService) {
  // Everything under /api needs a session, except the open endpoints, once sign-in is required.
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api') || OPEN.includes(path)) return;
    const status = await auth.status(req.headers.cookie);
    if (status.required && !status.authenticated)
      return reply.code(401).send({
        error: status.configured
          ? 'Sign in required'
          : 'No passphrase is set yet. Run ./scripts/set-passphrase.sh on the computer hosting the app.',
      });
  });
  app.get('/api/auth/status', async (req) => auth.status(req.headers.cookie));
  app.post('/api/auth/login', async (req, reply) => {
    const token = await auth.login((req.body as any)?.passphrase, req.ip);
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
