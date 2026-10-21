import type { FastifyInstance } from 'fastify';
import {
  applyRule,
  createRule,
  deleteRule,
  listRules,
  previewRule,
  reorderRules,
  updateRule,
} from '../services/rules.ts';

const idOf = (req: { params: unknown }) => {
  const n = Number((req.params as any).id);
  if (!Number.isInteger(n) || n < 1) throw new Error('Invalid id');
  return n;
};

export function ruleRoutes(app: FastifyInstance) {
  app.get('/api/rules', async () => listRules());
  app.post('/api/rules', async (req) => createRule(req.body));
  app.post('/api/rules/preview', async (req) => previewRule(req.body));
  app.post('/api/rules/order', async (req) => reorderRules(req.body));
  app.patch('/api/rules/:id', async (req) => updateRule(idOf(req), req.body));
  app.post('/api/rules/:id/apply', async (req) => applyRule(idOf(req)));
  app.delete('/api/rules/:id', async (req) =>
    deleteRule(idOf(req), (req.query as any)?.revert === 'true'),
  );
}
