import type { FastifyInstance } from 'fastify';
import { log } from '../lib/log.ts';
import { ensure, linkBody } from '../lib/schemas.ts';
import { createLink, disconnect, saveConnection } from '../services/connections.ts';
import { syncAll } from '../services/sync.ts';

export function linkRoutes(app: FastifyInstance) {
  app.post('/api/link', async (req) =>
    createLink(ensure(linkBody, req.body, 'Invalid request')?.connectionId),
  );
  app.post('/api/connections/:id/disconnect', async (req) => disconnect((req.params as any).id));
  app.post('/api/exchange', async (req) => {
    const b = req.body as any;
    try {
      await saveConnection(b.public_token, ['transactions', 'investments']);
    } catch (e: any) {
      log.error('link.exchange_failed', { code: e.response?.data?.error_code || e.message });
      throw e;
    }
    return syncAll();
  });
}
