import { Chart, Empty, Range, Trend } from './common.tsx';
import { Figures, Meter } from './HomeParts.tsx';
import { Badge } from './ui/badge.tsx';
import { Card } from './ui/card.tsx';
import { Input } from './ui/input.tsx';
import { Select } from './ui/select.tsx';
import { COLORS, MASK, cash, dateLabel, isPrivate, number, pct, percent } from '../lib/format.ts';
import { cn } from '../lib/cn.ts';
import { ChevronDown, ChevronRight, Download, Info, Search } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import { useApp } from '../state/AppContext.tsx';
import { navigate } from '../state/router.ts';
import { accountPath } from '../lib/routes.ts';

const GROUP_LABEL: Record<string, string> = {
  investment: 'Investments',
  cash: 'Cash',
  credit: 'Credit cards',
  loan: 'Other debts',
};

/** One of the palette colours for an institution, the same every time, so its initial is easy to find again. */
const institutionColor = (name: string) => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
};

export function AccountsTab() {
  const {
    accounts,
    assets,
    byAccount,
    chart,
    collapsed,
    dataset,
    history,
    liabilities,
    net,
    netChange,
    netPercent,
    production,
    search,
    setCollapsed,
    setSearch,
    setSort,
    sort,
    start,
    unknown,
  } = useApp();
  return (
    <>
      <Card className="grid items-center gap-8 p-8 max-[760px]:gap-6 max-[760px]:p-5 min-[1101px]:grid-cols-[340px_minmax(0,1fr)]">
        <div className="grid gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs tracking-[0.04em] text-muted-foreground">
              TOTAL NET WORTH <Info size={13} />
            </div>
            <div className="my-2 font-serif text-[64px] leading-[1.05] tabular-nums max-[760px]:text-[44px]">
              {cash(net)}
            </div>
            <div
              data-testid="net-caption"
              className="flex flex-wrap items-center gap-2.5 text-[11px] text-muted-foreground"
            >
              <span className="inline-flex rounded-full bg-accent px-3 py-1">
                <Trend value={netPercent} amount={netChange} className="text-[13px]" />
              </span>
              <span>change in tracked net worth</span>
            </div>
          </div>
          <div className="grid gap-3">
            <Meter
              fraction={assets + liabilities > 0 ? assets / (assets + liabilities) : 0}
              track="debt"
            />
            <Figures
              items={[
                ['Assets', cash(assets)],
                ['Liabilities', cash(liabilities)],
              ]}
            />
          </div>
          <p className="m-0 text-[11px] leading-[1.7] text-muted-foreground">
            Assets minus debts. Investment balances already include holdings and brokerage cash.
            {unknown > 0 ? ` ${unknown} unknown balances excluded.` : ''}
            {accounts.some((a) => a.currency !== 'USD') ? ' Non-USD balances excluded.' : ''}
          </p>
          <a
            href="/api/export.csv"
            className="inline-flex items-center gap-2 text-[11px] text-positive hover:underline"
          >
            <Download size={14} /> Export account balances
          </a>
        </div>
        <div className="grid min-w-0 gap-3">
          <div className="flex justify-end">
            <Range />
          </div>
          {chart.length > 1 ? (
            <Chart bare />
          ) : (
            <Empty text="Your chart will grow as balance snapshots accumulate." />
          )}
          <div className="flex flex-wrap justify-between gap-2.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-sage" />
              Net worth
            </span>
            <span>
              {chart.length
                ? `${dateLabel(chart[0].date)} – ${dateLabel(chart[chart.length - 1].date)}`
                : 'No history'}{' '}
              · {!production && dataset === 'simulated' ? 'simulated history' : 'recorded balances'}
            </span>
          </div>
        </div>
      </Card>

      <div className="mt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3.5">
          <h2 className="m-0 flex items-center gap-2 font-serif text-[28px] font-normal">
            Your accounts <Badge>{accounts.length}</Badge>
          </h2>
          <div className="flex gap-2">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3.5 top-2.5 text-muted-foreground"
              />
              <Input
                aria-label="Search accounts"
                placeholder="Find an account"
                className="w-44 pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              aria-label="Sort accounts"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="balance">Balance ↓</option>
              <option value="name">Name A–Z</option>
            </Select>
          </div>
        </div>
        <div className="grid items-start gap-5 min-[1101px]:grid-cols-2">
          {['investment', 'cash', 'credit', 'loan'].map((kind) => {
            const list = accounts
              .filter((a) => a.kind === kind)
              .sort((a, b) =>
                sort === 'name'
                  ? a.name.localeCompare(b.name)
                  : (Number(b.balance) || 0) - (Number(a.balance) || 0),
              );
            if (!list.length && kind === 'loan') return null;
            const counted = list.filter((a) => a.included && a.currency === 'USD');
            const total = counted.reduce((s, a) => s + (number(a.balance) || 0), 0);
            const group = history(counted, start, false);
            const change = group.length > 1 ? percent(pct(total, group[0].value)) : '';
            return (
              <Card key={kind} className="gap-0 p-2">
                <button
                  aria-expanded={!collapsed[kind]}
                  className="flex w-full items-center justify-between rounded-2xl px-4 py-4 text-left transition-colors hover:bg-accent/50"
                  onClick={() => setCollapsed({ ...collapsed, [kind]: !collapsed[kind] })}
                >
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {collapsed[kind] ? <ChevronRight size={17} /> : <ChevronDown size={17} />}
                    <strong className="text-xs font-normal uppercase tracking-[0.06em] text-muted-foreground">
                      {GROUP_LABEL[kind]}
                    </strong>
                    <span className="text-[11px]">{list.length}</span>
                  </span>
                  <span className="flex items-baseline gap-3">
                    <small className="text-[11px] text-muted-foreground">{change}</small>
                    <b className="text-[15px] font-medium tabular-nums text-foreground">
                      {cash(total)}
                    </b>
                  </span>
                </button>
                {!collapsed[kind] &&
                  (list.length ? (
                    list.map((a) => {
                      const color = institutionColor(a.institution || a.name);
                      const failing = !!a.last_error && a.last_error !== 'DISCONNECTED';
                      return (
                        <button
                          className={cn(
                            'flex w-full items-center gap-3 rounded-2xl border-t border-border px-4 py-3.5 text-left transition-colors hover:bg-accent first:border-t-0 max-[760px]:gap-2.5 max-[760px]:px-3',
                            !a.included && 'opacity-55',
                          )}
                          key={a.id}
                          onClick={() => navigate(accountPath(a.id))}
                        >
                          <span
                            aria-hidden="true"
                            className="grid size-10 shrink-0 place-items-center rounded-full font-serif text-xl max-[760px]:size-9"
                            style={{
                              background: `color-mix(in srgb, ${color} 18%, transparent)`,
                              color,
                            }}
                          >
                            {(a.institution || a.name).trim().charAt(0).toUpperCase() || '•'}
                          </span>
                          <span className="min-w-[100px] flex-1 max-[760px]:min-w-0">
                            <strong className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-normal">
                              {a.name}
                              {a.mask && (
                                <small className="text-[11px] text-muted-foreground">
                                  …{a.mask}
                                </small>
                              )}
                              {failing && (
                                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning">
                                  Reconnect
                                </span>
                              )}
                            </strong>
                            <span className="mt-1 block text-[11px] text-muted-foreground">
                              {a.institution} ·{' '}
                              {a.source === 'simulated'
                                ? 'Demo'
                                : a.source === 'plaid_sandbox'
                                  ? 'Sandbox'
                                  : a.source === 'plaid_production'
                                    ? 'Connected'
                                    : 'Manual / imported'}
                              {!a.included ? ' · Excluded' : ''}
                            </span>
                          </span>
                          <div className="w-[84px] shrink-0 max-[1150px]:w-[100px] max-[760px]:hidden">
                            <ResponsiveContainer width="100%" height={28}>
                              <LineChart data={(byAccount.get(a.id) || []).slice(-30)}>
                                <Line
                                  dataKey="current_balance"
                                  dot={false}
                                  stroke={kind === 'credit' ? 'var(--clay)' : 'var(--chart-line)'}
                                  strokeWidth={1.5}
                                  isAnimationActive={false}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                          <span className="min-w-[90px] text-right">
                            <strong className="text-[14px] font-medium tabular-nums">
                              {a.currency === 'USD'
                                ? cash(number(a.balance))
                                : isPrivate()
                                  ? `${MASK} ${a.currency}`
                                  : `${a.balance ?? '—'} ${a.currency}`}
                            </strong>
                            <small
                              className={cn(
                                'mt-1 block text-[10px] text-muted-foreground',
                                a.last_error && 'text-warning',
                              )}
                            >
                              {a.last_error === 'DISCONNECTED'
                                ? 'Disconnected'
                                : a.last_error
                                  ? 'Sync needs attention'
                                  : a.source.startsWith('plaid_') &&
                                      Date.now() - Date.parse(a.last_synced) > 36 * 3600000
                                    ? 'Stale · sync needed'
                                    : a.balance_date
                                      ? `As of ${dateLabel(a.balance_date)}`
                                      : 'Balance unavailable'}
                            </small>
                          </span>
                          <ChevronRight
                            size={15}
                            className="shrink-0 text-muted-foreground max-[760px]:hidden"
                          />
                        </button>
                      );
                    })
                  ) : (
                    <p className="m-0 px-4 py-6 text-xs text-muted-foreground">
                      No {kind === 'credit' ? 'credit card' : kind} accounts in this view.
                    </p>
                  ))}
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
