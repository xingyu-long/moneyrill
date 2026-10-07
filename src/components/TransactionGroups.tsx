import { cash, dateLabel, isPrivate } from '../lib/format.ts';
import { cn } from '../lib/cn.ts';
import { Badge } from './ui/badge.tsx';
import { Card } from './ui/card.tsx';
import { longDate, merchantOf } from '../lib/transactions.ts';
import type { Transaction } from '../types.ts';

/** Money in shows as +$x in green; money out as plain $x (the provider sign is positive = out). */
export function Amount({ value }: { value: string }) {
  const n = Number(value);
  return n < 0 ? <span className="text-positive">+{cash(-n)}</span> : <span>{cash(n)}</span>;
}

// Private mode shows no direction either: a masked total should not reveal if the day was net in or out.
const signed = (n: number) => (n === 0 || isPrivate() ? '' : n > 0 ? '+' : '−');

// One row: merchant, category, account and amount; on a phone the amount moves up beside the merchant.
const ROW =
  'grid w-full grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.5fr)_110px] items-center gap-x-3.5 border-t border-border px-[18px] py-3 text-left text-xs transition-colors hover:bg-accent max-[760px]:grid-cols-[minmax(0,1fr)_auto] max-[760px]:gap-y-0.5';
const CELL = 'truncate';
const AMOUNT = 'text-right tabular-nums max-[760px]:col-start-2 max-[760px]:row-start-1';

// The card layout: a round emoji, the merchant over its category and account, and the amount.
const CARD_ROW =
  'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-accent';

/**
 * Rows grouped by date (see groupByDate); clicking a row or one of its split parts opens it. `cards` gives every day
 * its own card under a heading with the day's total (the Transactions page); `activeId` marks the row whose detail
 * is open beside the list.
 */
export function TransactionGroups({
  groups,
  onOpen,
  cards = false,
  activeId = null,
}: {
  groups: { date: string; rows: Transaction[]; net: number }[];
  onOpen: (id: string) => void;
  cards?: boolean;
  activeId?: string | null;
}) {
  if (cards)
    return (
      <>
        {groups.map((g) => (
          <section key={g.date} aria-label={longDate(g.date)} className="mb-5">
            <div className="txn-day-head mb-2 flex justify-between px-3 text-xs text-muted-foreground">
              <span>{longDate(g.date)}</span>
              <span className={cn(g.net > 0 && !isPrivate() && 'text-positive')}>
                {signed(g.net)}
                {cash(Math.abs(g.net))}
              </span>
            </div>
            <Card className="gap-0 p-1.5">
              {g.rows.map((t: Transaction) => (
                <div key={t.id}>
                  <button
                    className={cn(CARD_ROW, activeId === t.id && 'bg-accent')}
                    onClick={() => onOpen(t.id)}
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-[38px] shrink-0 place-items-center rounded-full bg-muted text-[17px]"
                    >
                      {t.splits.length ? '✂️' : (t.category?.emoji ?? '•')}
                    </span>
                    <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)]">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate">{merchantOf(t)}</span>
                        {t.pending && <Badge variant="warning">Pending</Badge>}
                        {t.source === 'manual' && <Badge>Manual</Badge>}
                      </span>
                      <small className="truncate text-xs text-muted-foreground">
                        {t.splits.length
                          ? `Split · ${t.splits.length} parts`
                          : t.category
                            ? t.category.name
                            : 'No category'}
                        {!t.splits.length && t.category_source === 'auto' && (
                          <span className="ml-1 text-[10px]">auto</span>
                        )}
                        {t.splits.length > 0 && !t.split_balanced && (
                          <Badge variant="warning" className="ml-2">
                            Amount changed
                          </Badge>
                        )}
                        {' · '}
                        <span>
                          {t.account_name}
                          {t.account_mask ? ` (…${t.account_mask})` : ''}
                        </span>
                      </small>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      <Amount value={t.amount} />
                    </span>
                  </button>
                  {t.splits.map((p, i) => (
                    <button
                      key={p.id}
                      className={cn(CARD_ROW, 'py-1.5 pl-[58px] text-xs text-muted-foreground')}
                      aria-label={`Part ${i + 1} of ${merchantOf(t)}`}
                      onClick={() => onOpen(t.id)}
                    >
                      <span className="flex-1 truncate">
                        <span className="mr-1.5">↳</span>
                        {p.notes || `Part ${i + 1}`}
                        {p.date && p.date !== t.date && (
                          <small className="ml-2 text-[10px]">{dateLabel(p.date)}</small>
                        )}
                        <span className="ml-2">
                          {p.category.emoji} {p.category.name}
                        </span>
                      </span>
                      <span className="tabular-nums text-foreground">
                        <Amount value={p.amount} />
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </Card>
          </section>
        ))}
      </>
    );
  return (
    <>
      {groups.map((g) => (
        <div key={g.date}>
          <div className="txn-day-head flex justify-between bg-muted px-[18px] py-2 text-[11px] font-semibold text-muted-foreground">
            <span>{longDate(g.date)}</span>
            <span>
              {signed(g.net)}
              {cash(Math.abs(g.net))}
            </span>
          </div>
          {g.rows.map((t: Transaction) => (
            <div key={t.id}>
              <button className={ROW} onClick={() => onOpen(t.id)}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className={CELL}>{merchantOf(t)}</span>
                  {t.pending && <Badge variant="warning">Pending</Badge>}
                  {t.source === 'manual' && <Badge>Manual</Badge>}
                </span>
                <span className={cn(CELL, 'max-[760px]:col-start-1 max-[760px]:text-[11px]')}>
                  {t.splits.length
                    ? `✂️ Split · ${t.splits.length} parts`
                    : t.category
                      ? `${t.category.emoji} ${t.category.name}`
                      : '—'}
                  {!t.splits.length && t.category_source === 'auto' && (
                    <small className="ml-1.5 text-[9px] text-muted-foreground">auto</small>
                  )}
                  {t.splits.length > 0 && !t.split_balanced && (
                    <Badge variant="warning" className="ml-2">
                      Amount changed
                    </Badge>
                  )}
                </span>
                <span
                  className={cn(
                    CELL,
                    'text-muted-foreground max-[760px]:col-start-1 max-[760px]:text-[11px]',
                  )}
                >
                  {t.account_name}
                  {t.account_mask ? ` (…${t.account_mask})` : ''}
                </span>
                <span className={cn(CELL, AMOUNT)}>
                  <Amount value={t.amount} />
                </span>
              </button>
              {t.splits.map((p, i) => (
                <button
                  key={p.id}
                  className={cn(ROW, 'bg-muted/50 py-2 text-[11px]')}
                  aria-label={`Part ${i + 1} of ${merchantOf(t)}`}
                  onClick={() => onOpen(t.id)}
                >
                  <span className={cn(CELL, 'flex items-center gap-2')}>
                    <span className="ml-1.5 text-muted-foreground">↳</span>
                    {p.notes || `Part ${i + 1}`}
                    {p.date && p.date !== t.date && (
                      <small className="ml-2 text-[10px] text-muted-foreground">
                        {dateLabel(p.date)}
                      </small>
                    )}
                  </span>
                  <span className={cn(CELL, 'max-[760px]:col-start-1')}>
                    {p.category.emoji} {p.category.name}
                  </span>
                  <span className={cn(CELL, 'max-[760px]:hidden')} />
                  <span className={cn(CELL, AMOUNT)}>
                    <Amount value={p.amount} />
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
