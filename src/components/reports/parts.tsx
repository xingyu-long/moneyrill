import { useState } from 'react';
import { cash } from '../../lib/format.ts';
import { groupByDate, longDate } from '../../lib/transactions.ts';
import { useApp } from '../../state/AppContext.tsx';
import { useTransactions, type TransactionFilters } from '../../state/useTransactions.ts';
import type { Category, CategoryReport } from '../../types.ts';
import { TransactionDrawer } from '../TransactionDrawer.tsx';
import { TransactionGroups } from '../TransactionGroups.tsx';
import { Button } from '../ui/button.tsx';
import { Card } from '../ui/card.tsx';
import { cn } from '../../lib/cn.ts';
import type { ReactNode } from 'react';
import { EMPTY } from './styles.ts';

/** A card with a title, optional controls at the right, and its content. */
export function ReportCard({
  title,
  tools,
  label,
  className,
  children,
}: {
  title?: ReactNode;
  tools?: ReactNode;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card aria-label={label} className={cn('mb-3.5 px-6 py-5', className)}>
      {(title || tools) && (
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="m-0 font-serif text-2xl font-normal">{title}</h2>
          {tools && <div className="flex flex-wrap items-center gap-2">{tools}</div>}
        </div>
      )}
      {children}
    </Card>
  );
}

/** The transactions behind a report, grouped by date, a page at a time; a row opens the usual editor. */
export function ReportTransactions({
  filters,
  categories,
  refreshKey,
  onChanged,
}: {
  filters: Omit<TransactionFilters, 'q' | 'account' | 'category'>;
  categories: Category[];
  refreshKey: unknown;
  /** An edit may move money between categories, periods or out of the report. */
  onChanged: () => void;
}) {
  const { setError } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useTransactions({ q: '', account: '', category: '', ...filters }, refreshKey);
  const open = list.rows.find((t) => t.id === openId) ?? null;
  const groups = groupByDate(list.rows);
  return (
    <Card aria-label="Transactions" className="overflow-hidden">
      <div className="px-6 pb-2.5 pt-5">
        <h2 className="m-0 font-serif text-2xl font-normal">Transactions</h2>
      </div>
      {list.error && <p className={EMPTY}>{list.error}</p>}
      {!list.error && !list.loading && !groups.length && <p className={EMPTY}>No transactions.</p>}
      <div className="max-h-[640px] overflow-y-auto">
        <TransactionGroups groups={groups} onOpen={setOpenId} />
      </div>
      {list.hasMore && (
        <div className="border-t border-border p-3.5 text-center">
          <Button variant="outline" onClick={() => void list.more()}>
            Load more
          </Button>
        </div>
      )}
      {open && (
        <TransactionDrawer
          txn={open}
          categories={categories}
          onClose={() => setOpenId(null)}
          onSaved={(t) => {
            list.replace(t);
            onChanged();
          }}
          onDeleted={(id) => {
            list.remove(id);
            onChanged();
          }}
          onError={setError}
        />
      )}
    </Card>
  );
}

/** Count, largest, average, total and first/last date of a spending or income report. */
export function CategorySummary({
  type,
  report,
  title,
}: {
  type: 'income' | 'expense';
  report: CategoryReport;
  title?: string;
}) {
  const s = report.summary;
  return (
    <ReportCard title="Summary" label="Summary">
      {title && <p className="m-0 mb-2.5 text-xs text-muted-foreground">{title}</p>}
      <SummaryList
        rows={[
          ['Total transactions', s.count.toLocaleString('en-US')],
          ['Largest transaction', cash(Number(s.largest))],
          ['Average transaction', cash(Number(s.average))],
          [
            `Total ${type === 'expense' ? 'spending' : 'income'}`,
            `${type === 'income' ? '+' : ''}${cash(Number(report.total))}`,
            type === 'income',
          ],
          ['First transaction', s.first_date ? longDate(s.first_date) : '—'],
          ['Last transaction', s.last_date ? longDate(s.last_date) : '—'],
        ]}
      />
    </ReportCard>
  );
}

/** Label and value pairs, the value at the right (green when it is money coming in). */
export function SummaryList({ rows }: { rows: [string, string, boolean?][] }) {
  return (
    <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3.5 gap-y-2.5 text-xs">
      {rows.map(([label, value, income]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className={cn('m-0 text-right tabular-nums', income && 'text-positive')}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
