import crypto from 'node:crypto';

/** 001_baseline.sql, 002_add_something.sql ... applied in order, exactly once each. */
export const MIGRATION_PATTERN = /^(\d{3})_[a-z0-9_]+\.sql$/;

export function orderMigrations(names: string[]): string[] {
  const files = names.filter((n) => n.endsWith('.sql')).sort();
  files.forEach((name, i) => {
    const match = MIGRATION_PATTERN.exec(name);
    if (!match) throw new Error(`Invalid migration file name: ${name}`);
    if (Number(match[1]) !== i + 1)
      throw new Error(`Migrations must be numbered 001, 002, ... without gaps (found ${name})`);
  });
  return files;
}

export const checksum = (sql: string) => crypto.createHash('sha256').update(sql).digest('hex');
