import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../api.ts';
import { addDays, todayIso } from '../lib/calendar.ts';
import { cash, isPrivate } from '../lib/format.ts';
import {
  draftProblem,
  evenShares,
  formatCents,
  remainingCents,
  splitBody,
  spreadDates,
  totalCents,
  type DateSpacing,
  type DraftPart,
} from '../lib/splits.ts';
import { groupCategories } from '../lib/transactions.ts';
import type { Category, Transaction } from '../types.ts';
import { DatePicker } from './DatePicker.tsx';
import { Button, linkButton } from './ui/button.tsx';
import { Callout, FIELD_BOX, Field } from './ui/form.tsx';
import { Input } from './ui/input.tsx';
import { Select } from './ui/select.tsx';
import { cn } from '../lib/cn.ts';
import { Fineprint } from './settings/SettingsCard.tsx';

type Props = {
  txn: Transaction;
  categories: Category[];
  /** Category a new part starts with: the transaction's own. */
  defaultCategory: number | null;
  onSaved: (t: Transaction) => void;
  onError: (message: string) => void;
  onClose: () => void;
};

const fromSplits = (txn: Transaction): DraftPart[] =>
  txn.splits.map((s) => ({
    amount: formatCents(Math.round(Math.abs(Number(s.amount)) * 100)),
    category_id: s.category.id,
    notes: s.notes,
    date: s.date,
  }));

const MAX_PARTS = 20;

/** Edit the parts of a split: each has its own amount, date, category and notes, and they must add up. */
export function SplitEditor({
  txn,
  categories,
  defaultCategory,
  onSaved,
  onError,
  onClose,
}: Props) {
  const total = totalCents(txn.amount);
  const blank = (amount = ''): DraftPart => ({
    amount,
    category_id: defaultCategory,
    notes: '',
    date: null,
  });
  const [parts, setParts] = useState<DraftPart[]>(() =>
    txn.splits.length ? fromSplits(txn) : [blank(total ? formatCents(total) : ''), blank()],
  );
  const [count, setCount] = useState('2');
  const [spacing, setSpacing] = useState<DateSpacing>('same');
  const [busy, setBusy] = useState(false);
  if (isPrivate()) return <Fineprint>Turn off Private mode to split or edit a split.</Fineprint>;
  if (total === null)
    return <Fineprint>This amount is not a whole number of cents and cannot be split.</Fineprint>;

  const maxDate = addDays(todayIso(), 365);
  const left = remainingCents(total, parts);
  const problem =
    draftProblem(total, parts) ??
    (parts.some((p) => p.date && p.date > maxDate)
      ? 'A part is dated more than a year ahead'
      : null);
  const n = Number(count);
  const countOk = Number.isInteger(n) && n >= 2 && n <= MAX_PARTS && n <= total;
  const change = (i: number, patch: Partial<DraftPart>) =>
    setParts((old) => old.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  /** n equal parts (leftover cents go to the first ones); keeps what was typed for the parts that remain. */
  const splitEvenly = () => {
    const shares = evenShares(total, n);
    const dates = spreadDates(txn.date, n, spacing);
    setParts(
      shares.map((cents, i) => ({
        amount: formatCents(cents),
        category_id: parts[i]?.category_id ?? parts[0]?.category_id ?? defaultCategory,
        notes: parts[i]?.notes ?? '',
        date: spacing === 'same' ? (parts[i]?.date ?? null) : dates[i],
      })),
    );
  };
  const run = async (fn: () => Promise<Transaction>) => {
    setBusy(true);
    try {
      onSaved(await fn());
      onError('');
      onClose();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const url = '/transactions/' + encodeURIComponent(txn.id) + '/splits';
  return (
    <div className="grid gap-3" role="group" aria-label="Split">
      {txn.splits.length > 0 && !txn.split_balanced && (
        <Callout>
          The bank changed this amount after it was split. Adjust the parts so they add up again.
        </Callout>
      )}
      <div
        className={cn(FIELD_BOX, 'grid-cols-[90px_1fr] items-end gap-2.5')}
        role="group"
        aria-label="Split evenly"
      >
        <Field>
          Split evenly into
          <Input
            className="h-10"
            type="number"
            min={2}
            max={MAX_PARTS}
            aria-label="Number of parts"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </Field>
        <Field>
          Dates
          <Select
            className="h-10"
            aria-label="Spacing of dates"
            value={spacing}
            onChange={(e) => setSpacing(e.target.value as DateSpacing)}
          >
            <option value="same">All on the same day</option>
            <option value="weekly">One per week</option>
            <option value="monthly">One per month</option>
          </Select>
        </Field>
        <Button
          type="button"
          variant="outline"
          className="col-span-full"
          disabled={!countOk}
          onClick={splitEvenly}
        >
          Split evenly
        </Button>
      </div>
      {parts.map((p, i) => (
        <div key={i} className={FIELD_BOX}>
          <div className="flex items-center justify-between text-xs">
            <strong>Part {i + 1}</strong>
            {parts.length > 2 && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove part ${i + 1}`}
                onClick={() => setParts((old) => old.filter((_, j) => j !== i))}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <Field>
            Amount
            <Input
              className="h-10"
              inputMode="decimal"
              aria-label={`Amount of part ${i + 1}`}
              value={p.amount}
              placeholder="0.00"
              onChange={(e) => change(i, { amount: e.target.value })}
            />
          </Field>
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between">
              <label htmlFor={`part-date-${i}`} className="text-[11px] text-muted-foreground">
                Date
              </label>
              {p.date && (
                <button
                  type="button"
                  className={linkButton}
                  aria-label={`Use the transaction's date for part ${i + 1}`}
                  onClick={() => change(i, { date: null })}
                >
                  Same as transaction
                </button>
              )}
            </div>
            <DatePicker
              id={`part-date-${i}`}
              value={p.date ?? txn.date}
              max={maxDate}
              onChange={(date) => change(i, { date: date === txn.date ? null : date })}
            />
          </div>
          <Field>
            Category
            <Select
              className="h-10"
              aria-label={`Category of part ${i + 1}`}
              value={p.category_id ?? ''}
              onChange={(e) =>
                change(i, { category_id: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">Uncategorized</option>
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
          </Field>
          <Field>
            Notes
            <Input
              className="h-10"
              aria-label={`Notes of part ${i + 1}`}
              value={p.notes}
              maxLength={2000}
              placeholder="Notes for this part"
              onChange={(e) => change(i, { notes: e.target.value })}
            />
          </Field>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={parts.length >= MAX_PARTS}
        onClick={() => setParts((old) => [...old, blank(left > 0 ? formatCents(left) : '')])}
      >
        <Plus size={14} />
        Add part
      </Button>
      <p
        className={cn('m-0 text-xs', problem ? 'text-warning' : 'text-positive')}
        aria-live="polite"
      >
        {problem ?? `All ${cash(total / 100)} is assigned`}
      </p>
      <div className="flex justify-end gap-2.5">
        {txn.splits.length > 0 && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Remove the split? The transaction goes back to one category.'))
                void run(() => api(url, undefined, 'DELETE'));
            }}
          >
            Remove split
          </Button>
        )}
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy || !!problem}
          onClick={() => void run(() => api(url, splitBody(txn.amount, parts), 'PUT'))}
        >
          Save split
        </Button>
      </div>
    </div>
  );
}
