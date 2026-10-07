import type { FastifyInstance } from 'fastify';
import { sandboxSamples, syncAll } from '../services/sync.ts';
import { getSyncSchedule, setSyncSchedule } from '../services/sync-schedule.ts';

export function syncRoutes(app: FastifyInstance) {
  app.post('/api/sync', syncAll);
  app.get('/api/sync/schedule', async () => getSyncSchedule());
  app.put('/api/sync/schedule', async (req) => setSyncSchedule(req.body));
  app.post('/api/sandbox-samples', sandboxSamples);
}
