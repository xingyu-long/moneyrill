import type { FastifyInstance } from 'fastify';
import { createManualAccount, updateAccount } from '../services/accounts.ts';
import { setManualHoldings } from '../services/holdings.ts';

export function accountRoutes(app: FastifyInstance) {
  app.patch('/api/accounts/:id', async (req) =>
    updateAccount((req.params as any).id, req.body as any),
  );
  app.put('/api/accounts/:id/holdings', async (req) =>
    setManualHoldings((req.params as any).id, req.body),
  );
  app.post('/api/accounts', async (req) => createManualAccount(req.body as any));
}
