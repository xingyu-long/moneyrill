import { useEffect, useState, type ReactNode } from 'react';
import { Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { todayIso } from '../lib/calendar.ts';
import { ALL_TIME, resolveSpec, type DateSpec } from '../lib/reportDates.ts';
import { groupByDate, groupCategories } from '../lib/transactions.ts';
import { cn } from '../lib/cn.ts';
import { useApp } from '../state/AppContext.tsx';
import { useCategories } from '../state/useCategories.ts';
import { COLORS } from '../lib/format.ts';
import { useMediaQuery } from '../state/useMediaQuery.ts';
import { useTransactions } from '../state/useTransactions.ts';
import { DatePicker } from './DatePicker.tsx';
import { Button } from './ui/button.tsx';
import { Card } from './ui/card.tsx';
import { Input } from './ui/input.tsx';
import { Switch } from './ui/switch.tsx';
import { AddTransactionModal } from './AddTransactionModal.tsx';
import { DETAIL_BODY, TransactionDetail, TransactionDrawer } from './TransactionDrawer.tsx';
import { TransactionGroups } from './TransactionGroups.tsx';

// The dates you can narrow the list to. "All time" is the list as it always was; "Custom range" takes two days.
const WHEN: [DateSpec, string][] = [
  [ALL_TIME, 'All time'],
  [{ mode: 'preset', id: 'thisMonth' }, 'This month'],
  [{ mode: 'preset', id: 'lastMonth' }, 'Last month'],
  [{ mode: 'preset', id: 'thisYear' }, 'This year'],
  [{ mode: 'preset', id: 'lastYear' }, 'Last year'],
];

const sameDate = (a: DateSpec, b: DateSpec) => JSON.stringify(a) === JSON.stringify(b);

/** The custom range starts as this month, so the first pick is a small change. */
const customDefault = () => ({ from: todayIso().slice(0, 8) + '01', to: todayIso() });

/** From and To. Moving one past the other moves the other too, so the range is always valid. */
function CustomDates({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (r: { from: string; to: string }) => void;
}) {
  return (
    <div className="grid gap-2 px-3.5">
      <label htmlFor="transactions-from" className="text-[11px] text-muted-foreground">
        From
      </label>
      <DatePicker
        id="transactions-from"
        value={from}
        onChange={(d) => onChange({ from: d, to: d > to ? d : to })}
      />
      <label htmlFor="transactions-to" className="text-[11px] text-muted-foreground">
        To
      </label>
      <DatePicker
        id="transactions-to"
        value={to}
        onChange={(d) => onChange({ from: d < from ? d : from, to: d })}
      />
    </div>
  );
}

/** A filter's small heading. */
const Label = ({ children }: { children: ReactNode }) => (
  <div className="mb-1.5 px-3.5 text-[11px] tracking-[0.06em] text-muted-foreground">
    {children}
  </div>
);

/** One choice in a filter list: the chosen ones are white pills. */
function Choice({
  on,
  role,
  onClick,
  children,
}: {
  on: boolean;
  role?: 'radio';
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role ? on : undefined}
      aria-pressed={role ? undefined : on}
      className={cn(
        'w-full truncate rounded-full px-3.5 py-2 text-left text-[13px] transition-colors',
        on
          ? 'bg-card font-medium text-foreground shadow-card'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const toggle = <T,>(list: T[], v: T) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

export function TransactionsTab() {
  const { base, data, production, setError, setManual } = useApp();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(0); // bumps when you add one, to reload the list
  const [filters, setFilters] = useState<{
    q: string;
    accounts: string[];
    categories: number[];
    when: DateSpec;
  }>({ q: '', accounts: [], categories: [], when: ALL_TIME });
  // Off on every visit: only bank, card and loan rows. On: investment accounts and brokerage activity too.
  // It only changes what is listed; what counts in Reports is the same either way.
  const [investments, setInvestments] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false); // on a phone the filters fold away
  const { categories } = useCategories();
  const { when, ...rest } = filters;
  // A finished sync adds a run, which reloads the list.
  const list = useTransactions(
    {
      ...rest,
      account: '',
      category: '',
      ...(investments ? {} : { investments: 'hide' as const }),
      ...(when.mode === 'all' ? {} : resolveSpec(when, todayIso())),
    },
    `${data.runs[0]?.id}:${added}`,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const open = list.rows.find((t) => t.id === openId) ?? null;
  // On a wide screen the detail sits beside the list; otherwise it covers the page (a sheet on a phone).
  const wide = useMediaQuery('(min-width: 1280px)');
  const docked = wide && !!open;
  useEffect(() => {
    if (!docked) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docked]);
  // Bank and card accounts, plus any account you keep by hand (a 401(k), equity awards); investment accounts only
  // while they are shown.
  const accounts = base.filter((a) =>
    a.kind === 'investment'
      ? investments
      : a.kind === 'cash' || a.kind === 'credit' || a.source === 'manual',
  );
  const showInvestments = (on: boolean) => {
    setInvestments(on);
    // A hidden account cannot stay picked.
    if (!on) {
      const shown = new Set(base.filter((a) => a.kind !== 'investment').map((a) => a.id));
      setFilters((f) => ({ ...f, accounts: f.accounts.filter((id) => shown.has(id)) }));
    }
  };
  const groups = groupByDate(list.rows, { skipInvestments: true });
  const picked =
    (filters.when.mode === 'all' ? 0 : 1) + filters.accounts.length + filters.categories.length;
  const filtered = !!(filters.q || picked);
  // The banks, each with its accounts.
  const byBank = new Map<string, typeof accounts>();
  for (const a of accounts) {
    const bank = a.institution || 'Other';
    byBank.set(bank, [...(byBank.get(bank) ?? []), a]);
  }
  const banks = [...byBank].sort((x, y) => x[0].localeCompare(y[0]));
  const note = 'm-0 px-3 py-7 text-xs text-muted-foreground';
  return (
    <>
      <div
        className={cn(
          'grid items-start gap-6 min-[1101px]:grid-cols-[230px_minmax(0,1fr)]',
          docked && 'min-[1101px]:grid-cols-[230px_minmax(0,1fr)_380px]',
        )}
      >
        <div className="grid gap-3 min-[1101px]:sticky min-[1101px]:top-[92px] min-[1101px]:gap-5">
          <Button
            className="justify-self-start min-[1101px]:w-full min-[1101px]:justify-self-stretch max-[760px]:fixed max-[760px]:bottom-[calc(max(16px,env(safe-area-inset-bottom))+78px)] max-[760px]:right-5 max-[760px]:z-30 max-[760px]:size-[52px] max-[760px]:bg-sage max-[760px]:p-0 max-[760px]:text-white max-[760px]:shadow-lg max-[760px]:hover:bg-sage"
            onClick={() => setAdding(true)}
          >
            <Plus size={15} className="max-[760px]:size-6" />
            <span className="max-[760px]:sr-only">Add transaction</span>
          </Button>
          <label className="relative flex items-center text-muted-foreground">
            <Search size={15} className="absolute left-3.5" />
            <Input
              className="h-10 pl-10"
              type="search"
              placeholder="Search transactions"
              aria-label="Search transactions"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
          </label>
          <button
            type="button"
            aria-expanded={filtersOpen}
            className="flex items-center gap-2 justify-self-start rounded-full bg-card px-4 py-2 text-[13px] shadow-card min-[1101px]:hidden"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <SlidersHorizontal size={14} />
            Filters{picked ? ` (${picked})` : ''}
          </button>
          <div className={cn('grid gap-5', !filtersOpen && 'max-[1100px]:hidden')}>
            <div role="radiogroup" aria-label="When" className="grid gap-0.5">
              <Label>WHEN</Label>
              {WHEN.map(([spec, label]) => (
                <Choice
                  key={label}
                  role="radio"
                  on={sameDate(filters.when, spec)}
                  onClick={() => setFilters({ ...filters, when: spec })}
                >
                  {label}
                </Choice>
              ))}
              <Choice
                role="radio"
                on={filters.when.mode === 'range'}
                onClick={() =>
                  filters.when.mode === 'range' ||
                  setFilters({ ...filters, when: { mode: 'range', ...customDefault() } })
                }
              >
                Custom range
              </Choice>
            </div>
            {filters.when.mode === 'range' && (
              <CustomDates
                from={filters.when.from}
                to={filters.when.to}
                onChange={(r) => setFilters({ ...filters, when: { mode: 'range', ...r } })}
              />
            )}
            <div role="group" aria-label="Accounts" className="grid gap-0.5">
              <Label>ACCOUNTS</Label>
              <Choice
                on={filters.accounts.length === 0}
                onClick={() => setFilters({ ...filters, accounts: [] })}
              >
                All accounts
              </Choice>
              <label className="my-1 flex items-center justify-between gap-2 px-3.5 text-[13px]">
                Show investment accounts
                <Switch checked={investments} onCheckedChange={showInvestments} />
              </label>
              {banks.map(([bank, list]) => (
                <div key={bank} role="group" aria-label={bank} className="mt-2 grid gap-0.5">
                  <div className="px-3.5 text-[11px] text-muted-foreground">{bank}</div>
                  {list.map((a) => (
                    <Choice
                      key={a.id}
                      on={filters.accounts.includes(a.id)}
                      onClick={() =>
                        setFilters({ ...filters, accounts: toggle(filters.accounts, a.id) })
                      }
                    >
                      {a.name}
                      {a.mask ? (
                        <span className="ml-1.5 text-[11px] opacity-70">…{a.mask}</span>
                      ) : null}
                    </Choice>
                  ))}
                </div>
              ))}
            </div>
            <div role="group" aria-label="Categories" className="grid gap-2">
              <Label>CATEGORIES</Label>
              {groupCategories(categories).map((g) => (
                <div key={g.group} className="px-1">
                  <div className="mb-1.5 px-2.5 text-[11px] text-muted-foreground">{g.group}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.categories.map((c) => {
                      const on = filters.categories.includes(c.id);
                      const color = COLORS[c.id % COLORS.length];
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={on}
                          className={cn(
                            'rounded-full px-3 py-1 text-xs transition-colors',
                            on && 'bg-primary text-primary-foreground',
                          )}
                          style={
                            on
                              ? undefined
                              : {
                                  background: `color-mix(in srgb, ${color} 16%, transparent)`,
                                  color: `color-mix(in srgb, ${color} 70%, var(--text))`,
                                }
                          }
                          onClick={() =>
                            setFilters({ ...filters, categories: toggle(filters.categories, c.id) })
                          }
                        >
                          {c.emoji} {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="min-w-0">
          {list.error && <Card className={note}>{list.error}</Card>}
          {!list.error && !list.loading && !groups.length && (
            <Card className={note}>
              {filtered
                ? 'No transactions match these filters.'
                : production
                  ? 'No transactions yet. Sync a connected bank or card account.'
                  : 'No transactions yet. Load the sandbox samples in Settings, then sync.'}
            </Card>
          )}
          <section aria-label="Transactions">
            <TransactionGroups cards groups={groups} onOpen={setOpenId} activeId={open?.id} />
          </section>
          {list.hasMore && (
            <div className="pt-1 text-center">
              <Button variant="outline" onClick={() => void list.more()}>
                Load more
              </Button>
            </div>
          )}
        </div>
        {docked && open && (
          <aside
            aria-label="Transaction details"
            className="min-[1101px]:sticky min-[1101px]:top-[92px]"
          >
            <Card className="relative max-h-[calc(100dvh-116px)] overflow-auto p-7 [&_h2]:mb-3 [&_h2]:font-serif [&_h2]:text-[28px] [&_h2]:font-normal">
              <button
                type="button"
                aria-label="Close transaction details"
                className="absolute right-3 top-3 grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setOpenId(null)}
              >
                <X size={19} />
              </button>
              <div className={cn(DETAIL_BODY, 'pt-3')}>
                <TransactionDetail
                  txn={open}
                  categories={categories}
                  onClose={() => setOpenId(null)}
                  onSaved={list.replace}
                  onDeleted={list.remove}
                  onError={setError}
                />
              </div>
            </Card>
          </aside>
        )}
      </div>
      {open && !docked && (
        <TransactionDrawer
          txn={open}
          categories={categories}
          onClose={() => setOpenId(null)}
          onSaved={list.replace}
          onDeleted={list.remove}
          onError={setError}
        />
      )}
      {adding && (
        <AddTransactionModal
          accounts={base}
          categories={categories}
          onClose={() => setAdding(false)}
          onAdded={(t) => {
            // Something added to an investment account would otherwise vanish from the list.
            if (t.account_kind === 'investment') setInvestments(true);
            setAdded((n) => n + 1);
          }}
          onError={setError}
          onNewAccount={() => setManual(true)}
        />
      )}
    </>
  );
}
