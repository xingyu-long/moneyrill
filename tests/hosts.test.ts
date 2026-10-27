import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedHost, isAllowedOrigin, isPrivateAddress } from '../server/lib/hosts.ts';

test('private network addresses are recognised, public ones are not', () => {
  for (const ok of ['192.168.1.20', '10.0.0.5', '172.16.4.2', '172.31.255.1', 'macbook.local'])
    assert.ok(isPrivateAddress(ok), ok);
  for (const no of ['8.8.8.8', '172.32.0.1', '192.169.1.1', '300.1.1.1', 'example.com', ''])
    assert.ok(!isPrivateAddress(no), no);
});

test('only localhost is accepted unless LAN mode is on', () => {
  assert.ok(isAllowedHost('localhost:3003', false));
  assert.ok(isAllowedHost('127.0.0.1:3003', false));
  assert.ok(!isAllowedHost('192.168.1.20:3003', false));
  assert.ok(isAllowedHost('192.168.1.20:3003', true));
  assert.ok(!isAllowedHost('evil.example', true));
  assert.ok(!isAllowedHost(undefined, true));
});

test('origins must be the configured one or, in LAN mode, the page the request came to', () => {
  const cfg = 'http://localhost:3003';
  assert.ok(isAllowedOrigin('http://localhost:3003', 'localhost:3003', cfg, false));
  assert.ok(!isAllowedOrigin('http://192.168.1.20:3003', '192.168.1.20:3003', cfg, false));
  assert.ok(isAllowedOrigin('http://192.168.1.20:3003', '192.168.1.20:3003', cfg, true));
  assert.ok(!isAllowedOrigin('http://192.168.1.99:3003', '192.168.1.20:3003', cfg, true));
  assert.ok(!isAllowedOrigin('https://evil.example', '192.168.1.20:3003', cfg, true));
});

test('the Tailscale name is accepted only when configured, and only over https', () => {
  const ts = 'my-mac.tail1234.ts.net';
  const cfg = 'http://localhost:3003';
  assert.ok(!isAllowedHost(ts, true));
  assert.ok(isAllowedHost(ts, false, ts));
  assert.ok(isAllowedHost('MY-MAC.tail1234.ts.net', false, ts));
  assert.ok(!isAllowedHost('other-mac.tail1234.ts.net', false, ts));
  assert.ok(!isAllowedHost('192.168.1.20', false, ts));
  assert.ok(!isAllowedOrigin(`https://${ts}`, ts, cfg, true));
  assert.ok(isAllowedOrigin(`https://${ts}`, ts, cfg, false, ts));
  assert.ok(!isAllowedOrigin(`http://${ts}`, ts, cfg, false, ts));
  assert.ok(!isAllowedOrigin('https://evil.example', ts, cfg, false, ts));
  assert.ok(!isAllowedOrigin(`https://${ts}`, 'evil.example', cfg, false, ts));
});
