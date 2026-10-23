import { cashWhole, dateLabelYear } from './format.ts';
import { CUSTOM } from './periods.ts';
import { shortDay, type DateSpec } from './reportDates.ts';
import type { Tab } from './routes.ts';

// The one plain sentence under each page's title ("You've kept 32% of your income this month."). Each function takes
// the numbers it needs and returns parts rather than a string, so the page can give figures their own style:
// `money` is an amount (masked in private mode, like every amount), `figure` a highlighted number, `warn` something
// that needs a look. Short and factual: no advice.
export type Part = { text: string; style?: 'money' | 'figure' | 'warn' };
export type Sentence = Part[];

const text = (t: string): Part => ({ text: t });
const money = (v: number): Part => ({ text: cashWhole(v), style: 'money' });
const figure = (t: string): Part => ({ text: t, style: 'figure' });
const warn = (t: string): Part => ({ text: t, style: 'warn' });

const WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];
/** A small count in words ("ten"), a larger one in digits. */
export const spell = (n: number) => (Number.isInteger(n) && WORDS[n] ? WORDS[n] : String(n));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Good morning." until noon, "Good afternoon." until 6 pm, then "Good evening.". */
export const greeting = (hour: number) =>
  hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.';

/** The big title of a page: the greeting on Home, the page's own name elsewhere. */
export const pageTitle = (tab: Tab, hour: number) => (tab === 'Home' ? greeting(hour) : tab);

/** How long ago, for "synced within the last ...". */
const sinceText = (hours: number) => {
  if (hours <= 1) return 'hour';
  if (hours < 24) return `${Math.ceil(hours)} hours`;
  const days = Math.ceil(hours / 24);
  return days === 1 ? 'day' : `${days} days`;
};

export const homeSentence = (): Sentence => [text("Here's where you stand today.")];

/**
 * `syncedHoursAgo` is how long ago the oldest bank-synced account last synced (null when none is synced by a bank,
 * for example when every account is kept by hand).
 */
export function accountsSentence(a: {
  count: number;
  problems: number;
  syncedHoursAgo: number | null;
}): Sentence {
  if (a.count === 0) return [text('No accounts yet.')];
  const noun = a.count === 1 ? 'account' : 'accounts';
  const count = cap(spell(a.count));
  if (a.problems > 0)
    return [
      text(`${count} ${noun}. `),
      warn(
        a.problems === 1
          ? 'One needs reconnecting.'
          : `${cap(spell(a.problems))} need reconnecting.`,
      ),
    ];
  if (a.syncedHoursAgo === null) return [text(`${count} ${noun}.`)];
  const all = a.count === 1 ? '' : 'all ';
  return [text(`${count} ${noun}, ${all}synced within the last ${sinceText(a.syncedHoursAgo)}.`)];
}

/**
 * The days a change runs over: `early` when a short range had to open on an earlier snapshot. Only a custom range and
 * an early one are described by their dates; the others keep their own words.
 */
export type Span = { from: string; to: string; early: boolean };

function spanPhrase(period: string, span?: Span) {
  if (!span) return null;
  if (period === CUSTOM) return `from ${shortDay(span.from)} to ${shortDay(span.to)}`;
  return span.early ? `since ${shortDay(span.from)}` : null;
}

/** The chart range's own words, for "... over the last month". */
const PERIOD_PHRASE: Record<string, string> = {
  '1D': 'over the last day',
  '1W': 'over the last week',
  '1M': 'over the last month',
  '2M': 'over the last 2 months',
  '3M': 'over the last 3 months',
  '6M': 'over the last 6 months',
  YTD: 'so far this year',
  '1Y': 'over the last year',
  ALL: 'since the start',
};
export const periodPhrase = (period: string, span?: Span) =>
  spanPhrase(period, span) ?? PERIOD_PHRASE[period] ?? 'over this range';

/** What the top of the allocation says: "Mostly US stocks, 62% of the portfolio." */
export function allocationSentence(a: { name: string; share: number } | null): Sentence {
  if (!a) return [text('Nothing is allocated yet.')];
  const pct = `${Math.round(a.share)}%`;
  return a.share >= 50
    ? [text('Mostly '), figure(a.name), text(`, ${pct} of the portfolio.`)]
    : [text('Your largest share is '), figure(a.name), text(` at ${pct}.`)];
}

/** "Your best month was September, when you kept $3,500." (`kept` is that period's net). */
export function bestPeriodSentence(
  b: { unit: string; name: string; kept: number } | null,
): Sentence {
  if (!b || b.kept <= 0) return [];
  return [
    text(`Your best ${b.unit} was `),
    figure(b.name),
    text(', when you kept '),
    money(b.kept),
    text('.'),
  ];
}

/** The chart periods as they head a stat: "YTD return", "1Y return", "All-time return". */
export const periodName = (period: string) => (period === 'ALL' ? 'All-time' : period);

/** How long a change has been going on, for the pill under net worth: "since last month", "over the last year". */
const CHANGE_PHRASE: Record<string, string> = {
  '1D': 'since yesterday',
  '1W': 'since last week',
  '1M': 'since last month',
};
export const changePhrase = (period: string, span?: Span) =>
  spanPhrase(period, span) ?? CHANGE_PHRASE[period] ?? periodPhrase(period);

/**
 * `change` is a percent. `kind` says what it measures: the portfolio's return (deposits and withdrawals left out) or,
 * when that cannot be worked out, the change in its value (which includes money added). Both are what the page shows.
 */
export function investmentsSentence(i: {
  hasAccounts: boolean;
  value: number;
  change: number | null;
  kind: 'return' | 'value';
  period: string;
}): Sentence {
  if (!i.hasAccounts) return [text('No investment accounts yet.')];
  const parts: Sentence = [text('Your portfolio is worth '), money(i.value)];
  if (i.change === null || !Number.isFinite(i.change)) return [...parts, text('.')];
  const move = figure(`${i.change >= 0 ? 'up' : 'down'} ${Math.abs(i.change).toFixed(2)}%`);
  return [
    ...parts,
    text(i.kind === 'return' ? ', ' : ', with its value '),
    move,
    text(` ${periodPhrase(i.period)}.`),
  ];
}

/**
 * `count` is this month's transactions; `more` says there were more than were counted. `out` and `inn` are the
 * month's spending and income as the reports count them, `pending` how many of the transactions have not posted.
 */
export function transactionsSentence(t: {
  count: number;
  more: boolean;
  out: number;
  inn: number;
  pending: number;
}): Sentence {
  if (t.count === 0) return [text('Nothing yet this month.')];
  const parts: Sentence = [
    text(`${t.count}${t.more ? '+' : ''} this month, `),
    money(t.out),
    text(' out and '),
    money(t.inn),
    text(' in.'),
  ];
  if (t.pending > 0)
    parts.push(
      text(` ${t.pending === 1 ? 'One is' : `${cap(spell(t.pending))} are`} still pending.`),
    );
  return parts;
}

const LEADS: Record<string, string> = {
  last7: 'In the last 7 days',
  last30: 'In the last 30 days',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  thisYear: 'This year',
  lastYear: 'Last year',
};

/** How a report's date range opens a sentence: "This year", "In the last 30 days", "From Jan 1, 2026 to ...,". */
export function reportLead(spec: DateSpec): string {
  if (spec.mode === 'all') return 'Over all time';
  if (spec.mode === 'preset') return LEADS[spec.id] ?? 'Over this range';
  if (spec.mode === 'last')
    return `In the last ${spec.n === 1 ? spec.unit : `${spec.n} ${spec.unit}s`}`;
  return `From ${dateLabelYear(spec.from)} to ${dateLabelYear(spec.to)},`;
}

/**
 * `lead` is the date range in words (see reportLead). `rate` is the share of income kept, as a percent. With filters
 * chosen the totals are only part of the picture, so the sentence says so and leaves the rate out.
 */
export function reportsSentence(r: {
  lead: string;
  income: number;
  spending: number;
  rate: number | null;
  filtered: boolean;
}): Sentence {
  if (r.filtered)
    return [
      text(`${r.lead} your filters match `),
      money(r.income),
      text(' earned and '),
      money(r.spending),
      text(' spent.'),
    ];
  if (r.income <= 0 && r.spending <= 0) return [text(`${r.lead} there was no income or spending.`)];
  if (r.income <= 0) return [text(`${r.lead} you spent `), money(r.spending), text('.')];
  const parts: Sentence = [
    text(`${r.lead} you earned `),
    money(r.income),
    text(' and spent '),
    money(r.spending),
    text('.'),
  ];
  if (r.rate === null) return parts;
  return r.rate < 0
    ? [...parts, text(' You spent more than you earned.')]
    : [...parts, text(' You kept '), figure(`${r.rate}%`), text('.')];
}

/** Home's "This month" card: the share of income kept, or what is missing to say it. */
export function monthSentence(m: {
  income: number;
  expenses: number;
  rate: number | null;
}): Sentence {
  if (m.income <= 0)
    return m.expenses > 0
      ? [text('No income yet this month. You have spent '), money(m.expenses), text('.')]
      : [text('No income or spending yet this month.')];
  if (m.rate === null) return [text('Nothing to compare yet this month.')];
  if (m.rate < 0)
    return [
      text('You spent '),
      money(m.expenses - m.income),
      text(' more than you earned this month.'),
    ];
  return [text("You've kept "), figure(`${m.rate}%`), text(' of your income this month.')];
}

/** Home's "Assets and debt" card. */
export function assetsSentence(a: { assets: number; liabilities: number }): Sentence {
  const own: Sentence = [text('You own '), money(a.assets)];
  if (a.liabilities <= 0) return [...own, text(' and owe nothing.')];
  return [...own, text(' and owe '), { text: cashWhole(a.liabilities), style: 'warn' }, text('.')];
}

/** Home's "Investments" card: the change in the portfolio's value over the chart range (money added counts). */
export function portfolioSentence(p: {
  change: number | null;
  period: string;
  span?: Span;
}): Sentence {
  if (p.change === null || !Number.isFinite(p.change)) return [text('Not enough history yet.')];
  return [
    text("Your portfolio's value is "),
    figure(`${p.change >= 0 ? 'up' : 'down'} ${Math.abs(p.change).toFixed(2)}%`),
    text(` ${periodPhrase(p.period, p.span)}.`),
  ];
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** "13:00" as "1:00 PM". */
export function clock(time: string) {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return time;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const ordinal = (n: number) => {
  const mod = n % 100;
  if (mod >= 11 && mod <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/**
 * The sync schedule in words: "Moneyrill checks your banks every day at 6:00 AM." `frequency` is null when the
 * deployment sets its own schedule (SYNC_CRON), which the page cannot describe more closely.
 */
export function scheduleSentence(s: {
  enabled: boolean;
  frequency: 'hours' | 'days' | 'weekly' | 'monthly' | null;
  every: number;
  weekday: number;
  day: number;
  time: string;
}): Sentence {
  if (!s.enabled)
    return [text('Automatic sync is '), warn('off'), text('. Sync accounts runs one on demand.')];
  const lead = 'Moneyrill checks your banks ';
  if (s.frequency === null)
    return [text(lead), figure('on a schedule set by the deployment'), text('.')];
  if (s.frequency === 'hours') {
    const minute = s.time.slice(3) || '00';
    return [
      text(lead),
      figure(s.every === 1 ? 'every hour' : `every ${s.every} hours`),
      text(minute === '00' ? '.' : ` at ${minute} minutes past.`),
    ];
  }
  const at = ` at ${clock(s.time)}.`;
  if (s.frequency === 'days')
    return [text(lead), figure(s.every === 1 ? 'every day' : `every ${s.every} days`), text(at)];
  if (s.frequency === 'weekly')
    return [text(lead), figure(`every ${WEEKDAY_NAMES[s.weekday] ?? 'week'}`), text(at)];
  return [text(lead), figure(`on the ${ordinal(s.day)} of each month`), text(at)];
}

export function settingsSentence(s: { attention: number }): Sentence {
  const base = text('Everything stays on this machine, in your own database.');
  if (s.attention === 0) return [base];
  return [
    base,
    text(' '),
    warn(
      s.attention === 1
        ? 'One connection needs your attention.'
        : `${cap(spell(s.attention))} connections need your attention.`,
    ),
  ];
}
