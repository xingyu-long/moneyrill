import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, LayoutGrid } from 'lucide-react';
import { api } from '../api.ts';
import { Chart, Empty, Range } from './common.tsx';
import { Amount } from './TransactionGroups.tsx';
import { Badge } from './ui/badge.tsx';
import { Figures, Meter, Note, SaySentence, Stat, Tile } from './HomeParts.tsx';
import { SpendingTrend } from './SpendingTrend.tsx';
import { TransactionDrawer } from './TransactionDrawer.tsx';
import { Words } from './Words.tsx';
import { Button } from './ui/button.tsx';
import { COLORS, MASK, cash, dateLabel, isPrivate, number, pct, percent } from '../lib/format.ts';
import { todayIso } from '../lib/calendar.ts';
import { visibleWidgets, type WidgetId } from '../lib/homeLayout.ts';
import { DEFAULT_DATE, THIS_MONTH } from '../lib/reportDates.ts';
import { reportUrl } from '../lib/routes.ts';
import { assetsSentence, changePhrase, monthSentence, portfolioSentence } from '../lib/summary.ts';
import { cn } from '../lib/cn.ts';
import { linkClick } from '../state/router.ts';
import { useCategories } from '../state/useCategories.ts';
import { merchantOf } from '../lib/transactions.ts';
import { useApp } from '../state/AppContext.tsx';
import { useReport } from '../state/useReport.ts';
import type { CashFlowReport, Transaction } from '../types.ts';

/** The periods the hero offers (the other pages keep the longer list). */
const HERO_RANGES = ['1M', '3M', '6M', '1Y', 'ALL'] as const;

const KIND_LABEL: Record<string, string> = {
  cash: 'Cash',
  investment: 'Investments',
  credit: 'Credit cards',
  loan: 'Loans',
};

export function HomeTab() {
  const {
    activePeriod,
    assets,
    base,
    chart,
    data,
    homeLayout,
    included,
    investments,
    liabilities,
    net,
    netChange,
    netPercent,
    portfolio,
    portfolioStart,
    positions,
    load,
    setCustomizing,
    setError,
  } = useApp();
  const today = todayIso();
  const monthStart = today.slice(0, 8) + '01';
  // The tile's link opens the Spending report on this month. A row opens its category over the default range
  // (this year) with this month chosen, so the other months stay in view.
  const monthReport = reportUrl({
    date: THIS_MONTH,
    categories: [],
    accounts: [],
    view: 'sub',
    sub: 'Spending',
  });
  // The This month tile means this month's cash flow, not the default range (this year).
  const cashFlowMonth = reportUrl({
    date: THIS_MONTH,
    categories: [],
    accounts: [],
    view: 'sub',
    sub: 'Cash flow',
  });
  const categoryReport = (id: number) =>
    reportUrl({
      date: DEFAULT_DATE,
      categories: [],
      accounts: [],
      view: 'category',
      id,
      type: 'expense',
      via: 'Spending',
      interval: 'month',
      period: monthStart,
    });
  const month = useReport<CashFlowReport>(
    'cash-flow',
    { from: monthStart, to: today, today, interval: 'month' },
    data,
  );
  const [recent, setRecent] = useState<Transaction[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const { categories } = useCategories();
  useEffect(() => {
    let current = true;
    api('/transactions?limit=6')
      .then((r) => current && setRecent(r.transactions))
      .catch(() => current && setRecent([]));
    return () => {
      current = false;
    };
  }, [data]);
  const openTxn = recent?.find((t) => t.id === openId);

  const totals = month.data?.breakdown.totals ?? month.data?.totals;
  const spending = (month.data?.breakdown.expenses ?? []).slice(0, 5);
  const topSpend = Math.max(...spending.map((s) => Number(s.amount)), 0);
  const kinds = ['cash', 'investment', 'credit', 'loan']
    .map((kind) => {
      const list = included.filter((a) => a.kind === kind);
      return {
        kind,
        count: list.length,
        total: list.reduce((s, a) => s + (number(a.balance) || 0), 0),
      };
    })
    .filter((k) => k.count > 0);
  const problems = base.filter((a) => a.last_error).length;
  const top = positions.filter((p) => (p.value ?? 0) > 0).slice(0, 3);

  const shown = visibleWidgets(homeLayout);
  const netText = cash(net);
  const dot = netText.lastIndexOf('.');
  const [netWhole, netCents] =
    dot < 0 ? [netText, ''] : [netText.slice(0, dot), netText.slice(dot)];
  const monthIncome = Number(totals?.income ?? 0);
  const monthExpenses = Number(totals?.expenses ?? 0);
  const tint = (color: string) => `color-mix(in srgb, ${color} 16%, transparent)`;

  // Net worth is always the hero, above the cards: it is not one of the cards that can be hidden or moved. It runs
  // edge to edge (the negative margins undo the page's side padding) and the cards after it overlap its chart.
  const netWorthHero = (
    <section
      key="net-worth"
      className="relative z-0 col-span-full -mx-[38px] mb-[-44px] grid justify-items-center gap-5 text-center max-[1150px]:-mx-[25px] max-[760px]:-mx-4 min-[1600px]:-mx-[55px]"
    >
      <h2 className="sr-only">Net worth</h2>
      <div
        className={cn(
          'font-serif leading-none tracking-[-0.02em] tabular-nums',
          // six masked dots at full size would be a wall of bullets
          netText === MASK
            ? 'text-[72px] max-[760px]:text-[44px]'
            : 'text-[112px] max-[760px]:text-[64px]',
        )}
      >
        {netWhole}
        <span className="text-muted-foreground">{netCents}</span>
      </div>
      {netChange === null ? (
        <span className="text-[13px] text-muted-foreground">Not enough history yet</span>
      ) : (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium',
            netChange < 0 ? 'bg-warning/15 text-warning' : 'bg-accent text-positive',
          )}
        >
          {netChange < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
          {isPrivate()
            ? percent(netPercent)
            : `${netChange < 0 ? '−' : '+'}${cash(Math.abs(netChange))}`}{' '}
          {changePhrase(activePeriod)}
        </span>
      )}
      <Range options={HERO_RANGES} soft />
      <div className="w-full">
        {chart.length > 1 ? (
          <Chart bare />
        ) : (
          <Empty text="Your chart will grow as balance snapshots accumulate." />
        )}
      </div>
    </section>
  );

  const tiles: Record<WidgetId, ReactNode> = {
    spending: <SpendingTrend key="spending" />,
    month: (
      <Tile
        key="month"
        title="This month"
        to="Reports"
        href={cashFlowMonth}
        label="Cash flow"
        className="min-[1101px]:col-span-4"
      >
        {totals ? (
          <>
            <SaySentence>
              <Words
                sentence={monthSentence({
                  income: monthIncome,
                  expenses: monthExpenses,
                  rate: totals.savings_rate,
                })}
              />
            </SaySentence>
            <Meter fraction={(totals.savings_rate ?? 0) / 100} />
            <Figures
              items={[
                ['In', cash(monthIncome)],
                ['Out', cash(monthExpenses)],
                ['Kept', cash(Number(totals.net))],
              ]}
            />
          </>
        ) : (
          <Note>Loading…</Note>
        )}
      </Tile>
    ),
    assets: (
      <Tile key="assets" title="Assets and debt" className="min-[1101px]:col-span-4">
        <SaySentence>
          <Words sentence={assetsSentence({ assets, liabilities })} />
        </SaySentence>
        <Meter
          fraction={assets + liabilities > 0 ? assets / (assets + liabilities) : 0}
          track="debt"
        />
        <Figures
          items={[
            ['You own', cash(assets)],
            ['You owe', cash(liabilities)],
          ]}
        />
        <Note>
          {included.length} account{included.length === 1 ? '' : 's'} counted
          {problems > 0 && ` · ${problems} need${problems === 1 ? 's' : ''} attention`}
        </Note>
      </Tile>
    ),
    accounts: (
      <Tile key="accounts" title="Accounts" to="Accounts" className="min-[1101px]:col-span-4">
        {kinds.length === 0 && <Note>No accounts yet.</Note>}
        {kinds.map((k) => (
          <Stat key={k.kind} label={`${KIND_LABEL[k.kind]} · ${k.count}`} value={cash(k.total)} />
        ))}
      </Tile>
    ),
    investments: (
      <Tile
        key="investments"
        title="Investments"
        to="Investments"
        className="min-[1101px]:col-span-4"
      >
        {investments.length === 0 ? (
          <Note>No investment accounts yet.</Note>
        ) : (
          <>
            <SaySentence>
              <Words
                sentence={portfolioSentence({
                  change: pct(portfolio, portfolioStart),
                  period: activePeriod,
                })}
              />
            </SaySentence>
            <Figures
              items={[
                ['Total', cash(portfolio)],
                ...top.map((p): [string, string] => [p.symbol || p.name, cash(p.value)]),
              ]}
            />
          </>
        )}
      </Tile>
    ),
    categories: (
      <Tile
        key="categories"
        title="Where it went this month"
        to="Reports"
        label="Spending"
        href={monthReport}
        className="min-[641px]:col-span-2 min-[1101px]:col-span-5"
      >
        {month.loading && !month.data ? (
          <Note>Loading…</Note>
        ) : spending.length === 0 ? (
          <Note>No spending recorded this month yet.</Note>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {spending.map((s, i) => (
              <li key={s.category.id}>
                <a
                  href={categoryReport(s.category.id)}
                  onClick={(e) => linkClick(e, categoryReport(s.category.id))}
                  title={`Show ${s.category.name} this month`}
                  className="-mx-2 grid grid-cols-[38px_1fr_auto] items-center gap-x-3 rounded-2xl px-2 py-1.5 text-[13px] text-inherit no-underline hover:bg-accent"
                >
                  <span
                    className="grid size-[38px] place-items-center rounded-full text-[17px]"
                    style={{ background: tint(COLORS[i % COLORS.length]) }}
                  >
                    {s.category.emoji}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{s.category.name}</span>
                    <span className="mt-1.5 block h-[5px] overflow-hidden rounded-full bg-muted">
                      <i
                        className="block h-full rounded-full"
                        style={{
                          width: `${topSpend > 0 ? (Number(s.amount) / topSpend) * 100 : 0}%`,
                          background: COLORS[i % COLORS.length],
                        }}
                      />
                    </span>
                  </span>
                  <span className="tabular-nums">
                    {cash(Number(s.amount))}{' '}
                    <small className="ml-1 text-muted-foreground">{s.share}%</small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Tile>
    ),
    transactions: (
      <Tile
        key="transactions"
        title="Recent transactions"
        to="Transactions"
        className="min-[641px]:col-span-2 min-[1101px]:col-span-7"
      >
        {recent === null ? (
          <Note>Loading…</Note>
        ) : recent.length === 0 ? (
          <Note>No transactions yet.</Note>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {recent.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  title={`Show ${merchantOf(t)} details`}
                  onClick={() => setOpenId(t.id)}
                  className="-mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-2xl px-2 py-1.5 text-left text-[13px] tabular-nums text-inherit hover:bg-accent"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-[38px] shrink-0 place-items-center rounded-full bg-muted text-[17px]"
                  >
                    {t.category?.emoji ?? '•'}
                  </span>
                  <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate">{merchantOf(t)}</span>
                      {t.pending && <Badge className="bg-warning/15 text-warning">Pending</Badge>}
                    </span>
                    <small className="truncate text-[11px] text-muted-foreground">
                      {dateLabel(t.date)}
                      {t.category ? ` · ${t.category.name}` : ''}
                    </small>
                  </span>
                  <span className="shrink-0">
                    <Amount value={t.amount} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Tile>
    ),
  };

  return (
    <div className="home-grid grid grid-flow-dense grid-cols-1 gap-4 min-[641px]:grid-cols-2 min-[1101px]:grid-cols-12">
      {netWorthHero}
      {shown.map((id) => tiles[id])}
      {shown.length === 0 && (
        <div className="col-span-full grid justify-items-center gap-3 rounded-[26px] border border-dashed border-border px-5 py-11 text-center text-xs text-muted-foreground">
          Every module is hidden.
          <Button variant="outline" onClick={() => setCustomizing(true)}>
            <LayoutGrid size={15} />
            Customize
          </Button>
        </div>
      )}
      {openTxn && (
        <TransactionDrawer
          txn={openTxn}
          categories={categories}
          onClose={() => setOpenId(null)}
          onSaved={(t) => {
            setRecent((rs) => rs?.map((r) => (r.id === t.id ? t : r)) ?? rs);
            void load();
          }}
          onDeleted={(id) => {
            setRecent((rs) => rs?.filter((r) => r.id !== id) ?? rs);
            void load();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}
