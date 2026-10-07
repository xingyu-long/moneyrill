import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { todayIso } from '../lib/calendar.ts';
import { resolveSpec } from '../lib/reportDates.ts';
import {
  parseReport,
  reportUrl,
  SUBS,
  type Interval,
  type ReportRoute,
  type Sub,
} from '../lib/routes.ts';
import { useApp } from '../state/AppContext.tsx';
import { hrefFor, linkClick, navigate, rememberReport, useLocation } from '../state/router.ts';
import { useCategories } from '../state/useCategories.ts';
import type { ReportCategory } from '../types.ts';
import { CashFlowReport } from './reports/CashFlowReport.tsx';
import { History, type Subject } from './reports/History.tsx';
import { CategoryReport } from './reports/CategoryReport.tsx';
import { DateRangePopover } from './reports/DateRangePopover.tsx';
import { FiltersPopover } from './reports/FiltersPopover.tsx';
import type { Scope } from './reports/scope.ts';
import { ReportCard } from './reports/parts.tsx';
import { EMPTY } from './reports/styles.ts';
import { cn } from '../lib/cn.ts';

const subUrl = (r: ReportRoute, sub: Sub) =>
  reportUrl({ date: r.date, categories: r.categories, accounts: r.accounts, view: 'sub', sub });

/**
 * Everything about the view is in the address: /reports/spending?range=last-month&categories=1,2, or
 * /reports/category/9?type=expense&period=2026-09-01 for one category. The last one is remembered on this device.
 */
export function ReportsTab() {
  const { data, production } = useApp();
  const { categories } = useCategories();
  const [tools, setTools] = useState<HTMLElement | null>(null);
  useEffect(() => setTools(document.getElementById('page-tools')), []);
  const loc = useLocation();
  const route = parseReport(loc.path, loc.search);
  // Bumped after an edit made from a report, so the figures follow it.
  const [edits, setEdits] = useState(0);
  useEffect(() => {
    // A bare /reports (or an unknown page under it) opens the last report used here.
    if (!route) navigate(hrefFor('Reports'), true);
    else if (route.view === 'sub') rememberReport(loc.path);
  }, [loc.path, loc.search]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!route) return null;
  const go = (next: ReportRoute, replace = false) => navigate(reportUrl(next), replace);
  // A new range or filter starts the category page again from its latest period.
  const reset = (patch: Partial<ReportRoute>) =>
    go({
      ...route,
      ...patch,
      ...(route.view !== 'sub' ? { period: undefined } : {}),
    } as ReportRoute);
  const today = todayIso();
  const scope: Scope = {
    ...resolveSpec(route.date, today),
    today,
    categories: route.categories,
    accounts: route.accounts,
    ...(route.view === 'merchant' ? { merchant: route.name } : {}),
  };
  const accounts = data.accounts
    .filter((a) => a.kind === 'cash' || a.kind === 'credit')
    .map((a) => ({ id: a.id, label: a.name + (a.mask ? ` (…${a.mask})` : '') }));
  // A sync adds a run and an edit bumps `edits`: either reloads the figures.
  const refreshKey = `${data.runs[0]?.id ?? ''}:${edits}`;
  // `shown` carries the chart's interval and the period picked in the breakdown into the category page.
  const open = (
    category: ReportCategory,
    type: 'income' | 'expense',
    via: Sub,
    shown: { interval: Interval; period?: string } = { interval: 'month' },
  ) =>
    go({
      ...route,
      view: 'category',
      id: category.id,
      type,
      via,
      interval: shown.interval,
      ...(shown.period ? { period: shown.period } : {}),
    });
  const found = route.view === 'category' ? categories.find((c) => c.id === route.id) : undefined;
  // What a history page is about: the category (once the list has loaded) or the merchant.
  const subject: Subject | undefined =
    route.view === 'merchant'
      ? { name: route.name, merchant: route.name }
      : found && { name: found.name, emoji: found.emoji, categoryId: found.id };
  const back = route.view === 'sub' ? '' : subUrl(route, route.via);
  const tabs = (
    <div className="flex gap-1.5" role="tablist" aria-label="Reports">
      {SUBS.map((sub) => (
        <button
          key={sub}
          role="tab"
          aria-selected={route.view === 'sub' && route.sub === sub}
          className={cn(
            'rounded-full px-4 py-2 text-[13px] transition-colors',
            route.view === 'sub' && route.sub === sub
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-muted-foreground shadow-card hover:text-foreground',
          )}
          onClick={() => navigate(subUrl(route, sub))}
        >
          {sub}
        </button>
      ))}
    </div>
  );
  const pickers = (
    <>
      <DateRangePopover spec={route.date} onChange={(date) => reset({ date })} />
      <FiltersPopover
        filters={{ categories: route.categories, accounts: route.accounts }}
        categories={categories}
        accounts={accounts}
        onChange={(f) => reset({ categories: f.categories, accounts: f.accounts })}
      />
    </>
  );
  return (
    <>
      {route.view === 'sub' ? (
        // The pages, date range and filters sit in the heading row, beside the sentence.
        tools &&
        createPortal(
          <>
            {tabs}
            {pickers}
          </>,
          tools,
        )
      ) : (
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <nav
            className="flex items-center gap-2 text-[15px] text-muted-foreground"
            aria-label="Breadcrumb"
          >
            <a
              href={back}
              className="py-1.5 hover:text-foreground"
              onClick={(e) => linkClick(e, back)}
            >
              {route.via}
            </a>
            <ChevronRight size={14} />
            <span aria-current="page" className="font-semibold text-foreground">
              {subject
                ? `${subject.emoji ? subject.emoji + ' ' : ''}${subject.name}`
                : categories.length
                  ? 'Unknown category'
                  : '…'}
            </span>
          </nav>
          <div className="flex gap-2">{pickers}</div>
        </div>
      )}
      {route.view !== 'sub' ? (
        subject ? (
          <History
            key={route.view + (route.view === 'category' ? route.id : route.name) + route.type}
            subject={subject}
            type={route.type}
            scope={scope}
            categories={categories}
            refreshKey={refreshKey}
            onChanged={() => setEdits((n) => n + 1)}
            interval={route.interval}
            period={route.period}
            // Picking a period or an interval replaces the entry: Back leaves the page in one step.
            onInterval={(interval) => go({ ...route, interval, period: undefined }, true)}
            onPeriod={(period) => go({ ...route, period }, true)}
            onType={
              route.view === 'merchant'
                ? (type) => go({ ...route, type, period: undefined }, true)
                : undefined
            }
          />
        ) : (
          <ReportCard>
            <p className={EMPTY}>
              {categories.length ? 'This category no longer exists.' : 'Loading…'}
            </p>
          </ReportCard>
        )
      ) : route.sub === 'Cash flow' ? (
        <CashFlowReport
          scope={scope}
          refreshKey={refreshKey}
          production={production}
          reportHref={(sub) => subUrl(route, sub)}
          onOpenCategory={(category, type, shown) => open(category, type, 'Cash flow', shown)}
        />
      ) : (
        <CategoryReport
          type={route.sub === 'Spending' ? 'expense' : 'income'}
          scope={scope}
          categories={categories}
          refreshKey={refreshKey}
          production={production}
          onChanged={() => setEdits((n) => n + 1)}
          onOpenCategory={(category) =>
            open(category, route.sub === 'Spending' ? 'expense' : 'income', route.sub)
          }
        />
      )}
    </>
  );
}
