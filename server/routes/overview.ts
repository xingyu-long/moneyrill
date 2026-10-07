import type { FastifyInstance } from 'fastify';
import { config } from '../lib/config.ts';
import { overview } from '../db/queries.ts';

export function overviewRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({
    ok: true,
    mode: config.plaidEnv,
    version: config.version,
  }));
  app.get('/api/overview', overview);
}
