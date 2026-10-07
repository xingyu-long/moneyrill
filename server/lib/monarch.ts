// Pure logic for the one-off Monarch CSV import: parsing, account matching and the overlap plan.
// Bank and card accounts only. Nothing here touches the database, and nothing logs row contents.
import Decimal from 'decimal.js';

export const MAX_MONARCH_ROWS = 20000;
/** Plaid and Monarch can disagree on a transaction's date by a few days (posted vs purchase date). */
export const MATCH_DAYS = 3;

/** RFC 4180: quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF, a leading BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('The file has a quote that is never closed');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export type MonarchRow = {
  line: number;
  date: string;
  merchant: string;
  category: string;
  account: string;
  statement: string;
  notes: string;
  /** Provider sign: positive = money out (Monarch's own sign is the opposite). */
  amount: string;
  id: string;
};

const REQUIRED = [
  'Date',
  'Merchant',
  'Category',
  'Account',
  'Original Statement',
  'Notes',
  'Amount',
  'Id',
] as const;

const realDate = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v;
};

/** Rows that could not be read are counted by line number only; their contents are never reported. */
export function parseMonarchCsv(text: string): { rows: MonarchRow[]; invalidLines: number[] } {
  const table = parseCsv(text);
  if (!table.length) throw new Error('The file is empty');
  const header = table[0].map((h) => h.trim());
  const at: Record<string, number> = {};
  for (const name of REQUIRED) {
    at[name] = header.indexOf(name);
    if (at[name] < 0)
      throw new Error(`This does not look like a Monarch export: no "${name}" column`);
  }
  if (table.length - 1 > MAX_MONARCH_ROWS)
    throw new Error(`The file has more than ${MAX_MONARCH_ROWS} rows`);
  const rows: MonarchRow[] = [];
  const invalidLines: number[] = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    if (cells.length !== header.length) return invalidLines.push(line);
    const get = (name: (typeof REQUIRED)[number]) => cells[at[name]].trim();
    const date = get('Date');
    const id = get('Id');
    const account = get('Account');
    const rawAmount = get('Amount').replace(/[$,\s]/g, '');
    if (!realDate(date) || !id || id.length > 100 || !account || !/^-?\d*\.?\d+$/.test(rawAmount))
      return invalidLines.push(line);
    rows.push({
      line,
      date,
      merchant: get('Merchant'),
      category: get('Category'),
      account,
      statement: get('Original Statement'),
      notes: cells[at['Notes']].trim().slice(0, 2000),
      amount: new Decimal(rawAmount).neg().toFixed(),
      id,
    });
  });
  return { rows, invalidLines };
}

/**
 * The last four digits Monarch prints in an account's name: "Rewards Card (...1111)" -> "1111".
 * Null when there are none ("Apple Card", "Individual ...777 (....777)", "Plan").
 */
export function maskOf(label: string): string | null {
  const m = /\(([^()]*)\)\s*$/.exec(label.trim());
  if (!m) return null;
  const digits = /(\d{4})$/.exec(m[1].replace(/^\.+/, '').trim());
  return digits ? digits[1] : null;
}

export type LocalAccount = { id: string; name: string; institution: string; mask: string };
export type PlaidRow = {
  id: string;
  account_id: string;
  date: string;
  amount: string;
  category_id: number | null;
  notes: string;
};
export type PlanInput = {
  rows: MonarchRow[];
  accounts: LocalAccount[];
  plaid: PlaidRow[];
  importedIds: Set<string>;
  /** lower-case name -> id, for every existing category */
  categories: Map<string, number>;
  /** id of the Uncategorized fallback, which is never written as a choice */
  uncategorizedId: number | null;
  today: string;
};

export type AccountSummary = {
  label: string;
  rows: number;
  matched: string | null;
  skipped: string | null;
  /** Older than Plaid's history: added */
  toImport: number;
  /** Also in Plaid: Monarch's category and notes are copied onto the Plaid row */
  toMerge: number;
  /** Plaid already has your own category or notes on the matching row */
  keptYours: number;
  /** In or next to Plaid's window with no matching Plaid row: left out, to avoid duplicates */
  leftOut: number;
  alreadyImported: number;
};

export type NewTransaction = {
  account_id: string;
  external_id: string;
  date: string;
  amount: string;
  name: string;
  merchant_name: string | null;
  notes: string;
  /** Existing category id, or a name to create; null = none */
  category_id: number | null;
  new_category: string | null;
};
export type Merge = {
  id: string;
  category_id: number | null;
  new_category: string | null;
  notes: string;
};

export type Plan = {
  accounts: AccountSummary[];
  insert: NewTransaction[];
  merge: Merge[];
  /** name -> true when every row in it is money in */
  newCategories: { name: string; rows: number; income: boolean }[];
  futureRows: number;
  totals: {
    rows: number;
    notBankOrCard: number;
    toImport: number;
    toMerge: number;
    keptYours: number;
    leftOut: number;
    alreadyImported: number;
  };
};

const dayNumber = (iso: string) => Date.parse(iso + 'T00:00:00Z') / 86400000;
const daysApart = (a: string, b: string) => Math.abs(dayNumber(a) - dayNumber(b));
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/**
 * Plaid keeps everything it has; Monarch fills in. Per account: a Monarch row dated before the window
 * (Plaid's first day minus a few) is added; one inside it is matched to a Plaid row (same amount, a few
 * days apart, one-to-one) and only donates its category and notes where the Plaid row has none of yours;
 * one inside the window with no match is left out rather than risk a duplicate.
 */
export function planMonarchImport(input: PlanInput): Plan {
  const { rows, accounts, plaid, importedIds, categories, uncategorizedId, today } = input;
  const byMask = new Map<string, LocalAccount[]>();
  for (const a of accounts) byMask.set(a.mask, [...(byMask.get(a.mask) ?? []), a]);

  const groups = new Map<string, MonarchRow[]>();
  for (const r of rows) groups.set(r.account, [...(groups.get(r.account) ?? []), r]);

  const insert: NewTransaction[] = [];
  const merge: Merge[] = [];
  const summaries: AccountSummary[] = [];
  const created = new Map<string, { name: string; rows: number; income: boolean }>();
  let future = 0;

  const resolve = (name: string) => {
    const clean = name.trim().slice(0, 60);
    if (!clean || clean.toLowerCase() === 'uncategorized') return { id: null, fresh: null };
    const id = categories.get(clean.toLowerCase());
    if (id !== undefined) return { id: id === uncategorizedId ? null : id, fresh: null };
    return { id: null, fresh: clean };
  };
  const noteNewCategory = (name: string, amount: string) => {
    const key = name.toLowerCase();
    const entry = created.get(key) ?? { name, rows: 0, income: true };
    entry.rows++;
    if (!new Decimal(amount).isNegative()) entry.income = false;
    created.set(key, entry);
  };

  for (const [label, all] of groups) {
    const mask = maskOf(label);
    const candidates = mask ? (byMask.get(mask) ?? []) : [];
    const summary: AccountSummary = {
      label,
      rows: all.length,
      matched: null,
      skipped: null,
      toImport: 0,
      toMerge: 0,
      keptYours: 0,
      leftOut: 0,
      alreadyImported: 0,
    };
    summaries.push(summary);
    if (!mask) summary.skipped = 'No account number in its name (not a bank or card account here)';
    else if (!candidates.length) summary.skipped = `No bank or card account ending ${mask} here`;
    else if (candidates.length > 1)
      summary.skipped = `More than one account ends ${mask}, so it cannot be matched safely`;
    if (summary.skipped) continue;
    const account = candidates[0];
    summary.matched = `${account.name} (…${account.mask}) · ${account.institution}`;

    const ours = plaid.filter((p) => p.account_id === account.id);
    const first = ours.reduce<string | null>(
      (min, p) => (min === null || p.date < min ? p.date : min),
      null,
    );
    const windowStart = first === null ? null : addDays(first, -MATCH_DAYS);
    const free = new Set(ours.map((p) => p.id));

    for (const row of [...all].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.line - b.line,
    )) {
      if (row.date > today) {
        future++;
        continue;
      }
      if (importedIds.has(row.id)) {
        summary.alreadyImported++;
        continue;
      }
      const { id: categoryId, fresh } = resolve(row.category);
      if (windowStart === null || row.date < windowStart) {
        insert.push({
          account_id: account.id,
          external_id: row.id,
          date: row.date,
          amount: row.amount,
          name: row.statement || row.merchant || 'Imported transaction',
          merchant_name: row.merchant || null,
          notes: row.notes,
          category_id: categoryId,
          new_category: fresh,
        });
        if (fresh) noteNewCategory(fresh, row.amount);
        summary.toImport++;
        continue;
      }
      let best: PlaidRow | null = null;
      for (const p of ours) {
        if (!free.has(p.id) || !new Decimal(p.amount).equals(row.amount)) continue;
        const gap = daysApart(p.date, row.date);
        if (gap <= MATCH_DAYS && (best === null || gap < daysApart(best.date, row.date))) best = p;
      }
      if (!best) {
        summary.leftOut++;
        continue;
      }
      free.delete(best.id);
      const wantsCategory = best.category_id === null && (categoryId !== null || fresh !== null);
      const wantsNotes = best.notes === '' && row.notes !== '';
      if (wantsCategory || wantsNotes) {
        merge.push({
          id: best.id,
          category_id: wantsCategory ? categoryId : null,
          new_category: wantsCategory ? fresh : null,
          notes: wantsNotes ? row.notes : '',
        });
        if (wantsCategory && fresh) noteNewCategory(fresh, row.amount);
        summary.toMerge++;
      } else summary.keptYours++;
    }
  }

  const sum = (f: (s: AccountSummary) => number) => summaries.reduce((n, s) => n + f(s), 0);
  return {
    accounts: summaries.sort((a, b) => b.rows - a.rows),
    insert,
    merge,
    newCategories: [...created.values()].sort((a, b) => b.rows - a.rows),
    futureRows: future,
    totals: {
      rows: rows.length,
      notBankOrCard: sum((s) => (s.skipped ? s.rows : 0)),
      toImport: sum((s) => s.toImport),
      toMerge: sum((s) => s.toMerge),
      keptYours: sum((s) => s.keptYours),
      leftOut: sum((s) => s.leftOut),
      alreadyImported: sum((s) => s.alreadyImported),
    },
  };
}
