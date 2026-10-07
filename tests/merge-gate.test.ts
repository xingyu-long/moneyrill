import baseTest from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// scripts/gh.py decides when merge-pr.sh may merge; these call its functions directly. The app image has neither
// Python nor the scripts folder (ship.sh runs the unit tests inside it), so there they are skipped.
const available = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return fs.existsSync('scripts/gh.py');
  } catch {
    return false;
  }
})();
const test = available ? baseTest : baseTest.skip;

const py = (code: string) =>
  JSON.parse(
    execFileSync(
      'python3',
      ['-c', `import sys, json; sys.path.insert(0, 'scripts'); import gh\n${code}`],
      {
        encoding: 'utf8',
      },
    ),
  );
const decide = (wait: boolean, local: boolean, ci: string): [string, string] =>
  py(
    `print(json.dumps(gh.merge_decision(${wait ? 'True' : 'False'}, ${local ? 'True' : 'False'}, '${ci}')))`,
  );

test('a green CI always merges', () => {
  for (const wait of [true, false])
    for (const local of [true, false]) assert.equal(decide(wait, local, 'success')[0], 'merge');
});

test('without --wait, a commit that passed the local gate merges while CI is still running or unknown', () => {
  for (const ci of ['pending', 'unknown']) {
    const [verdict, why] = decide(false, true, ci);
    assert.equal(verdict, 'merge');
    assert.match(why, /local gate/);
  }
});

test('a commit that has not passed the local gate needs a green CI, and is told how to get one', () => {
  for (const ci of ['pending', 'unknown']) {
    const [verdict, why] = decide(false, false, ci);
    assert.equal(verdict, 'refuse');
    assert.match(why, /ship\.sh --stage-only/);
  }
});

test('a failed CI refuses, even for a commit that passed the local gate', () => {
  for (const local of [true, false]) assert.equal(decide(false, local, 'failure')[0], 'refuse');
  assert.match(decide(false, true, 'failure')[1], /CI failed/);
});

test('--wait is only ever satisfied by a green CI, whatever the local gate said', () => {
  for (const ci of ['pending', 'unknown', 'failure'])
    assert.equal(decide(true, true, ci)[0], 'refuse');
});

test('the local gate is the exact commit recorded as VERIFIED, never a prefix or another commit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  const log = path.join(dir, 'history.log');
  const sha = 'a'.repeat(40);
  fs.writeFileSync(
    log,
    [
      `2026-10-05 10:00:00 STAGED moneyrill-release:aaaaaaa-20261005100000`,
      `2026-10-05 10:00:01 VERIFIED ${sha}`,
      `2026-10-05 10:05:00 VERIFIED ${'b'.repeat(40)}`,
      `2026-10-05 10:06:00 RELEASED moneyrill-release:aaaaaaa-20261005100000`,
    ].join('\n') + '\n',
  );
  const verified = (s: string, file = log) =>
    py(`print(json.dumps(gh.locally_verified(${JSON.stringify(s)}, ${JSON.stringify(file)})))`);
  assert.equal(verified(sha), true);
  assert.equal(verified('b'.repeat(40)), true);
  assert.equal(verified('c'.repeat(40)), false);
  assert.equal(verified(sha.slice(0, 7)), false, 'a short prefix is not the commit');
  assert.equal(verified('a'.repeat(39)), false);
  // staged or released is not verified: only the line the whole gate writes counts
  assert.equal(verified('moneyrill-release:aaaaaaa-20261005100000'), false);
  assert.equal(
    verified(sha, path.join(dir, 'missing.log')),
    false,
    'no history file means not verified',
  );
  fs.rmSync(dir, { recursive: true });
});
