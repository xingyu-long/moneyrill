import test from 'node:test';
import assert from 'node:assert/strict';
import { createScrollMemory } from '../src/lib/scroll.ts';

test('each page keeps its own scroll position and a new page opens at the top', () => {
  const m = createScrollMemory();
  m.save('/', 900);
  assert.equal(m.restoreFor('/accounts'), 0);
  m.save('/accounts', 120);
  assert.equal(m.restoreFor('/'), 900);
  assert.equal(m.restoreFor('/accounts'), 120);
});
