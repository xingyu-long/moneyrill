import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maskOf,
  parseCsv,
  parseMonarchCsv,
  planMonarchImport,
  type MonarchRow,
  type PlaidRow,
} from '../server/lib/monarch.ts';

const HEADER =
  'Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags,Owner,Reviewed,Id';
const csv = (...lines: string[]) => [HEADER, ...lines].join('\n');

test('CSV: quotes, commas and line breaks inside fields, CRLF, doubled quotes and a BOM', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
  assert.deepEqual(parseCsv('a,"b,c"\r\n"say ""hi""",2\r\n'), [
    ['a', 'b,c'],
    ['say "hi"', '2'],
  ]);
  assert.deepEqual(parseCsv('"two\nlines",x'), [['two\nlines', 'x']]);
  assert.deepEqual(parseCsv('﻿a,b'), [['a', 'b']], 'a byte-order mark is ignored');
  assert.deepEqual(
    parseCsv('a,b\n\n\n1,2\n\n'),
    [
      ['a', 'b'],
      ['1', '2'],
    ],
    'blank lines are skipped',
  );
  assert.deepEqual(parseCsv('a,,c'), [['a', '', 'c']]);
  assert.throws(() => parseCsv('a,"never closed'), /never closed/);
});

test("rows are read with Monarch's sign flipped to the provider sign", () => {
  const { rows, invalidLines } = parseMonarchCsv(
    csv(
      '2026-10-02,Amazon,Shopping,Rewards Card (...1111),AMAZON *1234,gift,-28.49,,,,id-1',
      '2026-10-01,Acme,Paychecks,Everyday Checking (...2222),ACME PAYROLL,,"3,200.00",,,,id-2',
      '2026-09-30,Refund Co,Shopping,Rewards Card (...1111),REFUND,,$12.50,,,,id-3',
    ),
  );
  assert.deepEqual(invalidLines, []);
  assert.deepEqual(
    rows.map((r) => r.amount),
    ['28.49', '-3200', '-12.5'],
  );
  assert.equal(rows[0].notes, 'gift');
  assert.equal(rows[0].statement, 'AMAZON *1234');
  assert.equal(rows[0].id, 'id-1');
});

test('unreadable rows are skipped and reported by line number only', () => {
  const { rows, invalidLines } = parseMonarchCsv(
    csv(
      '2026-10-02,A,Shopping,Rewards Card (...1111),A,,-1,,,,ok',
      '2026-02-30,A,Shopping,Rewards Card (...1111),A,,-1,,,,bad-date',
      '2026-10-02,A,Shopping,Rewards Card (...1111),A,,abc,,,,bad-amount',
      '2026-10-02,A,Shopping,Rewards Card (...1111),A,,-1,,,,',
      '2026-10-02,A,Shopping,,A,,-1,,,,no-account',
      '2026-10-02,too,few,columns',
    ),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(invalidLines, [3, 4, 5, 6, 7]);
});

test('files that are not a Monarch export are refused', () => {
  assert.throws(() => parseMonarchCsv(''), /empty/);
  assert.throws(() => parseMonarchCsv('Date,Amount\n2026-01-01,5'), /no "Merchant" column/);
  assert.throws(() => parseMonarchCsv('Name,Value\nx,1'), /does not look like a Monarch export/);
  const big = csv(
    ...Array.from({ length: 20001 }, (_, i) => `2026-01-01,A,B,C (...1111),S,,-1,,,,${i}`),
  );
  assert.throws(() => parseMonarchCsv(big), /more than 20000 rows/);
});

test('the account number comes from the last four digits in the name', () => {
  assert.equal(maskOf('Rewards Card (...1111)'), '1111');
  assert.equal(maskOf('CREDIT CARD (...4444)'), '4444');
  assert.equal(maskOf('BILT WORLD ELITE MASTERCARD (...XXXX-XXXX-XXXX-0931)'), '0931');
  assert.equal(maskOf('ADDEPAR 401(K) PLAN (...*****2259)'), '2259');
  assert.equal(maskOf('Amex EveryDay® Card (...1007)'), '1007');
  for (const none of [
    'Apple Card',
    'Apple Cash',
    'Broadcom U.S. 401(k) Plan (...Plan)',
    'Individual ...777 (....777)',
    'Joint - PAL ...305 (....305)',
    '',
  ])
    assert.equal(maskOf(none), null, none);
});

// --- the overlap plan ---
const row = (
  id: string,
  date: string,
  amount: string,
  over: Partial<MonarchRow> = {},
): MonarchRow => ({
  line: 2,
  date,
  merchant: 'Shop',
  category: 'Groceries',
  account: 'Rewards Card (...1111)',
  statement: 'SHOP 1',
  notes: '',
  amount,
  id,
  ...over,
});
const venture = {
  id: 'a-venture',
  name: 'Rewards Card',
  institution: 'Example Bank',
  mask: '1111',
};
const checking = { id: 'a-check', name: 'Checking', institution: 'Other Bank', mask: '3333' };
const plaid = (
  id: string,
  date: string,
  amount: string,
  over: Partial<PlaidRow> = {},
): PlaidRow => ({
  id,
  account_id: 'a-venture',
  date,
  amount,
  category_id: null,
  notes: '',
  ...over,
});
const categories = new Map([
  ['groceries', 6],
  ['rent', 9],
  ['uncategorized', 21],
]);
const plan = (
  rows: MonarchRow[],
  plaidRows: PlaidRow[] = [],
  extra: Partial<Parameters<typeof planMonarchImport>[0]> = {},
) =>
  planMonarchImport({
    rows,
    accounts: [venture, checking],
    plaid: plaidRows,
    importedIds: new Set(),
    categories,
    uncategorizedId: 21,
    today: '2026-10-03',
    ...extra,
  });

test("rows older than Plaid's history are added; the sign is the provider sign", () => {
  const p = plan(
    [row('old', '2026-05-01', '40.00', { notes: 'bbq' }), row('older', '2026-04-01', '-10')],
    [plaid('p1', '2026-07-06', '9.99')],
  );
  assert.equal(p.insert.length, 2);
  assert.deepEqual(p.insert[1], {
    account_id: 'a-venture',
    external_id: 'old',
    date: '2026-05-01',
    amount: '40.00',
    name: 'SHOP 1',
    merchant_name: 'Shop',
    notes: 'bbq',
    category_id: 6,
    new_category: null,
  });
  assert.equal(p.totals.toImport, 2);
});

test('a row Plaid also has donates its category and notes, and is not added twice', () => {
  const p = plan(
    [row('m1', '2026-08-10', '25.00', { notes: 'dinner', category: 'Rent' })],
    [plaid('p1', '2026-07-06', '1'), plaid('p2', '2026-08-11', '25.00')],
  );
  assert.equal(p.insert.length, 0);
  assert.deepEqual(p.merge, [{ id: 'p2', category_id: 9, new_category: null, notes: 'dinner' }]);
  assert.equal(p.accounts[0].toMerge, 1);
});

test('your own category or notes on the Plaid row are never overwritten', () => {
  const p = plan(
    [row('m1', '2026-08-10', '25.00', { notes: 'from monarch', category: 'Rent' })],
    [
      plaid('p1', '2026-07-06', '1'),
      plaid('p2', '2026-08-10', '25.00', { category_id: 6, notes: 'mine' }),
    ],
  );
  assert.deepEqual(p.merge, []);
  assert.equal(p.totals.keptYours, 1);
  const half = plan(
    [row('m1', '2026-08-10', '25.00', { notes: 'from monarch', category: 'Rent' })],
    [plaid('p1', '2026-07-06', '1'), plaid('p2', '2026-08-10', '25.00', { category_id: 6 })],
  );
  assert.deepEqual(half.merge, [
    { id: 'p2', category_id: null, new_category: null, notes: 'from monarch' },
  ]);
});

test('matching is one to one: two equal coffees match two Plaid rows, a third is left out', () => {
  const p = plan(
    [
      row('c1', '2026-08-10', '4.00'),
      row('c2', '2026-08-10', '4.00'),
      row('c3', '2026-08-10', '4.00'),
    ],
    [
      plaid('p0', '2026-07-06', '1'),
      plaid('p1', '2026-08-10', '4.00'),
      plaid('p2', '2026-08-11', '4.00'),
    ],
  );
  assert.equal(p.totals.toMerge, 2);
  assert.equal(p.totals.leftOut, 1);
  assert.equal(new Set(p.merge.map((m) => m.id)).size, 2);
  assert.equal(p.insert.length, 0);
});

test('dates may differ by up to 3 days, no more; the closest row wins', () => {
  const rows = [row('m1', '2026-08-10', '25.00')];
  const near = plan(rows, [
    plaid('p0', '2026-07-06', '1'),
    plaid('far', '2026-08-13', '25.00'),
    plaid('close', '2026-08-11', '25.00'),
  ]);
  assert.equal(near.merge[0].id, 'close');
  const tooFar = plan(rows, [plaid('p0', '2026-07-06', '1'), plaid('p', '2026-08-14', '25.00')]);
  assert.equal(tooFar.totals.leftOut, 1);
  const otherAmount = plan(rows, [
    plaid('p0', '2026-07-06', '1'),
    plaid('p', '2026-08-10', '25.01'),
  ]);
  assert.equal(otherAmount.totals.leftOut, 1);
  const otherSign = plan(rows, [
    plaid('p0', '2026-07-06', '1'),
    plaid('p', '2026-08-10', '-25.00'),
  ]);
  assert.equal(otherSign.totals.leftOut, 1, 'money in never matches money out');
});

test("near the start of Plaid's history nothing is added without a match (it may be the same row)", () => {
  const p = plan(
    [row('edge', '2026-07-04', '30.00'), row('before', '2026-07-02', '30.00')],
    [plaid('p1', '2026-07-06', '99')],
  );
  // window starts 3 days before Plaid's first row: July 3
  assert.deepEqual(
    p.insert.map((i) => i.external_id),
    ['before'],
  );
  assert.equal(p.totals.leftOut, 1);
});

test('an account with no Plaid rows gets every Monarch row; future dates and repeats are skipped', () => {
  const p = plan(
    [
      row('a', '2026-09-30', '5'),
      row('b', '2026-10-03', '5'),
      row('future', '2026-10-04', '5'),
      row('again', '2026-01-01', '5'),
    ],
    [],
    { importedIds: new Set(['again']) },
  );
  assert.deepEqual(
    p.insert.map((i) => i.external_id),
    ['a', 'b'],
  );
  assert.equal(p.futureRows, 1);
  assert.equal(p.totals.alreadyImported, 1);
});

test('only bank and card accounts are matched; others are listed with a reason', () => {
  const p = plan([
    row('1', '2026-01-01', '5'),
    row('2', '2026-01-01', '5', { account: 'Apple Card' }),
    row('3', '2026-01-01', '5', { account: 'Roth IRA (...5555)' }),
    row('4', '2026-01-01', '5', { account: 'Broadcom 401(k) (...Plan)' }),
    row('5', '2026-01-01', '5', { account: 'MAIN CHECKING (...3333)' }),
  ]);
  assert.equal(p.insert.length, 2);
  const by = (label: string) => p.accounts.find((a) => a.label === label)!;
  assert.match(by('Apple Card').skipped!, /No account number/);
  assert.match(by('Roth IRA (...5555)').skipped!, /No bank or card account ending 5555/);
  assert.match(by('Broadcom 401(k) (...Plan)').skipped!, /No account number/);
  assert.match(by('MAIN CHECKING (...3333)').matched!, /Checking \(…3333\) · Other Bank/);
  assert.equal(p.totals.notBankOrCard, 3);
});

test('two local accounts with the same last four digits are never guessed between', () => {
  const p = plan([row('1', '2026-01-01', '5')], [], {
    accounts: [venture, { ...checking, id: 'other', mask: '1111' }],
  });
  assert.equal(p.insert.length, 0);
  assert.match(p.accounts[0].skipped!, /More than one account ends 1111/);
});

test('categories: known names are reused, Uncategorized is no choice, unknown ones are created', () => {
  const p = plan([
    row('1', '2026-01-01', '5', { category: 'groceries' }),
    row('2', '2026-01-01', '5', { category: 'Uncategorized' }),
    row('3', '2026-01-01', '5', { category: '' }),
    row('4', '2026-01-01', '5', { category: 'RSU' }),
    row('5', '2026-01-02', '-100', { category: 'RSU' }),
    row('6', '2026-01-02', '7', { category: 'Dog food' }),
  ]);
  assert.deepEqual(
    p.insert.map((i) => i.category_id),
    [6, null, null, null, null, null],
  );
  assert.deepEqual(
    p.insert.map((i) => i.new_category),
    [null, null, null, 'RSU', 'RSU', 'Dog food'],
  );
  assert.deepEqual(p.newCategories, [
    { name: 'RSU', rows: 2, income: false },
    { name: 'Dog food', rows: 1, income: false },
  ]);
  const income = plan([row('1', '2026-01-01', '-5', { category: 'ESPP' })]);
  assert.deepEqual(income.newCategories, [{ name: 'ESPP', rows: 1, income: true }]);
});

test('missing statement text falls back to the merchant', () => {
  const p = plan([
    row('1', '2026-01-01', '5', { statement: '', merchant: 'Cafe' }),
    row('2', '2026-01-01', '5', { statement: '', merchant: '' }),
  ]);
  assert.deepEqual(
    p.insert.map((i) => i.name),
    ['Cafe', 'Imported transaction'],
  );
});
