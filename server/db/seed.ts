import { config } from '../lib/config.ts';
import { pool } from './pool.ts';
import { recompute } from './queries.ts';
export async function seed() {
  if (config.production) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(931875)');
    if ((await client.query("SELECT 1 FROM settings WHERE key='seeded'")).rowCount) {
      await client.query('COMMIT');
      return;
    }
    const accounts = [
      ['demo-broker', 'Individual brokerage', 'Sandbox Investments', 'investment', '1842', 182400],
      ['demo-ira', 'Roth IRA', 'Sandbox Investments', 'investment', '5208', 86420],
      ['demo-checking', 'Everyday checking', 'Sandbox Bank', 'cash', '1038', 12840],
      ['demo-savings', 'High-yield savings', 'Sandbox Bank', 'cash', '6021', 24600],
      ['demo-card', 'Travel rewards', 'Sandbox Card', 'credit', '4026', 2185.4],
      ['demo-card2', 'Everyday card', 'Sandbox Card', 'credit', '7204', 684.2],
    ];
    const securities = [
      ['vti', 'VTI', 'Total US stock market', 'US equities', 286.42],
      ['vxus', 'VXUS', 'International stock market', 'International equities', 63.82],
      ['bnd', 'BND', 'US bond market', 'Bonds', 73.14],
      ['aapl', 'AAPL', 'Apple Inc.', 'US equities', 224.7],
      ['msft', 'MSFT', 'Microsoft Corp.', 'US equities', 432.15],
      ['cash', 'CASH', 'Brokerage cash', 'Cash', 1],
    ];
    for (const a of accounts)
      await client.query(
        `INSERT INTO accounts(id,name,institution,kind,mask,source,last_synced) VALUES($1,$2,$3,$4,$5,'simulated',now())`,
        a.slice(0, 5),
      );
    for (const s of securities)
      await client.query(
        'INSERT INTO securities(id,symbol,name,asset_class) VALUES($1,$2,$3,$4)',
        s.slice(0, 4),
      );
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    const n = 550;
    const balanceRows: any[] = [],
      holdingRows: any[] = [],
      benchRows: any[] = [];
    for (let i = 0; i <= n; i++) {
      const date = new Date(today);
      date.setUTCDate(today.getUTCDate() - n + i);
      const day = date.toISOString().slice(0, 10);
      const t = i / n;
      for (let k = 0; k < accounts.length; k++) {
        const a = accounts[k];
        const end = Number(a[5]);
        const factor =
          a[3] === 'investment'
            ? (0.78 + 0.22 * t + 0.021 * Math.sin(i / 18) + 0.008 * Math.cos(i / 7)) /
              (1 + 0.021 * Math.sin(n / 18) + 0.008 * Math.cos(n / 7))
            : a[3] === 'cash'
              ? (0.83 + 0.17 * t + 0.035 * Math.sin(i / 27 + k)) /
                (1 + 0.035 * Math.sin(n / 27 + k))
              : (0.7 + (0.6 * ((i + k * 8) % 30)) / 30) / (0.7 + (0.6 * ((n + k * 8) % 30)) / 30);
        const value = end * factor;
        balanceRows.push({
          account_id: a[0],
          date: day,
          current_balance: value.toFixed(2),
          provenance: 'simulated',
        });
        if (a[3] === 'investment') {
          const weights =
            k === 0 ? [0.43, 0.18, 0.12, 0.1, 0.12, 0.05] : [0.54, 0.24, 0.17, 0, 0, 0.05];
          securities.forEach((s, j) => {
            if (!weights[j]) return;
            const price = Number(s[4]) * (j === 5 ? 1 : factor);
            const v = value * weights[j];
            holdingRows.push({
              account_id: a[0],
              security_id: s[0],
              date: day,
              quantity: (v / price).toFixed(8),
              price: price.toFixed(6),
              value: v.toFixed(2),
              cost_basis: (j === 5 ? v : v / (1 + 0.15 * t)).toFixed(2),
              provenance: 'simulated',
            });
          });
        }
      }
      for (const [j, symbol] of ['US large cap', 'US total market', 'US bonds'].entries())
        benchRows.push({
          symbol,
          date: day,
          level: (
            100 *
            (1 +
              (j === 2 ? 0.04 : 0.18) * t +
              (j === 2 ? 0.005 : 0.023) * Math.sin(i / (20 + j * 5)))
          ).toFixed(8),
          provenance: 'simulated',
        });
    }
    await client.query(
      `INSERT INTO balance_snapshots(account_id,date,current_balance,provenance) SELECT account_id,date,current_balance,provenance FROM jsonb_to_recordset($1::jsonb) AS x(account_id text,date date,current_balance numeric,provenance text)`,
      [JSON.stringify(balanceRows)],
    );
    await client.query(
      `INSERT INTO holding_snapshots SELECT account_id,security_id,date,quantity,price,value,cost_basis,provenance FROM jsonb_to_recordset($1::jsonb) AS x(account_id text,security_id text,date date,quantity numeric,price numeric,value numeric,cost_basis numeric,provenance text)`,
      [JSON.stringify(holdingRows)],
    );
    await client.query(
      `INSERT INTO benchmark_observations SELECT symbol,date,level,provenance FROM jsonb_to_recordset($1::jsonb) AS x(symbol text,date date,level numeric,provenance text)`,
      [JSON.stringify(benchRows)],
    );
    await client.query(`INSERT INTO settings VALUES('seeded','true')`);
    await recompute(client);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Fake, deterministic transactions on the demo accounts (staging only), once. */
export async function seedTransactions() {
  if (config.production) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(931875)');
    const done = await client.query("SELECT 1 FROM settings WHERE key='seeded_transactions'");
    const demo = await client.query("SELECT 1 FROM accounts WHERE id='demo-checking'");
    if (done.rowCount || !demo.rowCount) {
      await client.query('COMMIT');
      return;
    }
    const rows = demoTransactions(new Date());
    await client.query(
      `INSERT INTO transactions(id,account_id,source,date,amount,name,merchant_name,pending,provider_category,provider_category_detailed,auto_category_key,provenance)
       SELECT id,account_id,'plaid',date,amount,name,merchant,pending,pc,pd,key,'simulated'
       FROM jsonb_to_recordset($1::jsonb) AS x(id text,account_id text,date date,amount numeric,name text,merchant text,pending boolean,pc text,pd text,key text)`,
      [JSON.stringify(rows)],
    );
    await client.query(`INSERT INTO settings VALUES('seeded_transactions','true')`);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Fake, deterministic history before the 90-day demo rows (staging only), once, so the Reports tab has a trend to show.
 * Kept apart from seedTransactions so a database that already has the 90-day rows still gets it.
 */
export async function seedReportHistory() {
  if (config.production) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(931875)');
    const done = await client.query("SELECT 1 FROM settings WHERE key='seeded_report_history'");
    const demo = await client.query("SELECT 1 FROM accounts WHERE id='demo-checking'");
    if (done.rowCount || !demo.rowCount) {
      await client.query('COMMIT');
      return;
    }
    const { rows, splits } = demoHistory(new Date());
    await client.query(
      `INSERT INTO transactions(id,account_id,source,date,amount,name,merchant_name,pending,provider_category,provider_category_detailed,auto_category_key,provenance)
       SELECT id,account_id,'plaid',date,amount,name,merchant,false,pc,pd,key,'simulated'
       FROM jsonb_to_recordset($1::jsonb) AS x(id text,account_id text,date date,amount numeric,name text,merchant text,pc text,pd text,key text)`,
      [JSON.stringify(rows)],
    );
    await client.query(
      `INSERT INTO transaction_splits(transaction_id,amount,category_id,notes,sort_order,date)
       SELECT x.txn,x.amount,c.id,x.notes,x.ord,x.date
       FROM jsonb_to_recordset($1::jsonb) AS x(txn text,amount numeric,key text,notes text,ord int,date date)
       JOIN categories c ON c.key=x.key`,
      [JSON.stringify(splits)],
    );
    await client.query(`INSERT INTO settings VALUES('seeded_report_history','true')`);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * About 22 months of made-up monthly activity ending four months before today (the 90-day demo rows follow it).
 * Provider categories map to the intended category (so a start-up remap changes nothing). Amounts follow the
 * provider sign: positive = money out. Includes card payments and transfers (never income or spending),
 * refunds, an uncategorized deposit and one purchase split across two months.
 */
export function demoHistory(today: Date) {
  const rows: any[] = [];
  const splits: any[] = [];
  let n = 0;
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const money = (v: number) => Math.round(v * 100) / 100;
  const pad = (v: number) => String(v).padStart(2, '0');
  for (let i = 25; i >= 4; i--) {
    const total = today.getUTCFullYear() * 12 + today.getUTCMonth() - i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
    const add = (
      day: number,
      account: string,
      amount: number,
      name: string,
      merchant: string | null,
      key: string,
      pc: string | null,
      pd: string | null,
    ) => {
      const id = `demo-hist-${String(++n).padStart(4, '0')}`;
      rows.push({
        id,
        account_id: account,
        date: `${y}-${pad(m)}-${pad(day)}`,
        amount,
        name,
        merchant,
        pc,
        pd,
        key,
      });
      return id;
    };
    const pay = 3000 + (25 - i) * 10;
    for (const d of [1, 15])
      add(
        d,
        'demo-checking',
        -pay,
        'ACME PAYROLL',
        'Acme Corp',
        'paychecks',
        'INCOME',
        'INCOME_WAGES',
      );
    add(
      3,
      'demo-checking',
      i > 12 ? 1750 : 1850,
      'ZELLE PAYMENT TO LANDLORD',
      null,
      'rent',
      'RENT_AND_UTILITIES',
      'RENT_AND_UTILITIES_RENT',
    );
    add(
      9,
      'demo-checking',
      money(80 + rnd() * 40),
      'CITY POWER AND LIGHT',
      'City Power',
      'utilities',
      'RENT_AND_UTILITIES',
      'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',
    );
    add(
      10,
      'demo-savings',
      -money(0.2 + rnd()),
      'Monthly Interest Paid',
      null,
      'interest',
      'INCOME',
      'INCOME_INTEREST_EARNED',
    );
    for (let g = 0; g < 4; g++)
      add(
        2 + g * 7,
        'demo-card',
        money(55 + rnd() * 90),
        'WHOLE MARKET #' + (100 + g),
        'Whole Market',
        'groceries',
        'FOOD_AND_DRINK',
        'FOOD_AND_DRINK_GROCERIES',
      );
    for (let r = 0; r < 4; r++)
      add(
        3 + r * 6,
        'demo-card',
        money(12 + rnd() * 48),
        'THE CORNER BISTRO',
        'The Corner Bistro',
        'restaurants',
        'FOOD_AND_DRINK',
        'FOOD_AND_DRINK_RESTAURANT',
      );
    for (let c = 0; c < 6; c++)
      add(
        1 + c * 4,
        'demo-card2',
        money(3.5 + rnd() * 4),
        'MORNING ROAST COFFEE',
        'Morning Roast',
        'coffee_shops',
        'FOOD_AND_DRINK',
        'FOOD_AND_DRINK_COFFEE',
      );
    for (let s = 0; s < 2; s++)
      add(
        5 + s * 11,
        'demo-card2',
        money(15 + rnd() * 120),
        'ONLINE MARKETPLACE',
        'Online Marketplace',
        'shopping',
        'GENERAL_MERCHANDISE',
        'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES',
      );
    add(
      9,
      'demo-card2',
      12.99,
      'STREAMING SERVICE',
      'Streamflix',
      'entertainment',
      'ENTERTAINMENT',
      'ENTERTAINMENT_TV_AND_MOVIES',
    );
    add(
      6,
      'demo-card2',
      47,
      'HEARTHSIDE INSURANCE',
      'Hearthside Insurance',
      'insurance',
      'GENERAL_SERVICES',
      'GENERAL_SERVICES_INSURANCE',
    );
    // Transfers: neither income nor spending.
    add(
      12,
      'demo-checking',
      640,
      'CARD AUTOPAY PAYMENT',
      null,
      'credit_card_payment',
      'LOAN_PAYMENTS',
      'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
    );
    add(
      12,
      'demo-card',
      -640,
      'AUTOMATIC PAYMENT - THANK',
      null,
      'credit_card_payment',
      'INCOME',
      'INCOME_SALARY',
    );
    add(
      17,
      'demo-checking',
      500,
      'TRANSFER TO SAVINGS',
      null,
      'transfer',
      'TRANSFER_OUT',
      'TRANSFER_OUT_SAVINGS',
    );
    add(
      17,
      'demo-savings',
      -500,
      'TRANSFER FROM CHECKING',
      null,
      'transfer',
      'TRANSFER_IN',
      'TRANSFER_IN_SAVINGS',
    );
    if (i % 3 === 0)
      add(
        20,
        'demo-checking',
        -2500,
        'STOCK VEST PROCEEDS',
        null,
        'other_income',
        'INCOME',
        'INCOME_OTHER_INCOME',
      );
    if (i % 3 === 1)
      add(
        4,
        'demo-card',
        -24.5,
        'RETURN - SHOE STORE',
        'Shoe Store',
        'shopping',
        'GENERAL_MERCHANDISE',
        'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES',
      );
    if (i % 4 === 0)
      add(
        22,
        'demo-card',
        180,
        'FAMILY CLINIC',
        'Family Clinic',
        'medical',
        'MEDICAL',
        'MEDICAL_PRIMARY_CARE',
      );
    if (i % 6 === 0)
      add(24, 'demo-card', 640, 'AIRLINE TICKETS', 'Airline', 'travel', 'TRAVEL', 'TRAVEL_FLIGHTS');
    if (i === 7) add(26, 'demo-checking', -75, 'MOBILE DEPOSIT', null, 'uncategorized', null, null);
    if (i === 9) {
      const id = add(
        27,
        'demo-card',
        400,
        'BIG BOX STORE',
        'Big Box',
        'shopping',
        'GENERAL_MERCHANDISE',
        'GENERAL_MERCHANDISE_SUPERSTORES',
      );
      splits.push(
        { txn: id, amount: 250, key: 'groceries', notes: 'food', ord: 0, date: null },
        {
          txn: id,
          amount: 150,
          key: 'shopping',
          notes: 'bills it in the next month',
          ord: 1,
          date: `${next}-02`,
        },
      );
    }
  }
  return { rows, splits };
}

/** About 120 made-up rows over the last 90 days. Amounts follow the provider sign: positive = money out. */
export function demoTransactions(today: Date) {
  const out: any[] = [];
  const day = (back: number) => {
    const d = new Date(today);
    d.setUTCHours(12, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - back);
    return d.toISOString().slice(0, 10);
  };
  let n = 0;
  const add = (
    back: number,
    account: string,
    amount: number,
    name: string,
    merchant: string | null,
    key: string,
    pc: string,
    pd: string,
    pending = false,
  ) =>
    out.push({
      id: `demo-txn-${String(++n).padStart(3, '0')}`,
      account_id: account,
      date: day(back),
      amount,
      name,
      merchant,
      pending,
      pc,
      pd,
      key,
    });
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let m = 0; m < 3; m++) {
    const o = m * 30;
    add(
      o + 28,
      'demo-checking',
      -3200,
      'ACME PAYROLL',
      'Acme Corp',
      'paychecks',
      'INCOME',
      'INCOME_WAGES',
    );
    add(
      o + 14,
      'demo-checking',
      -3200,
      'ACME PAYROLL',
      'Acme Corp',
      'paychecks',
      'INCOME',
      'INCOME_WAGES',
    );
    add(
      o + 26,
      'demo-checking',
      1850,
      'ZELLE PAYMENT TO LANDLORD',
      null,
      'rent',
      'RENT_AND_UTILITIES',
      'RENT_AND_UTILITIES_RENT',
    );
    add(
      o + 20,
      'demo-checking',
      96.4,
      'CITY POWER AND LIGHT',
      'City Power',
      'utilities',
      'RENT_AND_UTILITIES',
      'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',
    );
    add(
      o + 12,
      'demo-checking',
      640,
      'CARD AUTOPAY PAYMENT',
      null,
      'credit_card_payment',
      'LOAN_PAYMENTS',
      'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
    );
    add(
      o + 12,
      'demo-card',
      -640,
      'AUTOMATIC PAYMENT - THANK',
      null,
      'credit_card_payment',
      'INCOME',
      'INCOME_SALARY',
    );
    add(
      o + 10,
      'demo-savings',
      -0.34,
      'Monthly Interest Paid',
      null,
      'interest',
      'INCOME',
      'INCOME_INTEREST_EARNED',
    );
    add(
      o + 9,
      'demo-card2',
      12.99,
      'STREAMING SERVICE',
      'Streamflix',
      'entertainment',
      'ENTERTAINMENT',
      'ENTERTAINMENT_TV_AND_MOVIES',
    );
    add(
      o + 6,
      'demo-card2',
      47,
      'HEARTHSIDE INSURANCE',
      'Hearthside Insurance',
      'insurance',
      'GENERAL_SERVICES',
      'GENERAL_SERVICES_INSURANCE',
    );
    for (let g = 0; g < 4; g++)
      add(
        o + g * 7 + 2,
        'demo-card',
        Math.round((55 + rnd() * 90) * 100) / 100,
        'WHOLE MARKET #' + (100 + g),
        'Whole Market',
        'groceries',
        'FOOD_AND_DRINK',
        'FOOD_AND_DRINK_GROCERIES',
      );
    for (let r = 0; r < 4; r++)
      add(
        o + r * 6 + 3,
        'demo-card',
        Math.round((12 + rnd() * 48) * 100) / 100,
        'THE CORNER BISTRO',
        'The Corner Bistro',
        'restaurants',
        'FOOD_AND_DRINK',
        'FOOD_AND_DRINK_RESTAURANT',
      );
    for (let c = 0; c < 12; c++)
      add(
        o + c * 2 + 1,
        'demo-card2',
        Math.round((3.5 + rnd() * 4) * 100) / 100,
        'MORNING ROAST COFFEE',
        'Morning Roast',
        'coffee_shops',
        'FOOD_AND_DRINK',
        'FOOD_AND_DRINK_COFFEE',
      );
    for (let s = 0; s < 2; s++)
      add(
        o + s * 11 + 5,
        'demo-card2',
        Math.round((15 + rnd() * 120) * 100) / 100,
        'ONLINE MARKETPLACE',
        'Online Marketplace',
        'shopping',
        'GENERAL_MERCHANDISE',
        'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES',
      );
    add(
      o + 8,
      'demo-card',
      38.2,
      'FUEL STATION 22',
      'Fuel Station',
      'gas_ev',
      'TRANSPORTATION',
      'TRANSPORTATION_GAS',
    );
    add(
      o + 4,
      'demo-card',
      -24.5,
      'RETURN - SHOE STORE',
      'Shoe Store',
      'shopping',
      'GENERAL_MERCHANDISE',
      'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES',
    );
    add(
      o + 17,
      'demo-checking',
      500,
      'TRANSFER TO SAVINGS',
      null,
      'transfer',
      'TRANSFER_OUT',
      'TRANSFER_OUT_SAVINGS',
    );
    add(
      o + 17,
      'demo-savings',
      -500,
      'TRANSFER FROM CHECKING',
      null,
      'transfer',
      'TRANSFER_IN',
      'TRANSFER_IN_SAVINGS',
    );
  }
  add(
    0,
    'demo-card',
    64.1,
    'WHOLE MARKET #104',
    'Whole Market',
    'groceries',
    'FOOD_AND_DRINK',
    'FOOD_AND_DRINK_GROCERIES',
    true,
  );
  add(
    0,
    'demo-card2',
    21.75,
    'THE CORNER BISTRO',
    'The Corner Bistro',
    'restaurants',
    'FOOD_AND_DRINK',
    'FOOD_AND_DRINK_RESTAURANT',
    true,
  );
  return out;
}

/** Fake, deterministic brokerage activity on the demo investment accounts (staging only), once. */
export async function seedInvestmentActivity() {
  if (config.production) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(931875)');
    const done = await client.query(
      "SELECT 1 FROM settings WHERE key='seeded_investment_activity'",
    );
    const demo = await client.query("SELECT 1 FROM accounts WHERE id='demo-broker'");
    if (done.rowCount || !demo.rowCount) {
      await client.query('COMMIT');
      return;
    }
    await client.query(
      `INSERT INTO investment_transactions(id,account_id,provider_id,security_id,date,name,type,subtype,amount,quantity,price,fees,provenance)
       SELECT id,account_id,id,security_id,date,name,type,subtype,amount,quantity,price,fees,'simulated'
       FROM jsonb_to_recordset($1::jsonb) AS x(id text,account_id text,security_id text,date date,name text,type text,subtype text,amount numeric,quantity numeric,price numeric,fees numeric)`,
      [JSON.stringify(demoActivity(new Date()))],
    );
    await client.query(`INSERT INTO settings VALUES('seeded_investment_activity','true')`);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * About three months of made-up brokerage activity: monthly deposits and buys, quarterly dividends, a sale, a fee and
 * one share transfer between the two accounts (amount 0). Plaid's sign: positive = cash out of the account.
 */
export function demoActivity(today: Date) {
  const day = (back: number) =>
    new Date(today.getTime() - back * 86400000).toISOString().slice(0, 10);
  const rows: {
    id: string;
    account_id: string;
    security_id: string | null;
    date: string;
    name: string;
    type: string;
    subtype: string;
    amount: number;
    quantity: number;
    price: number | null;
    fees: number | null;
  }[] = [];
  const add = (r: Omit<(typeof rows)[number], 'id'>) =>
    rows.push({ id: `demo-activity:${rows.length + 1}`, ...r });
  for (const back of [80, 50, 20]) {
    add({
      account_id: 'demo-broker',
      security_id: null,
      date: day(back),
      name: 'ACH DEPOSIT',
      type: 'cash',
      subtype: 'deposit',
      amount: -1500,
      quantity: 0,
      price: null,
      fees: null,
    });
    add({
      account_id: 'demo-broker',
      security_id: 'vti',
      date: day(back - 1),
      name: 'BUY VTI',
      type: 'buy',
      subtype: 'buy',
      amount: 1432.1,
      quantity: 5,
      price: 286.42,
      fees: 0,
    });
    add({
      account_id: 'demo-ira',
      security_id: 'bnd',
      date: day(back - 2),
      name: 'BUY BND',
      type: 'buy',
      subtype: 'buy',
      amount: 365.7,
      quantity: 5,
      price: 73.14,
      fees: 0,
    });
  }
  add({
    account_id: 'demo-broker',
    security_id: 'vti',
    date: day(35),
    name: 'VTI DIVIDEND',
    type: 'cash',
    subtype: 'dividend',
    amount: -61.2,
    quantity: 0,
    price: null,
    fees: null,
  });
  add({
    account_id: 'demo-ira',
    security_id: 'bnd',
    date: day(33),
    name: 'BND DIVIDEND',
    type: 'cash',
    subtype: 'dividend',
    amount: -18.45,
    quantity: 0,
    price: null,
    fees: null,
  });
  add({
    account_id: 'demo-broker',
    security_id: 'msft',
    date: day(27),
    name: 'SELL MSFT',
    type: 'sell',
    subtype: 'sell',
    amount: -864.3,
    quantity: -2,
    price: 432.15,
    fees: 0,
  });
  add({
    account_id: 'demo-broker',
    security_id: null,
    date: day(15),
    name: 'ADVISORY FEE',
    type: 'fee',
    subtype: 'account fee',
    amount: 4.5,
    quantity: 0,
    price: null,
    fees: 4.5,
  });
  add({
    account_id: 'demo-broker',
    security_id: 'aapl',
    date: day(9),
    name: 'JOURNAL TO ROTH IRA',
    type: 'transfer',
    subtype: 'transfer',
    amount: 0,
    quantity: -3,
    price: null,
    fees: null,
  });
  add({
    account_id: 'demo-ira',
    security_id: 'aapl',
    date: day(9),
    name: 'JOURNAL FROM INDIVIDUAL',
    type: 'transfer',
    subtype: 'transfer',
    amount: 0,
    quantity: 3,
    price: null,
    fees: null,
  });
  return rows;
}
