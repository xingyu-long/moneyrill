// A small, fully made-up portfolio served in place of /api/overview.
const day = (d: number) => `2026-10-0${d}`;
const account = (id: string, name: string, kind: string, balance: string, extra = {}) => ({
  id,
  name,
  institution: 'Test Bank',
  kind,
  currency: 'USD',
  mask: id.slice(-4),
  included: true,
  source: 'simulated',
  balance,
  balance_date: day(3),
  last_synced: '2026-10-03T12:00:00Z',
  last_error: null,
  provider_as_of: null,
  holdings_as_of: kind === 'investment' ? day(3) : null,
  ...extra,
});
const holding = (
  account_id: string,
  symbol: string,
  name: string,
  date: string,
  q: string,
  p: string,
  v: string,
  basis: string | null,
  asset = 'Equities',
) => ({
  account_id,
  security_id: `${account_id}:${symbol}`,
  date,
  quantity: q,
  price: p,
  value: v,
  cost_basis: basis,
  symbol,
  name,
  asset_class: asset,
  provenance: 'simulated',
});

export const overview = {
  // Most tests answer every request, /api/auth/status included, with this body: it says the browser is signed in.
  configured: true,
  authenticated: true,
  accounts: [
    account('brokerage', 'Individual brokerage', 'investment', '1100'),
    account('roth', 'Roth IRA', 'investment', '700'),
    account('empty', 'Mystery account', 'investment', '250'),
    account('checking', 'Everyday checking', 'cash', '500'),
    account('card', 'Travel card', 'credit', '200'),
  ],
  balances: [
    'brokerage:1000:1100',
    'roth:600:700',
    'empty:250:250',
    'checking:400:500',
    'card:300:200',
  ].flatMap((row) => {
    const [account_id, a, b] = row.split(':');
    return [
      { account_id, date: day(1), current_balance: a, provenance: 'simulated' },
      { account_id, date: day(3), current_balance: b, provenance: 'simulated' },
    ];
  }),
  holdings: [
    holding('brokerage', 'VTI', 'Total US stock market', day(1), '9', '100', '900', '700'),
    holding('brokerage', 'VTI', 'Total US stock market', day(3), '10', '110', '1100', '800'),
    holding('roth', 'VTI', 'Total US stock market', day(3), '5', '110', '550', '400'),
    holding('roth', 'CASH', 'Brokerage cash', day(3), '150', '1', '150', null, 'Cash'),
  ],
  benchmarks: [],
  connections: [],
  runs: [],
  mode: 'sandbox',
  environment: 'staging',
  hasSandboxKeys: false,
  hasPlaidKeys: false,
};

// Made-up transactions and categories served by the Transactions tab.
export const groupList = [
  { id: 1, type: 'income', name: 'Income', sort_order: 10 },
  { id: 2, type: 'expense', name: 'Food & Dining', sort_order: 40 },
  { id: 3, type: 'expense', name: 'Housing', sort_order: 30 },
  { id: 4, type: 'transfer', name: 'Transfers', sort_order: 10 },
  { id: 5, type: 'expense', name: 'Other', sort_order: 90 },
];
const category = (
  id: number,
  name: string,
  emoji: string,
  group_id: number,
  key: string | null,
) => ({
  id,
  name,
  emoji,
  group_id,
  group_name: groupList.find((g) => g.id === group_id)!.name,
  type: groupList.find((g) => g.id === group_id)!.type,
  key,
  sort_order: id,
  transaction_count: id === 1 ? 1 : 0,
});
export const categoryList = [
  category(3, 'Paychecks', '💵', 1, 'paychecks'),
  category(2, 'Rent', '🏠', 3, 'rent'),
  category(1, 'Groceries', '🥑', 2, 'groceries'),
  category(7, 'Dog food', '🐶', 2, null),
  category(8, 'Transfer', '🔁', 4, 'transfer'),
  category(9, 'Uncategorized', '❓', 5, 'uncategorized'),
];
const cat = (id: number) => {
  const c = categoryList.find((x) => x.id === id)!;
  return { id: c.id, name: c.name, emoji: c.emoji, group: c.group_name };
};
const txn = (id: string, date: string, amount: string, name: string, extra = {}) => ({
  id,
  account_id: 'checking',
  account_name: 'Everyday checking',
  account_mask: '1234',
  institution: 'Test Bank',
  account_included: true,
  date,
  provider_date: date,
  user_date: null,
  amount,
  currency: 'USD',
  name,
  merchant_name: null,
  pending: false,
  notes: '',
  category: cat(9),
  category_source: 'none',
  source: 'plaid',
  splits: [],
  split_balanced: true,
  activity: 'bank',
  account_kind: 'cash',
  ...extra,
});
export const transactionList = [
  txn('t1', '2026-10-03', '64.10', 'WHOLE MARKET #104', {
    merchant_name: 'Whole Market',
    pending: true,
    category: cat(1),
    category_source: 'auto',
  }),
  txn('t2', '2026-10-02', '1850.00', 'ZELLE TO LANDLORD', {
    category: cat(2),
    category_source: 'user',
  }),
  txn('t3', '2026-10-02', '-3200.00', 'ACME PAYROLL', {
    merchant_name: 'Acme Corp',
    category: cat(3),
    category_source: 'auto',
  }),
];

// A dividend in a brokerage account: listed only when investment accounts are shown, not counted until categorised.
export const dividendActivity = txn('i1', '2026-10-02', '-42.50', 'VTI DIVIDEND', {
  account_id: 'broker',
  account_name: 'Individual brokerage',
  account_mask: '1842',
  account_kind: 'investment',
  category: null,
  category_source: 'none',
  activity: 'investment',
  investment: {
    type: 'cash',
    subtype: 'dividend',
    quantity: '0',
    price: null,
    fees: null,
    security: { symbol: 'VTI', name: 'Total US stock market' },
  },
});

// A posted transaction that can be edited (the pending one in transactionList cannot).
export const plainTransaction = txn('t6', '2026-10-03', '64.10', 'ROASTER SHOP #1', {
  merchant_name: 'Roaster Shop',
  category: cat(1),
  category_source: 'auto',
});

// A transaction recorded by hand: an RSU vest ($12,500 money in).
export const manualTransaction = txn('t7', '2026-09-15', '-12500.00', 'RSU vest AVGO', {
  merchant_name: 'RSU vest AVGO',
  account_id: 'brokerage',
  account_name: 'Individual brokerage',
  account_mask: null,
  category: cat(3),
  category_source: 'user',
  source: 'manual',
  notes: 'Q3 vest',
});

// A split transaction: $100 into groceries and rent. Kept out of transactionList so other tests are unchanged.
export const splitTransaction = txn('t4', '2026-10-01', '100.00', 'BIG BOX STORE', {
  merchant_name: 'Big Box',
  splits: [
    { id: 1, amount: '60.00', notes: 'food', date: null, category: cat(1) },
    { id: 2, amount: '40.00', notes: '', date: '2026-10-15', category: cat(2) },
  ],
});
export const refund = txn('t5', '2026-10-01', '-30.00', 'REFUND STORE', {
  merchant_name: 'Refund Store',
});

export const monarchSummary = (over: any = {}) => ({
  committed: false,
  accounts: [
    {
      label: 'Rewards Card (...1111)',
      rows: 120,
      matched: 'Rewards Card (…1111) · Example Bank',
      skipped: null,
      toImport: 90,
      toMerge: 20,
      keptYours: 3,
      leftOut: 5,
      alreadyImported: 2,
    },
    {
      label: 'Apple Card',
      rows: 30,
      matched: null,
      skipped: 'No account number in its name (not a bank or card account here)',
      toImport: 0,
      toMerge: 0,
      keptYours: 0,
      leftOut: 0,
      alreadyImported: 0,
    },
  ],
  newCategories: [{ name: 'RSU', rows: 4, income: true }],
  futureRows: 1,
  unreadableRows: 2,
  unreadableLines: [7, 9],
  totals: {
    rows: 150,
    notBankOrCard: 30,
    toImport: 90,
    toMerge: 20,
    keptYours: 3,
    leftOut: 5,
    alreadyImported: 2,
  },
  ...over,
});

// Made-up reports: three months, income from one paycheck category, spending in two categories.
const slice = (id: number, amount: string, share: number) => ({ category: cat(id), amount, share });
const period = (start: string, end: string, income: string, expenses: string, net: string) => ({
  start,
  end,
  income,
  expenses,
  net,
  partial: false,
});
export const cashFlowReport = (over: any = {}) => ({
  range: { from: null, to: null },
  totals: { income: '4200.00', expenses: '2650.50', net: '1549.50', savings_rate: 36.9 },
  series: [
    period('2026-08-01', '2026-08-31', '1400.00', '900.00', '500.00'),
    period('2026-09-01', '2026-09-30', '1400.00', '850.50', '549.50'),
    { ...period('2026-10-01', '2026-10-31', '1400.00', '900.00', '500.00'), partial: true },
  ],
  breakdown: {
    from: '2026-08-01',
    to: '2026-10-03',
    totals: { income: '4200.00', expenses: '2650.50', net: '1549.50', savings_rate: 36.9 },
    income: [slice(3, '4200.00', 100)],
    expenses: [slice(2, '1850.00', 69.8), slice(1, '800.50', 30.2)],
  },
  first_date: '2026-08-01',
  last_date: '2026-10-03',
  skipped_non_usd: 0,
  ...over,
});
export const categoryReport = (type: 'income' | 'expense', over: any = {}) => ({
  type,
  total: type === 'income' ? '4200.00' : '2650.50',
  slices:
    type === 'income'
      ? [slice(3, '4200.00', 100)]
      : [slice(2, '1850.00', 69.8), slice(1, '800.50', 30.2), slice(7, '-10.00', 0)],
  summary: {
    count: type === 'income' ? 3 : 41,
    largest: type === 'income' ? '1400.00' : '1850.00',
    average: type === 'income' ? '1400.00' : '64.65',
    first_date: '2026-08-01',
    last_date: '2026-10-03',
  },
  ...over,
});

/** Serve the overview, transactions and categories; records every request as "METHOD /path". */
export function stubApi(
  calls: { url: string; method: string; body: any }[] = [],
  extra: any[] = [],
  monarch: (body: any) => { status: number; json: any } = (b) => ({
    status: 200,
    json: b.commit
      ? {
          ...monarchSummary({ committed: true }),
          applied: { imported: 90, merged: 20, categoriesCreated: 1 },
        }
      : monarchSummary(),
  }),
  reports: { cashFlow?: any; categories?: any } = {},
) {
  const all = () => [...transactionList, ...extra];
  return async (url: string, init: any = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const reply = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
    if (url === '/api/sync/schedule')
      return reply(
        method === 'PUT' && !body.reset
          ? { ...body, source: 'settings' }
          : {
              enabled: true,
              frequency: 'days',
              every: 1,
              weekday: 1,
              day: 1,
              time: '13:00',
              timezone: 'America/Los_Angeles',
              source: 'default',
            },
      );
    if (url === '/api/auth/status') return reply({ configured: true, authenticated: true });
    if (url.startsWith('/api/overview')) return reply(structuredClone(overview));
    if (url === '/api/transactions' && method === 'POST') {
      const row: any = {
        ...structuredClone(manualTransaction),
        id: 't-new',
        account_id: body.account_id,
        date: body.date,
        provider_date: body.date,
        name: body.name,
        merchant_name: body.name,
        amount: (body.direction === 'in' ? '-' : '') + body.amount,
        notes: body.notes ?? '',
      };
      return { ok: true, status: 200, json: async () => row };
    }
    if (method === 'DELETE' && /^\/api\/transactions\/[^/]+$/.test(url))
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (url === '/api/transactions/import-monarch') {
      const r = monarch(body);
      return { ok: r.status < 400, status: r.status, json: async () => r.json };
    }
    if (url.startsWith('/api/reports/cash-flow'))
      return reply(reports.cashFlow ?? cashFlowReport());
    if (url.startsWith('/api/reports/categories'))
      return reply(
        reports.categories ??
          categoryReport(new URL(url, 'http://x').searchParams.get('type') as any),
      );
    if (url.endsWith('/splits') && ['PUT', 'DELETE'].includes(method)) {
      const id = decodeURIComponent(url.split('/')[3]);
      const row: any = structuredClone(all().find((t) => t.id === id)!);
      row.splits =
        method === 'DELETE'
          ? []
          : body.splits.map((p: any, i: number) => ({
              id: 100 + i,
              amount: p.amount,
              notes: p.notes,
              date: p.date ?? null,
              category: cat(p.category_id ?? 9),
            }));
      return reply(row);
    }
    if (url.startsWith('/api/transactions/') && method === 'PATCH') {
      const id = decodeURIComponent(url.split('/').pop()!);
      const row: any = structuredClone(all().find((t) => t.id === id)!);
      if (body.notes !== undefined) row.notes = body.notes;
      if (body.name !== undefined) row.name = row.merchant_name = body.name;
      if (body.amount !== undefined)
        row.amount = (body.direction === 'in' ? '-' : '') + body.amount;
      if (body.date !== undefined) {
        row.user_date = body.date;
        row.date = body.date ?? row.provider_date;
      }
      if (body.category_id !== undefined) {
        row.category = body.category_id ? cat(body.category_id) : cat(9);
        row.category_source = body.category_id ? 'user' : 'none';
      }
      return reply(row);
    }
    if (url.startsWith('/api/transactions'))
      return reply({
        // the Transactions page asks to leave investment accounts out unless they are shown
        transactions: structuredClone(
          url.includes('investments=hide')
            ? all().filter(
                (t: any) => t.activity !== 'investment' && t.account_kind !== 'investment',
              )
            : all(),
        ),
        nextCursor: url.includes('cursor=') ? null : 'next',
        ...(url.includes('merchant=') ? { total: 4 } : {}),
      });
    if (url.startsWith('/api/categories') && method === 'GET')
      return reply({
        groups: structuredClone(groupList),
        categories: structuredClone(categoryList),
      });
    if (url.startsWith('/api/categories') || url.startsWith('/api/category-groups'))
      return reply({ ok: true, id: 10 });
    return reply({});
  };
}
