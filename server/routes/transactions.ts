import type { FastifyInstance } from 'fastify';
import {
  createCategory,
  createGroup,
  deleteCategory,
  deleteGroup,
  listCategories,
  updateCategory,
  updateGroup,
} from '../services/categories.ts';
import { importMonarch } from '../services/monarch-import.ts';
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  removeSplits,
  setSplits,
  updateTransaction,
} from '../services/transactions.ts';

const numericId = (value: unknown) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error('Invalid id');
  return n;
};
const idOf = (req: { params: unknown }) => numericId((req.params as any).id);

export function transactionRoutes(app: FastifyInstance) {
  app.post('/api/transactions/import-monarch', async (req) => importMonarch(req.body));
  app.get('/api/transactions', async (req) => listTransactions(req.query));
  app.post('/api/transactions', async (req) => createTransaction(req.body));
  app.delete('/api/transactions/:id', async (req) => deleteTransaction((req.params as any).id));
  app.patch('/api/transactions/:id', async (req) =>
    updateTransaction((req.params as any).id, req.body),
  );
  app.put('/api/transactions/:id/splits', async (req) =>
    setSplits((req.params as any).id, req.body),
  );
  app.delete('/api/transactions/:id/splits', async (req) => removeSplits((req.params as any).id));
  app.get('/api/categories', async () => listCategories());
  app.post('/api/categories', async (req) => createCategory(req.body));
  app.patch('/api/categories/:id', async (req) => updateCategory(idOf(req), req.body));
  app.delete('/api/categories/:id', async (req) => deleteCategory(idOf(req)));
  app.post('/api/category-groups', async (req) => createGroup(req.body));
  app.patch('/api/category-groups/:id', async (req) => updateGroup(idOf(req), req.body));
  app.delete('/api/category-groups/:id', async (req) => deleteGroup(idOf(req)));
}
