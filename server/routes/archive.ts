import type { FastifyInstance } from 'fastify';
import { overview } from '../db/queries.ts';
import { accountsCsv, exportArchive, importArchive } from '../services/archive.ts';

export function archiveRoutes(app: FastifyInstance) {
  app.get('/api/export', async (req, reply) => {
    reply.header('Content-Disposition', 'attachment; filename="moneyrill-archive.json"');
    return exportArchive();
  });
  app.get('/api/export.csv', async (req, reply) => {
    reply.type('text/csv').header('Content-Disposition', 'attachment; filename="accounts.csv"');
    return accountsCsv((await overview()).accounts);
  });
  app.post('/api/import', async (req) => importArchive(req.body as any));
}
