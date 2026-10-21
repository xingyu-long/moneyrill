import { Plus } from 'lucide-react';
import { api } from '../api.ts';
import { useEffect, useState } from 'react';
import { todayIso } from '../lib/calendar.ts';
import { pct } from '../lib/format.ts';
import { resolveSpec } from '../lib/reportDates.ts';
import { parseReport, type ReportRoute } from '../lib/routes.ts';
import {
  accountsSentence,
  homeSentence,
  investmentsSentence,
  pageTitle,
  reportLead,
  reportsSentence,
  settingsSentence,
  transactionsSentence,
} from '../lib/summary.ts';
import { Button } from './ui/button.tsx';
import { useApp } from '../state/AppContext.tsx';
import { useLocation } from '../state/router.ts';
import { useReport } from '../state/useReport.ts';
import type { CashFlowReport } from '../types.ts';
import { scopeParams } from './reports/scope.ts';
import { Words } from './Words.tsx';

/** This month's transactions and what they came to; nothing is shown until both have loaded. */
function TransactionsSentence() {
  const { data } = useApp();
  const today = todayIso();
  const monthStart = today.slice(0, 8) + '01';
  const month = useReport<CashFlowReport>(
    'cash-flow',
    { from: monthStart, to: today, today, interval: 'month' },
    data,
  );
  const [counted, setCounted] = useState<{ count: number; more: boolean; pending: number } | null>(
    null,
  );
  useEffect(() => {
    let current = true;
    api(`/transactions?from=${monthStart}&to=${today}&limit=500`)
      .then((r) => {
        if (!current) return;
        // an excluded account never counts, here as in the reports
        // brokerage activity is not a transaction here: the count is the same as before it existed
        const rows = r.transactions.filter(
          (t: { account_included: boolean; activity: string }) =>
            t.account_included && t.activity !== 'investment',
        );
        setCounted({
          count: rows.length,
          more: !!r.nextCursor,
          pending: rows.filter((t: { pending: boolean }) => t.pending).length,
        });
      })
      .catch(() => current && setCounted(null));
    return () => {
      current = false;
    };
  }, [data, monthStart, today]);
  const totals = month.data?.breakdown.totals ?? month.data?.totals;
  if (!counted || !totals) return null;
  return (
    <Words
      sentence={transactionsSentence({
        ...counted,
        out: Number(totals.expenses),
        inn: Number(totals.income),
      })}
    />
  );
}

/** On the Accounts page only: the same Plaid Link as Settings → Connections. Off without Plaid keys. */
function AddAccountButton() {
  const { action, busy, data, setLink } = useApp();
  return (
    <Button
      disabled={busy || !data.hasPlaidKeys}
      onClick={() =>
        action(async () => {
          setLink(await api('/link', {}));
        }, 'Account connection ready')
      }
    >
      <Plus size={16} />
      Add an account
    </Button>
  );
}

/** The chosen report range in words. Only for Cash flow, Spending and Income: a category page has its own figures. */
function ReportsSentence({ route }: { route: Extract<ReportRoute, { view: 'sub' }> }) {
  const { data } = useApp();
  const today = todayIso();
  const scope = {
    ...resolveSpec(route.date, today),
    today,
    categories: route.categories,
    accounts: route.accounts,
  };
  const report = useReport<CashFlowReport>(
    'cash-flow',
    { ...scopeParams(scope), interval: 'month' },
    data,
  );
  if (!report.data) return null;
  const t = report.data.totals;
  return (
    <Words
      sentence={reportsSentence({
        lead: reportLead(route.date),
        income: Number(t.income),
        spending: Number(t.expenses),
        rate: t.savings_rate,
        filtered: route.categories.length + route.accounts.length > 0,
      })}
    />
  );
}

/** The sentence for pages whose figures the app already holds. */
function AppSentence() {
  const { activePeriod, base, data, investmentAccounts, portfolio, portfolioStart, returns, tab } =
    useApp();
  if (tab === 'Home') return <Words sentence={homeSentence()} />;
  if (tab === 'Accounts') {
    const synced = base
      .filter((a) => a.source !== 'manual')
      .map((a) => Date.parse(a.last_synced))
      .filter(Number.isFinite);
    return (
      <Words
        sentence={accountsSentence({
          count: base.length,
          problems: base.filter((a) => a.last_error).length,
          syncedHoursAgo: synced.length ? (Date.now() - Math.min(...synced)) / 3_600_000 : null,
        })}
      />
    );
  }
  if (tab === 'Investments') {
    // the same figure the portfolio card shows: the return when it can be worked out, else the change in value
    const change = returns
      ? returns.ret === null
        ? null
        : returns.ret * 100
      : pct(portfolio, portfolioStart);
    return (
      <Words
        sentence={investmentsSentence({
          hasAccounts: investmentAccounts.length > 0,
          value: portfolio,
          change,
          kind: returns ? 'return' : 'value',
          period: activePeriod,
        })}
      />
    );
  }
  if (tab === 'Settings')
    return (
      <Words
        sentence={settingsSentence({
          attention: data.connections.filter((c) => !c.disconnected_at && c.last_error).length,
        })}
      />
    );
  return null;
}

export function PageHeading() {
  const { tab } = useApp();
  const loc = useLocation();
  const route = tab === 'Reports' ? parseReport(loc.path, loc.search) : null;
  // Home is one small centred line over the net worth below it.
  if (tab === 'Home')
    return (
      <div className="mb-2 mt-1 text-center text-[15px] text-muted-foreground max-[760px]:text-sm">
        <h1 className="m-0 inline text-[15px] font-normal max-[760px]:text-sm">
          {pageTitle(tab, new Date().getHours())}
        </h1>{' '}
        <p className="m-0 inline">
          <AppSentence />
        </p>
      </div>
    );
  return (
    <div className="mb-[27px] mt-[7px] flex items-end justify-between gap-5 max-[1150px]:items-start max-[760px]:block">
      <div>
        <h1 className="m-0 font-serif text-[64px] font-normal leading-none tracking-[-0.01em] max-[760px]:text-[44px]">
          {pageTitle(tab, new Date().getHours())}
        </h1>
        {/* the line keeps its height while the figures load, so the page does not jump */}
        <p className="m-0 mt-3.5 min-h-[1.3em] max-w-[820px] font-serif text-2xl leading-[1.3] text-muted-foreground max-[760px]:text-[19px]">
          {tab === 'Transactions' ? (
            <TransactionsSentence />
          ) : tab === 'Reports' ? (
            route?.view === 'sub' && <ReportsSentence route={route} />
          ) : (
            <AppSentence />
          )}
        </p>
      </div>
      {tab === 'Accounts' && (
        <div className="max-[760px]:mt-4">
          <AddAccountButton />
        </div>
      )}
      {/* Reports puts its pages, date range and filters here (see ReportsTab). */}
      {tab === 'Reports' && (
        <div
          id="page-tools"
          className="flex flex-wrap items-center justify-end gap-2 max-[760px]:mt-4 max-[760px]:justify-start"
        />
      )}
    </div>
  );
}
