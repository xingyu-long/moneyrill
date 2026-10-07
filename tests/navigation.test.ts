import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addToBar,
  barTabs,
  DEFAULT_BAR,
  move,
  moreTabs,
  parseBar,
  removeFromBar,
} from '../src/lib/navigation.ts';
import { settingsPageOf, settingsPath } from '../src/lib/routes.ts';

test('the saved bar is used only when it is valid', () => {
  assert.deepEqual(parseBar(null), DEFAULT_BAR);
  assert.deepEqual(parseBar('["Reports","Accounts"]'), ['Reports', 'Accounts']);
  assert.deepEqual(parseBar('[]'), []);
  for (const bad of [
    'not json',
    '{}',
    '["Nope"]',
    '["Home"]',
    '["Accounts","Accounts"]',
    '["Accounts","Investments","Transactions","Reports","Settings"]',
  ])
    assert.deepEqual(parseBar(bad), DEFAULT_BAR, bad);
});

test('Home is always first in the bar and the rest are under More', () => {
  assert.deepEqual(barTabs(['Reports']), ['Home', 'Reports']);
  assert.deepEqual(moreTabs(DEFAULT_BAR), ['Settings']);
  assert.deepEqual(moreTabs(['Settings']), ['Accounts', 'Investments', 'Transactions', 'Reports']);
});

test('pages can be added, removed and reordered, up to five in the bar', () => {
  assert.deepEqual(addToBar(['Reports'], 'Settings'), ['Reports', 'Settings']);
  assert.deepEqual(addToBar(DEFAULT_BAR, 'Settings'), DEFAULT_BAR, 'full');
  assert.deepEqual(addToBar(['Reports'], 'Reports'), ['Reports']);
  assert.deepEqual(addToBar(['Reports'], 'Home'), ['Reports']);
  assert.deepEqual(removeFromBar(DEFAULT_BAR, 'Investments'), [
    'Accounts',
    'Transactions',
    'Reports',
  ]);
  assert.deepEqual(move(['A', 'B', 'C'] as any, 'B' as any, -1), ['B', 'A', 'C']);
  assert.deepEqual(move(['A', 'B'] as any, 'A' as any, -1), ['A', 'B'], 'already first');
  assert.deepEqual(move(['A', 'B'] as any, 'B' as any, 1), ['A', 'B'], 'already last');
});

test('Settings has a list page and sub-pages with their own addresses', () => {
  assert.equal(settingsPageOf('/settings'), null);
  assert.equal(settingsPageOf('/settings/categories'), 'categories');
  assert.equal(settingsPageOf('/Settings/Display'), 'display');
  assert.equal(settingsPageOf('/settings/sign-in'), 'sign-in');
  assert.equal(settingsPageOf('/settings/nope'), null);
  assert.equal(settingsPageOf('/accounts/categories'), null);
  assert.equal(settingsPath(), '/settings');
  assert.equal(settingsPath('sync'), '/settings/sync');
  assert.equal(settingsPath('sign-in'), '/settings/sign-in');
});
