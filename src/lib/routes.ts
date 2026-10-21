// Which page a URL stands for, and the URL for a page. Pure, so it can be tested without a browser.
// URLs carry view names, dates and ids only, never amounts (they end up in the browser history).
import { parseIso } from './calendar.ts';
import {
  ALL_TIME,
  DEFAULT_DATE,
  MAX_N,
  PRESETS,
  type DateSpec,
  type PresetId,
  type Unit,
} from './reportDates.ts';

export const TABS = [
  'Home',
  'Accounts',
  'Investments',
  'Transactions',
  'Reports',
  'Settings',
] as const;
export type Tab = (typeof TABS)[number];
const slug = (tab: Tab) => tab.toLowerCase();

const segments = (pathname: string) => pathname.split('/').filter(Boolean);

/** The tab for a path; `/` and anything unknown are Home. */
export function tabOf(pathname: string): Tab {
  const first = segments(pathname)[0]?.toLowerCase();
  return TABS.find((t) => slug(t) === first) ?? 'Home';
}

/** True when the path names a tab (or is `/`); anything else is sent to Accounts. */
export const isKnownPath = (pathname: string) => {
  const first = segments(pathname)[0]?.toLowerCase();
  return first === undefined || TABS.some((t) => slug(t) === first);
};

export const tabPath = (tab: Tab) => '/' + slug(tab);

// --- One account's page: /accounts/<id> (the id is in the path, never an amount) ---
export const accountPath = (id: string) => '/accounts/' + encodeURIComponent(id);

/** The account a path opens; null for `/accounts` itself and for anything else. */
export function accountIdOf(pathname: string): string | null {
  const [first, second] = segments(pathname);
  if (first?.toLowerCase() !== 'accounts' || !second) return null;
  try {
    return decodeURIComponent(second);
  } catch {
    return null;
  }
}

// --- Settings: a second level of pages under /settings ---
export const SETTINGS_PAGES = [
  { slug: 'connections', label: 'Connections' },
  { slug: 'data', label: 'Data' },
  { slug: 'categories', label: 'Categories' },
  { slug: 'rules', label: 'Rules' },
  { slug: 'sync', label: 'Sync settings & activity' },
  { slug: 'display', label: 'Display and navigation' },
  { slug: 'sign-in', label: 'Sign-in' },
] as const;
export type SettingsSlug = (typeof SETTINGS_PAGES)[number]['slug'];
export const settingsPath = (page?: SettingsSlug) => '/settings' + (page ? '/' + page : '');

/** The Settings page named in a path; null for `/settings` itself (the list) and for anything unknown. */
export function settingsPageOf(pathname: string): SettingsSlug | null {
  const [first, second] = segments(pathname).map((s) => s.toLowerCase());
  if (first !== 'settings') return null;
  return SETTINGS_PAGES.find((p) => p.slug === second)?.slug ?? null;
}

// --- Reports ---
export const SUBS = ['Cash flow', 'Spending', 'Income'] as const;
export type Sub = (typeof SUBS)[number];
const SUB_SLUG: Record<Sub, string> = {
  'Cash flow': 'cash-flow',
  Spending: 'spending',
  Income: 'income',
};
const subOf = (s: string | undefined) => SUBS.find((x) => SUB_SLUG[x] === s);
export type Interval = 'month' | 'quarter' | 'year';
const INTERVALS: Interval[] = ['month', 'quarter', 'year'];

/** What a history page is about: one category, or one merchant. */
type History = {
  type: 'income' | 'expense';
  /** The report it was opened from, for the way back. */
  via: Sub;
  interval: Interval;
  /** Start of the chosen period; none = the latest with activity. */
  period?: string;
};
export type ReportRoute = {
  date: DateSpec;
  categories: number[];
  accounts: string[];
} & (
  | { view: 'sub'; sub: Sub }
  | ({ view: 'category'; id: number } & History)
  | ({ view: 'merchant'; name: string } & History)
);

const PRESET_SLUG: Record<PresetId, string> = {
  last7: 'last-7-days',
  last30: 'last-30-days',
  thisMonth: 'this-month',
  lastMonth: 'last-month',
  thisYear: 'this-year',
  lastYear: 'last-year',
};

const ALL_TIME_SLUG = 'all-time';

/** The range in an address; no range (or one that does not parse) is the default, this year. */
function dateOf(q: URLSearchParams): DateSpec {
  const range = q.get('range');
  if (range === ALL_TIME_SLUG) return ALL_TIME;
  if (range) {
    const preset = PRESETS.find((p) => PRESET_SLUG[p.id] === range);
    if (preset) return { mode: 'preset', id: preset.id };
    const m = /^last-(\d{1,5})-(day|week|month|quarter|year)s?$/.exec(range);
    if (m) {
      const n = Number(m[1]);
      const unit = m[2] as Unit;
      if (n >= 1 && n <= MAX_N[unit]) return { mode: 'last', n, unit };
    }
    return DEFAULT_DATE;
  }
  const from = q.get('from') ?? '';
  const to = q.get('to') ?? '';
  return parseIso(from) && parseIso(to) && from <= to ? { mode: 'range', from, to } : DEFAULT_DATE;
}

const safeDecode = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return null;
  }
};

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

/** The Reports page for a path under /reports, or null for a bare /reports (or an unknown page there). */
export function parseReport(pathname: string, search: string): ReportRoute | null {
  const [, a, b] = segments(pathname);
  const q = new URLSearchParams(search);
  const base = {
    date: dateOf(q),
    categories: [...new Set(list(q.get('categories')).map(Number))].filter(
      (n) => Number.isInteger(n) && n > 0,
    ),
    accounts: [...new Set(list(q.get('accounts')))],
  };
  const sub = subOf(a);
  if (sub && b === undefined) return { ...base, view: 'sub', sub };
  const type = q.get('type') === 'income' ? 'income' : 'expense';
  const history = () => {
    const period = q.get('period');
    return {
      type: type as 'income' | 'expense',
      via: subOf(q.get('via') ?? undefined) ?? (type === 'income' ? 'Income' : 'Spending'),
      interval: INTERVALS.find((i) => i === q.get('interval')) ?? 'month',
      ...(period && parseIso(period) ? { period } : {}),
    };
  };
  const id = Number(b);
  if (a === 'category' && Number.isInteger(id) && id > 0)
    return { ...base, view: 'category', id, ...history() };
  if (a === 'merchant' && b) {
    const name = safeDecode(b);
    if (name && name.trim() && name.length <= 200)
      return { ...base, view: 'merchant', name, ...history() };
  }
  return null;
}

/** The URL for a Reports page; commas in lists stay readable. */
export function reportUrl(r: ReportRoute) {
  const q: [string, string][] = [];
  const d = r.date;
  if (d.mode === 'all') q.push(['range', ALL_TIME_SLUG]);
  // The default range is the address without one, so a bare /reports/spending stays the same page.
  if (d.mode === 'preset' && !(DEFAULT_DATE.mode === 'preset' && d.id === DEFAULT_DATE.id))
    q.push(['range', PRESET_SLUG[d.id]]);
  if (d.mode === 'last') q.push(['range', `last-${d.n}-${d.unit}${d.n === 1 ? '' : 's'}`]);
  if (d.mode === 'range') q.push(['from', d.from], ['to', d.to]);
  if (r.categories.length) q.push(['categories', r.categories.join(',')]);
  if (r.accounts.length) q.push(['accounts', r.accounts.map(encodeURIComponent).join(',')]);
  let path = '/reports/';
  if (r.view === 'sub') path += SUB_SLUG[r.sub];
  else {
    path += r.view === 'category' ? `category/${r.id}` : `merchant/${encodeURIComponent(r.name)}`;
    q.push(['type', r.type], ['via', SUB_SLUG[r.via]]);
    if (r.interval !== 'month') q.push(['interval', r.interval]);
    if (r.period) q.push(['period', r.period]);
  }
  const query = q
    .map(([k, v]) => `${k}=${k === 'accounts' || k === 'categories' ? v : encodeURIComponent(v)}`)
    .join('&');
  return path + (query ? '?' + query : '');
}

export const DEFAULT_REPORT = '/reports/cash-flow';

/** A remembered Reports URL is only reused when it still parses. */
export const usableReportUrl = (url: unknown) =>
  typeof url === 'string' &&
  url.startsWith('/reports/') &&
  parseReport(url.split('?')[0], url.includes('?') ? url.slice(url.indexOf('?')) : '') !== null;
