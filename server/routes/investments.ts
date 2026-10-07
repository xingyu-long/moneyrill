import type { FastifyInstance } from 'fastify';
import { cashFlowDays, setCashFlowsFrom } from '../services/investment-flows.ts';

export function investmentRoutes(app: FastifyInstance) {
  app.get('/api/investments/cash-flows', async () => cashFlowDays());
  app.put('/api/investments/cash-flows-from', async (req) => setCashFlowsFrom(req.body));
}
