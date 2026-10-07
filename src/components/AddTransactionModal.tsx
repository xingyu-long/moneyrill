import { useState } from 'react';
import { api } from '../api.ts';
import { addDays, todayIso } from '../lib/calendar.ts';
import { isPrivate } from '../lib/format.ts';
import { groupCategories } from '../lib/transactions.ts';
import type { Account, Category, Transaction } from '../types.ts';
import { DatePicker } from './DatePicker.tsx';
import { Button, mutedLinkButton } from './ui/button.tsx';
import { Dialog } from './ui/dialog.tsx';
import { Callout, FORM, Field, Textarea } from './ui/form.tsx';
import { Input } from './ui/input.tsx';
import { Segmented } from './ui/segmented.tsx';
import { Select } from './ui/select.tsx';
import { Fineprint } from './settings/SettingsCard.tsx';

/** A positive amount with at most two decimals, like 12500 or 40.50. */
export const validAmount = (text: string) =>
  /^\d{1,12}(\.\d{1,2})?$/.test(text.trim()) && Number(text) > 0;

export const accountLabel = (a: Pick<Account, 'name' | 'mask' | 'institution'>) =>
  `${a.name}${a.mask ? ` (…${a.mask})` : ''} · ${a.institution}`;

type Props = {
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
  onAdded: (t: Transaction) => void;
  onError: (message: string) => void;
  /** Open the "add manual account" dialog, for a 401(k) or equity account that is not connected. */
  onNewAccount: () => void;
};

/** Record a transaction by hand: an RSU vest, a 401(k) contribution, cash, anything the bank does not report. */
export function AddTransactionModal({
  accounts,
  categories,
  onClose,
  onAdded,
  onError,
  onNewAccount,
}: Props) {
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = !!accountId && validAmount(amount) && name.trim().length > 0;
  async function submit() {
    setBusy(true);
    try {
      const added: Transaction = await api('/transactions', {
        account_id: accountId,
        date,
        amount: amount.trim(),
        direction,
        name,
        category_id: categoryId ? Number(categoryId) : null,
        notes,
      });
      onAdded(added);
      onError('');
      onClose();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Add transaction" onClose={onClose}>
      {isPrivate() ? (
        <Fineprint>Turn off Private mode to add a transaction.</Fineprint>
      ) : (
        <form
          className={FORM}
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) void submit();
          }}
        >
          <Segmented
            label="Money in or out"
            options={['in', 'out'] as const}
            value={direction}
            onChange={setDirection}
            render={(d) => (d === 'in' ? 'Money in' : 'Money out')}
          />
          <Field>
            Account
            <Select
              className="h-10"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Choose an account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a)}
                </option>
              ))}
            </Select>
          </Field>
          <button type="button" className={mutedLinkButton} onClick={onNewAccount}>
            Not listed? Add a manual account for your 401(k) or equity awards
          </button>
          <div className="grid gap-2">
            <label htmlFor="add-date" className="text-[11px] text-muted-foreground">
              Date
            </label>
            <DatePicker
              id="add-date"
              value={date}
              max={addDays(todayIso(), 365)}
              onChange={setDate}
            />
          </div>
          <Field>
            Amount
            <Input
              className="h-10"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field>
            Description
            <Input
              className="h-10"
              placeholder="For example: RSU vest, 401(k) contribution"
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field>
            Category
            <Select
              className="h-10"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
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
            <Textarea
              rows={3}
              maxLength={2000}
              placeholder="Optional"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          {amount.trim() !== '' && !validAmount(amount) && (
            <Callout>
              Enter a positive amount with at most two decimals, like 12500 or 40.50.
            </Callout>
          )}
          <div className="flex justify-end gap-2.5">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!ready || busy}>Add transaction</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
