import type { FastifyInstance } from 'fastify';
import { cashFlow, categoryReport } from '../services/reports.ts';

export function reportRoutes(app: FastifyInstance) {
  app.get('/api/reports/cash-flow', async (req) => cashFlow(req.query));
  app.get('/api/reports/categories', async (req) => categoryReport(req.query));
}
