import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { reportUrl } from '../lib/routes.ts';
import { ALL_TIME } from '../lib/reportDates.ts';
import { linkClick } from '../state/router.ts';
import { api } from '../api.ts';
import { groupCategories, longDate, merchantOf } from '../lib/transactions.ts';
import type { Category, Transaction } from '../types.ts';
import { Amount } from './TransactionGroups.tsx';
import { SplitEditor } from './SplitEditor.tsx';
import { DatePicker } from './DatePicker.tsx';
import { addDays, todayIso } from '../lib/calendar.ts';
import { dateLabel } from '../lib/format.ts';
import { useApp } from '../state/AppContext.tsx';
import { ManualFields } from './ManualFields.tsx';
import { Badge } from './ui/badge.tsx';
import { Button, linkButton } from './ui/button.tsx';
import { Drawer } from './ui/dialog.tsx';
import { Callout, DetailList, EYEBROW, Field, ReadonlyValue, Textarea } from './ui/form.tsx';
import { Select } from './ui/select.tsx';
import { Fineprint } from './settings/SettingsCard.tsx';

type Props = {
  txn: Transaction;
  categories: Category[];
  onClose: () => void;
  onSaved: (t: Transaction) => void;
  onError: (message: string) => void;
  /** When given, a transaction you added yourself can be deleted here. */
  onDeleted?: (id: string) => void;
};

/** Classes for what holds the detail, wherever it sits: the children are spaced and sit flush against the top. */
export const DETAIL_BODY = 'grid content-start gap-4 [&>*]:m-0';

/** The detail of one transaction: its figures and everything that can be changed. Used in the drawer and docked. */
export function TransactionDetail({
  txn,
  categories,
  onClose,
  onSaved,
  onError,
  onDeleted,
}: Props) {
  const { base: accounts } = useApp();
  const [notes, setNotes] = useState(txn.notes);
  const [saved, setSaved] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => setNotes(txn.notes), [txn.id, txn.notes]);
  useEffect(() => setSplitting(false), [txn.id]);
  // How many transactions this merchant has (all time), for the "View N transactions" link.
  const merchant = merchantOf(txn);
  useEffect(() => {
    let current = true;
    setCount(null);
    api(`/transactions?limit=1&merchant=${encodeURIComponent(merchant)}`)
      .then((r) => current && setCount(typeof r.total === 'number' ? r.total : null))
      .catch(() => current && setCount(null));
    return () => {
      current = false;
    };
  }, [merchant]);
  // Money in opens the merchant as income, money out as spending; the page has a switch for the other.
  const history = reportUrl({
    view: 'merchant',
    name: merchant,
    type: Number(txn.amount) < 0 ? 'income' : 'expense',
    via: Number(txn.amount) < 0 ? 'Income' : 'Spending',
    interval: 'month',
    date: ALL_TIME,
    categories: [],
    accounts: [],
  });
  async function save(body: Record<string, unknown>) {
    try {
      onSaved(await api('/transactions/' + encodeURIComponent(txn.id), body, 'PATCH'));
      setSaved(true);
      onError('');
    } catch (e: any) {
      onError(e.message);
    }
  }
  const autoName = txn.category_source === 'user' ? null : txn.category?.name;
  const autoLabel = txn.category_source === 'rule' ? 'Rule' : 'Auto';
  // A pending transaction is replaced when it posts, so nothing on it can be changed until then.
  const locked = txn.pending;
  const manual = txn.source === 'manual';
  return (
    <>
      <div>
        <div className={EYEBROW}>TRANSACTION</div>
        <h2>{merchantOf(txn)}</h2>
        <div className="my-2.5 font-serif text-[52px] leading-none tabular-nums">
          <Amount value={txn.amount} />
        </div>
        {count !== null && (
          <a
            className={linkButton}
            href={history}
            onClick={(e) => {
              if (linkClick(e, history)) onClose();
            }}
          >
            View {count.toLocaleString('en-US')} transaction{count === 1 ? '' : 's'}
          </a>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {txn.account_name}
          {txn.account_mask ? ` (…${txn.account_mask})` : ''} · {txn.institution}
          {txn.pending ? ' · Pending' : ''}
        </p>
      </div>
      <DetailList
        rows={[
          manual
            ? ['Source', 'Added by you']
            : [
                'Original statement',
                <span key="s" className="flex items-center gap-2 break-words">
                  {txn.name}
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Copy original statement"
                    onClick={() => void navigator.clipboard?.writeText(txn.name).catch(() => {})}
                  >
                    <Copy size={13} />
                  </button>
                </span>,
              ],
        ]}
      />
      {manual && !locked && (
        <ManualFields txn={txn} accounts={accounts} onSaved={onSaved} onError={onError} />
      )}
      {locked && (
        <Callout role="note">
          This transaction is pending, so it can't be edited until it posts.
        </Callout>
      )}
      {locked ? (
        <div className="grid gap-2">
          <span className="text-[11px] text-muted-foreground">Date</span>
          <ReadonlyValue>{longDate(txn.date)}</ReadonlyValue>
        </div>
      ) : (
        <div className="grid gap-2">
          <label htmlFor="txn-date" className="text-[11px] text-muted-foreground">
            Date
          </label>
          <DatePicker
            id="txn-date"
            value={txn.date}
            max={addDays(todayIso(), 365)}
            onChange={(date) => void save({ date })}
          />
        </div>
      )}
      {!locked && txn.user_date && (
        <button className={linkButton} onClick={() => void save({ date: null })}>
          Reset to bank date ({txn.provider_date})
        </button>
      )}
      {txn.splits.length > 0 ? (
        <div className="grid gap-2 text-[11px] text-muted-foreground">
          <div className="flex justify-between">
            <span>Category</span>
            {!splitting && !locked && (
              <button className={linkButton} onClick={() => setSplitting(true)}>
                Edit split
              </button>
            )}
          </div>
          <strong className="flex items-center gap-2 text-[13px] text-foreground">
            ✂️ Split into {txn.splits.length} parts
            {!txn.split_balanced && <Badge variant="warning">Amount changed</Badge>}
          </strong>
          {!splitting &&
            txn.splits.map((p) => (
              <div
                key={p.id}
                className="flex justify-between border-t border-border py-1 text-xs text-foreground"
              >
                <span>
                  {p.category.emoji} {p.category.name}
                  {p.date && p.date !== txn.date && (
                    <small className="text-muted-foreground"> · {dateLabel(p.date)}</small>
                  )}
                  {p.notes && <small className="text-muted-foreground"> · {p.notes}</small>}
                </span>
                <Amount value={p.amount} />
              </div>
            ))}
        </div>
      ) : locked ? (
        <div className="grid gap-2">
          <span className="text-[11px] text-muted-foreground">Category</span>
          <ReadonlyValue>
            {txn.category ? `${txn.category.emoji} ${txn.category.name}` : '—'}
          </ReadonlyValue>
        </div>
      ) : (
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between">
            <label htmlFor="txn-category" className="text-[11px] text-muted-foreground">
              Category
            </label>
            {!splitting && Number(txn.amount) !== 0 && (
              <button type="button" className={linkButton} onClick={() => setSplitting(true)}>
                Split
              </button>
            )}
          </div>
          <Select
            id="txn-category"
            className="h-10 w-full"
            value={txn.category_source === 'user' ? String(txn.category?.id) : 'auto'}
            onChange={(e) =>
              void save({
                category_id: e.target.value === 'auto' ? null : Number(e.target.value),
              })
            }
          >
            <option value="auto">
              {autoLabel}
              {autoName ? ` (${autoName})` : ''}
            </option>
            {groupCategories(categories).map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
      )}
      {splitting && !locked && (
        <SplitEditor
          txn={txn}
          categories={categories}
          defaultCategory={txn.category?.id ?? null}
          onSaved={onSaved}
          onError={onError}
          onClose={() => setSplitting(false)}
        />
      )}
      {locked ? (
        <div className="grid gap-2">
          <span className="text-[11px] text-muted-foreground">Notes</span>
          <ReadonlyValue>{txn.notes || '—'}</ReadonlyValue>
        </div>
      ) : (
        <>
          <Field>
            Notes
            <Textarea
              rows={4}
              maxLength={2000}
              placeholder="Add notes to this transaction…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== txn.notes && void save({ notes })}
            />
          </Field>
          <Fineprint>
            <span aria-live="polite">{saved ? 'Saved' : 'Changes save automatically.'}</span>
          </Fineprint>
        </>
      )}
      {manual && onDeleted && (
        <Button
          type="button"
          variant="outline"
          className="justify-self-start border-destructive/40 text-destructive"
          onClick={async () => {
            if (!window.confirm(`Delete "${txn.name}"? This cannot be undone.`)) return;
            try {
              await api('/transactions/' + encodeURIComponent(txn.id), undefined, 'DELETE');
              onDeleted(txn.id);
              onError('');
              onClose();
            } catch (e: any) {
              onError(e.message);
            }
          }}
        >
          Delete transaction
        </Button>
      )}
    </>
  );
}

/** The detail over the page: a panel from the right edge, a sheet from the bottom on a phone. */
export function TransactionDrawer(props: Props) {
  return (
    <Drawer
      title={merchantOf(props.txn)}
      closeLabel="Close transaction details"
      onClose={props.onClose}
      contentClassName={DETAIL_BODY}
      sheet
    >
      <TransactionDetail {...props} />
    </Drawer>
  );
}
