import test from 'node:test';
import assert from 'node:assert/strict';
import { MASK, setPrivateMode } from '../src/lib/format.ts';
import {
  accountsSentence,
  allocationSentence,
  bestPeriodSentence,
  changePhrase,
  periodName,
  clock,
  scheduleSentence,
  assetsSentence,
  monthSentence,
  portfolioSentence,
  greeting,
  homeSentence,
  investmentsSentence,
  pageTitle,
  periodPhrase,
  reportLead,
  reportsSentence,
  settingsSentence,
  spell,
  transactionsSentence,
  type Sentence,
} from '../src/lib/summary.ts';

const plain = (s: Sentence) => s.map((p) => p.text).join('');
const styled = (s: Sentence, style: string) =>
  s.filter((p) => p.style === style).map((p) => p.text);
const privately = (fn: () => void) => {
  setPrivateMode(true);
  try {
    fn();
  } finally {
    setPrivateMode(false);
  }
};

test('small counts are spelled out, larger ones are digits', () => {
  assert.deepEqual([0, 1, 3, 10, 12, 13, 48].map(spell), [
    'no',
    'one',
    'three',
    'ten',
    'twelve',
    '13',
    '48',
  ]);
});

test('the greeting follows the hour, and only Home takes it as its title', () => {
  assert.deepEqual([0, 11, 12, 17, 18, 23].map(greeting), [
    'Good morning.',
    'Good morning.',
    'Good afternoon.',
    'Good afternoon.',
    'Good evening.',
    'Good evening.',
  ]);
  assert.equal(pageTitle('Home', 9), 'Good morning.');
  assert.equal(pageTitle('Reports', 9), 'Reports');
  assert.equal(plain(homeSentence()), "Here's where you stand today.");
});

test('accounts: how many, and how recently they synced', () => {
  const s = (count: number, problems: number, syncedHoursAgo: number | null) =>
    plain(accountsSentence({ count, problems, syncedHoursAgo }));
  assert.equal(s(10, 0, 2), 'Ten accounts, all synced within the last 2 hours.');
  assert.equal(s(10, 0, 0.4), 'Ten accounts, all synced within the last hour.');
  assert.equal(s(10, 0, 24), 'Ten accounts, all synced within the last day.');
  assert.equal(s(3, 0, 50), 'Three accounts, all synced within the last 3 days.');
  assert.equal(s(1, 0, 5), 'One account, synced within the last 5 hours.');
  assert.equal(s(14, 0, 5), '14 accounts, all synced within the last 5 hours.');
});

test('accounts: with a problem it says so instead of claiming everything synced', () => {
  const one = accountsSentence({ count: 10, problems: 1, syncedHoursAgo: 2 });
  assert.equal(plain(one), 'Ten accounts. One needs reconnecting.');
  assert.deepEqual(styled(one, 'warn'), ['One needs reconnecting.']);
  assert.equal(
    plain(accountsSentence({ count: 6, problems: 2, syncedHoursAgo: 2 })),
    'Six accounts. Two need reconnecting.',
  );
});

test('accounts: none yet, and only hand-kept accounts', () => {
  assert.equal(
    plain(accountsSentence({ count: 0, problems: 0, syncedHoursAgo: null })),
    'No accounts yet.',
  );
  assert.equal(
    plain(accountsSentence({ count: 2, problems: 0, syncedHoursAgo: null })),
    'Two accounts.',
  );
});

test('investments: the value, and the move over the chosen range', () => {
  const s = (change: number | null, kind: 'return' | 'value', period = '1M') =>
    investmentsSentence({ hasAccounts: true, value: 186540.92, change, kind, period });
  assert.equal(
    plain(s(2.84, 'return')),
    'Your portfolio is worth $186,541, up 2.84% over the last month.',
  );
  assert.equal(
    plain(s(-0.4, 'return', 'YTD')),
    'Your portfolio is worth $186,541, down 0.40% so far this year.',
  );
  assert.equal(
    plain(s(1.5, 'value', '1Y')),
    'Your portfolio is worth $186,541, with its value up 1.50% over the last year.',
  );
  assert.equal(plain(s(null, 'return')), 'Your portfolio is worth $186,541.');
  assert.equal(periodPhrase('ALL'), 'since the start');
});

test('investments: no investment accounts', () => {
  assert.equal(
    plain(
      investmentsSentence({
        hasAccounts: false,
        value: 0,
        change: null,
        kind: 'return',
        period: '1M',
      }),
    ),
    'No investment accounts yet.',
  );
});

test('transactions: the month so far, and what has not posted', () => {
  const s = (over = {}) =>
    plain(
      transactionsSentence({
        count: 48,
        more: false,
        out: 5710.36,
        inn: 8420,
        pending: 0,
        ...over,
      }),
    );
  assert.equal(s(), '48 this month, $5,710 out and $8,420 in.');
  assert.equal(s({ pending: 1 }), '48 this month, $5,710 out and $8,420 in. One is still pending.');
  assert.equal(
    s({ pending: 3 }),
    '48 this month, $5,710 out and $8,420 in. Three are still pending.',
  );
  assert.equal(s({ more: true, count: 500 }), '500+ this month, $5,710 out and $8,420 in.');
  assert.equal(s({ count: 0 }), 'Nothing yet this month.');
});

test('a report range opens a sentence in plain words', () => {
  assert.equal(reportLead({ mode: 'preset', id: 'thisYear' }), 'This year');
  assert.equal(reportLead({ mode: 'preset', id: 'lastMonth' }), 'Last month');
  assert.equal(reportLead({ mode: 'preset', id: 'last30' }), 'In the last 30 days');
  assert.equal(reportLead({ mode: 'last', n: 1, unit: 'week' }), 'In the last week');
  assert.equal(reportLead({ mode: 'last', n: 6, unit: 'month' }), 'In the last 6 months');
  assert.equal(reportLead({ mode: 'all' }), 'Over all time');
  assert.equal(
    reportLead({ mode: 'range', from: '2026-01-01', to: '2026-03-31' }),
    'From Jan 1, 2026 to Mar 31, 2026,',
  );
});

test('reports: earned, spent and the share kept', () => {
  const s = (over = {}) =>
    reportsSentence({
      lead: 'This year',
      income: 80940,
      spending: 59460,
      rate: 26.5,
      filtered: false,
      ...over,
    });
  assert.equal(plain(s()), 'This year you earned $80,940 and spent $59,460. You kept 26.5%.');
  assert.deepEqual(styled(s(), 'figure'), ['26.5%']);
  assert.equal(
    plain(s({ rate: -12 })),
    'This year you earned $80,940 and spent $59,460. You spent more than you earned.',
  );
  assert.equal(plain(s({ rate: null })), 'This year you earned $80,940 and spent $59,460.');
  assert.equal(plain(s({ income: 0, rate: null })), 'This year you spent $59,460.');
  assert.equal(
    plain(s({ income: 0, spending: 0, rate: null })),
    'This year there was no income or spending.',
  );
});

test('reports: with filters it describes only what the filters match, with no share kept', () => {
  assert.equal(
    plain(
      reportsSentence({ lead: 'Last month', income: 0, spending: 412, rate: null, filtered: true }),
    ),
    'Last month your filters match $0 earned and $412 spent.',
  );
});

test('settings: where the data stays, and any connection that needs a look', () => {
  assert.equal(
    plain(settingsSentence({ attention: 0 })),
    'Everything stays on this machine, in your own database.',
  );
  const one = settingsSentence({ attention: 1 });
  assert.equal(
    plain(one),
    'Everything stays on this machine, in your own database. One connection needs your attention.',
  );
  assert.deepEqual(styled(one, 'warn'), ['One connection needs your attention.']);
  assert.match(
    plain(settingsSentence({ attention: 3 })),
    /Three connections need your attention\.$/,
  );
});

test('private mode hides every amount in every sentence, and only the amounts', () => {
  privately(() => {
    const all: Sentence[] = [
      investmentsSentence({
        hasAccounts: true,
        value: 186540.92,
        change: 2.84,
        kind: 'return',
        period: '1M',
      }),
      transactionsSentence({ count: 48, more: false, out: 5710.36, inn: 8420, pending: 3 }),
      reportsSentence({
        lead: 'This year',
        income: 80940,
        spending: 59460,
        rate: 26.5,
        filtered: false,
      }),
      reportsSentence({
        lead: 'This year',
        income: 80940,
        spending: 59460,
        rate: null,
        filtered: true,
      }),
    ];
    for (const s of all) {
      assert.doesNotMatch(plain(s), /\$|\d{1,3},\d{3}/, plain(s));
      assert.ok(plain(s).includes(MASK));
    }
    // percentages and counts stay, as elsewhere in private mode
    assert.match(plain(all[0]), /up 2\.84%/);
    assert.match(plain(all[1]), /^48 this month/);
    assert.match(plain(all[2]), /You kept 26\.5%/);
  });
});

test('Home: the share of income kept this month, and what to say when there is none', () => {
  const s = (income: number, expenses: number, rate: number | null) =>
    plain(monthSentence({ income, expenses, rate }));
  assert.equal(s(8420, 5710, 32), "You've kept 32% of your income this month.");
  assert.equal(s(100, 160, -60), 'You spent $60 more than you earned this month.');
  assert.equal(s(0, 140, null), 'No income yet this month. You have spent $140.');
  assert.equal(s(0, 0, null), 'No income or spending yet this month.');
  assert.equal(s(100, 0, null), 'Nothing to compare yet this month.');
  assert.deepEqual(styled(monthSentence({ income: 8420, expenses: 5710, rate: 32 }), 'figure'), [
    '32%',
  ]);
});

test('Home: what you own and owe, and the portfolio over the chart range', () => {
  assert.equal(
    plain(assetsSentence({ assets: 331204.11, liabilities: 27813.71 })),
    'You own $331,204 and owe $27,814.',
  );
  assert.deepEqual(styled(assetsSentence({ assets: 100, liabilities: 5 }), 'warn'), ['$5']);
  assert.equal(
    plain(assetsSentence({ assets: 100, liabilities: 0 })),
    'You own $100 and owe nothing.',
  );
  assert.equal(
    plain(portfolioSentence({ change: 2.84, period: '1M' })),
    "Your portfolio's value is up 2.84% over the last month.",
  );
  assert.equal(
    plain(portfolioSentence({ change: -0.5, period: 'YTD' })),
    "Your portfolio's value is down 0.50% so far this year.",
  );
  assert.equal(plain(portfolioSentence({ change: null, period: '1M' })), 'Not enough history yet.');
});

test('private mode hides the amounts in the Home sentences too', () => {
  privately(() => {
    assert.doesNotMatch(plain(assetsSentence({ assets: 331204, liabilities: 27813 })), /\$/);
    assert.doesNotMatch(plain(monthSentence({ income: 100, expenses: 160, rate: -60 })), /\$/);
    assert.match(plain(monthSentence({ income: 8420, expenses: 5710, rate: 32 })), /kept 32%/);
  });
});

test('the sync schedule in words', () => {
  const base = {
    enabled: true,
    frequency: 'days' as const,
    every: 1,
    weekday: 1,
    day: 1,
    time: '06:00',
  };
  const s = (over = {}) => plain(scheduleSentence({ ...base, ...over }));
  assert.equal(s(), 'Moneyrill checks your banks every day at 6:00 AM.');
  assert.equal(
    s({ every: 3, time: '13:30' }),
    'Moneyrill checks your banks every 3 days at 1:30 PM.',
  );
  assert.equal(
    s({ frequency: 'weekly', weekday: 5 }),
    'Moneyrill checks your banks every Friday at 6:00 AM.',
  );
  assert.equal(
    s({ frequency: 'monthly', day: 1 }),
    'Moneyrill checks your banks on the 1st of each month at 6:00 AM.',
  );
  assert.equal(
    s({ frequency: 'monthly', day: 22, time: '00:05' }),
    'Moneyrill checks your banks on the 22nd of each month at 12:05 AM.',
  );
  assert.equal(
    s({ frequency: 'monthly', day: 11 }),
    'Moneyrill checks your banks on the 11th of each month at 6:00 AM.',
  );
  assert.equal(
    s({ frequency: 'hours', every: 6, time: '00:00' }),
    'Moneyrill checks your banks every 6 hours.',
  );
  assert.equal(
    s({ frequency: 'hours', every: 1, time: '00:15' }),
    'Moneyrill checks your banks every hour at 15 minutes past.',
  );
  assert.equal(
    s({ frequency: null }),
    'Moneyrill checks your banks on a schedule set by the deployment.',
  );
  assert.equal(s({ enabled: false }), 'Automatic sync is off. Sync accounts runs one on demand.');
  assert.deepEqual(styled(scheduleSentence({ ...base, enabled: false }), 'warn'), ['off']);
  assert.deepEqual(
    [clock('00:00'), clock('12:00'), clock('23:59'), clock('9:5x')],
    ['12:00 AM', '12:00 PM', '11:59 PM', '9:5x'],
  );
});

test('the pill under net worth says how long the change has run', () => {
  assert.equal(changePhrase('1M'), 'since last month');
  assert.equal(changePhrase('3M'), 'over the last 3 months');
  assert.equal(changePhrase('1Y'), 'over the last year');
  assert.equal(changePhrase('ALL'), 'since the start');
});

test('the allocation sentence names what leads, and the periods head the stats', () => {
  assert.equal(
    plain(allocationSentence({ name: 'US stocks', share: 62.4 })),
    'Mostly US stocks, 62% of the portfolio.',
  );
  assert.equal(
    plain(allocationSentence({ name: 'Bonds', share: 38 })),
    'Your largest share is Bonds at 38%.',
  );
  assert.deepEqual(styled(allocationSentence({ name: 'Bonds', share: 38 }), 'figure'), ['Bonds']);
  assert.equal(plain(allocationSentence(null)), 'Nothing is allocated yet.');
  assert.deepEqual(['1M', 'YTD', '1Y', 'ALL'].map(periodName), ['1M', 'YTD', '1Y', 'All-time']);
});

test('the best period of a report, and nothing when there was no good one', () => {
  assert.equal(
    plain(bestPeriodSentence({ unit: 'month', name: 'September', kept: 3500 })),
    'Your best month was September, when you kept $3,500.',
  );
  assert.equal(
    plain(bestPeriodSentence({ unit: 'quarter', name: 'Q3 2026', kept: 9000.4 })),
    'Your best quarter was Q3 2026, when you kept $9,000.',
  );
  assert.deepEqual(bestPeriodSentence({ unit: 'month', name: 'May', kept: -10 }), []);
  assert.deepEqual(bestPeriodSentence(null), []);
  privately(() =>
    assert.doesNotMatch(plain(bestPeriodSentence({ unit: 'month', name: 'May', kept: 100 })), /\$/),
  );
});
