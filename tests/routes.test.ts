import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DATE } from '../src/lib/reportDates.ts';
import {
  accountIdOf,
  accountPath,
  isKnownPath,
  parseReport,
  reportUrl,
  tabOf,
  tabPath,
  usableReportUrl,
} from '../src/lib/routes.ts';

test('tabs and their paths', () => {
  assert.equal(tabOf('/'), 'Home');
  assert.equal(tabOf('/accounts'), 'Accounts');
  assert.equal(tabOf('/transactions'), 'Transactions');
  assert.equal(tabOf('/Reports/spending'), 'Reports');
  assert.equal(tabOf('/nope'), 'Home');
  assert.equal(tabPath('Investments'), '/investments');
  assert.ok(isKnownPath('/') && isKnownPath('/settings') && isKnownPath('/reports/x'));
  assert.ok(!isKnownPath('/nope') && !isKnownPath('/api-ish'));
});

const urls = [
  '/reports/cash-flow',
  '/reports/spending?range=last-month',
  '/reports/spending?range=all-time',
  '/reports/spending?range=this-month',
  '/reports/income?range=last-3-months&categories=1,2&accounts=a%3A1,b',
  '/reports/spending?from=2026-01-01&to=2026-03-31',
  '/reports/spending?range=last-1-week',
  '/reports/category/9?type=expense&via=spending',
  '/reports/category/9?range=all-time&type=income&via=cash-flow&interval=quarter&period=2026-07-01',
  '/reports/merchant/Example%20Clinic?type=expense&via=spending',
  '/reports/merchant/AT%26T%20%2F%20Mobile?type=income&via=income&interval=year&period=2026-01-01',
];

test('report addresses read back to the same address', () => {
  for (const url of urls) {
    const [path, query = ''] = url.split('?');
    const route = parseReport(path, query ? '?' + query : '');
    assert.ok(route, url);
    assert.equal(reportUrl(route), url);
  }
});

test('report addresses carry the view, range and filters', () => {
  const r = parseReport(
    '/reports/income',
    '?range=last-3-months&categories=1,2,2,x&accounts=a%3A1',
  )!;
  assert.deepEqual(r, {
    view: 'sub',
    sub: 'Income',
    date: { mode: 'last', n: 3, unit: 'month' },
    categories: [1, 2],
    accounts: ['a:1'],
  });
  const c = parseReport('/reports/category/9', '?type=income')!;
  assert.equal(c.view, 'category');
  assert.ok(c.view === 'category' && c.via === 'Income' && c.interval === 'month' && !c.period);
});

test('anything odd in a report address falls back instead of failing', () => {
  assert.equal(parseReport('/reports', ''), null);
  assert.equal(parseReport('/reports/nope', ''), null);
  assert.equal(parseReport('/reports/category/abc', ''), null);
  assert.equal(parseReport('/reports/spending/extra', ''), null);
  const odd = parseReport(
    '/reports/category/9',
    '?range=last-0-days&type=transfer&interval=day&period=2026-02-30&via=nope',
  )!;
  assert.deepEqual(odd.date, DEFAULT_DATE);
  assert.ok(odd.view === 'category' && odd.type === 'expense' && odd.interval === 'month');
  assert.ok(odd.view === 'category' && odd.period === undefined && odd.via === 'Spending');
  assert.deepEqual(parseReport('/reports/spending', '?range=last-101-years')!.date, DEFAULT_DATE);
  assert.deepEqual(
    parseReport('/reports/spending', '?from=2026-03-01&to=2026-01-01')!.date,
    DEFAULT_DATE,
  );
  assert.deepEqual(parseReport('/reports/spending', '')!.date, { mode: 'preset', id: 'thisYear' });
  assert.deepEqual(parseReport('/reports/spending', '?range=all-time')!.date, { mode: 'all' });
  assert.deepEqual(parseReport('/reports/spending', '?range=this-year')!.date, DEFAULT_DATE);
  assert.ok(usableReportUrl('/reports/income?range=last-month'));
  for (const bad of [null, 42, '/accounts', '/reports', '/reports/nope', 'https://evil/reports/x'])
    assert.ok(!usableReportUrl(bad), String(bad));
});

test('a merchant page carries the merchant name, however odd', () => {
  const r = parseReport('/reports/merchant/AT%26T%20%2F%20Mobile', '?type=income')!;
  assert.ok(r.view === 'merchant' && r.name === 'AT&T / Mobile' && r.type === 'income');
  assert.ok(r.view === 'merchant' && r.via === 'Income');
  assert.equal(reportUrl(r), '/reports/merchant/AT%26T%20%2F%20Mobile?type=income&via=income');
  assert.equal(parseReport('/reports/merchant', ''), null);
  assert.equal(
    parseReport('/reports/merchant/%E0%A4%A', ''),
    null,
    'a broken escape is not a page',
  );
  assert.equal(parseReport('/reports/merchant/' + 'x'.repeat(201), ''), null);
  assert.equal(parseReport('/reports/merchant/%20', ''), null);
});

test('an account has its own address, and the id survives the trip', () => {
  assert.equal(accountPath('abc'), '/accounts/abc');
  for (const id of ['abc', '1QJ3XK:dBRmMN', 'a b/c?d', 'ü'])
    assert.equal(accountIdOf(accountPath(id)), id);
  assert.equal(tabOf(accountPath('abc')), 'Accounts');
  assert.ok(isKnownPath(accountPath('abc')));
});

test('only /accounts/<id> names an account; ids keep their case', () => {
  assert.equal(accountIdOf('/accounts'), null);
  assert.equal(accountIdOf('/accounts/'), null);
  assert.equal(accountIdOf('/transactions/abc'), null);
  assert.equal(accountIdOf('/Accounts/AbC'), 'AbC');
  assert.equal(accountIdOf('/accounts/%E0%A4%A'), null);
});
