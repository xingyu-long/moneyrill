import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const instance = resolve('scripts/instance.sh');

// Runs env_port in a folder whose .env / .env.production hold the given lines (the scripts read them relative to the cwd).
function port(environment: string, files: { env?: string; production?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ports-'));
  try {
    if (files.env !== undefined) writeFileSync(join(dir, '.env'), files.env);
    if (files.production !== undefined)
      writeFileSync(join(dir, '.env.production'), files.production);
    return spawnSync('sh', ['-c', `. "${instance}"; env_port ${environment}`], {
      cwd: dir,
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('each environment keeps its old port unless it is configured', () => {
  assert.equal(port('staging').stdout, '3002');
  assert.equal(port('production').stdout, '3003');
  assert.equal(port('staging', { env: 'PLAID_ENV=sandbox\n' }).stdout, '3002');
});

test("STAGING_PORT and PRODUCTION_PORT are read from each environment's own file", () => {
  const files = { env: 'STAGING_PORT=4002\n', production: 'PRODUCTION_PORT="4003"\n' };
  assert.equal(port('staging', files).stdout, '4002');
  assert.equal(port('production', files).stdout, '4003');
  assert.equal(port('staging', { env: 'STAGING_PORT=4000\nSTAGING_PORT=4001\n' }).stdout, '4001');
});

test("both ports can live in .env; the environment's own file wins when it sets one", () => {
  const env = 'STAGING_PORT=4002\nPRODUCTION_PORT=4003\n';
  assert.equal(port('staging', { env }).stdout, '4002');
  assert.equal(port('production', { env }).stdout, '4003');
  assert.equal(port('production', { env, production: 'PLAID_ENV=production\n' }).stdout, '4003');
  assert.equal(port('production', { env, production: 'PRODUCTION_PORT=5003\n' }).stdout, '5003');
  assert.equal(port('staging', { env: 'PRODUCTION_PORT=4003\n' }).stdout, '3002');
});

test('a port that is not a number from 1024 to 65535 is refused, naming the setting', () => {
  for (const bad of ['abc', '80', '70000', '30.5', '-1']) {
    const r = port('staging', { env: `STAGING_PORT=${bad}\n` });
    assert.notEqual(r.status, 0, bad);
    assert.match(r.stderr, /STAGING_PORT must be a port number/, bad);
  }
});

test('the compose files publish the configured port and match the origin to it', () => {
  const files: [string, string][] = [
    ['compose.yaml', 'STAGING_PORT:-3002'],
    ['compose.lan.yaml', 'STAGING_PORT:-3002'],
    ['compose.production.yaml', 'PRODUCTION_PORT:-3003'],
    ['compose.production.lan.yaml', 'PRODUCTION_PORT:-3003'],
    ['examples/compose.image.yaml', 'STAGING_PORT:-3002'],
    ['examples/compose.image.production.yaml', 'PRODUCTION_PORT:-3003'],
  ];
  for (const [file, variable] of files) {
    const text = readFileSync(file, 'utf8');
    assert.ok(text.includes(`\${${variable}}:3002`), `${file} publishes \${${variable}}`);
    assert.ok(!/['"][^'"]*:300[23]:3002/.test(text), `${file} has no fixed published port`);
    for (const line of text.split('\n').filter((l) => l.includes('PUBLIC_ORIGIN')))
      assert.ok(line.includes(`\${${variable}}`), `${file}: ${line.trim()}`);
  }
});

test('deploy.sh refuses two environments on one port before it touches anything', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ports-'));
  try {
    writeFileSync(join(dir, '.env'), 'STAGING_PORT=4000\n');
    writeFileSync(join(dir, '.env.production'), 'PRODUCTION_PORT=4000\n');
    execFileSync('mkdir', ['-p', join(dir, 'scripts')]);
    for (const f of ['deploy.sh', 'instance.sh'])
      writeFileSync(join(dir, 'scripts', f), readFileSync(join('scripts', f)), { mode: 0o755 });
    // A stub docker so the volume check passes without Docker.
    execFileSync('mkdir', ['-p', join(dir, 'bin')]);
    writeFileSync(join(dir, 'bin', 'docker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const r = spawnSync('sh', ['scripts/deploy.sh', 'staging'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /both 4000/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
