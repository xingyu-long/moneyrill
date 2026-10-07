import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { orderMigrations, checksum } from '../server/db/migration-files.ts';

test('migrations are ordered and must be numbered without gaps', () => {
  assert.deepEqual(orderMigrations(['002_add_x.sql', '001_baseline.sql']), [
    '001_baseline.sql',
    '002_add_x.sql',
  ]);
  assert.throws(() => orderMigrations(['001_baseline.sql', '003_skip.sql']), /without gaps/);
  assert.throws(() => orderMigrations(['001_Baseline.sql']), /Invalid migration file name/);
  assert.throws(() => orderMigrations(['001_a.sql', '001_b.sql']), /without gaps/);
  assert.deepEqual(orderMigrations(['README.md']), []);
});

test('the repository migrations are valid and non-empty', () => {
  const dir = new URL('../server/db/migrations/', import.meta.url);
  const files = orderMigrations(fs.readdirSync(dir));
  assert.ok(files.length >= 1);
  for (const f of files) assert.ok(fs.readFileSync(new URL(f, dir), 'utf8').trim().length > 0);
});

test('checksums detect edits', () => {
  assert.notEqual(checksum('CREATE TABLE a();'), checksum('CREATE TABLE b();'));
  assert.equal(checksum('x'), checksum('x'));
});
