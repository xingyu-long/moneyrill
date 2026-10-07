import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { isPrivate } from '../lib/format.ts';
import type { Account, Transaction } from '../types.ts';
import { accountLabel, validAmount } from './AddTransactionModal.tsx';
import { Button } from './ui/button.tsx';
import { Callout, FIELD_BOX, Field } from './ui/form.tsx';
import { Input } from './ui/input.tsx';
import { Select } from './ui/select.tsx';
import { Fineprint } from './settings/SettingsCard.tsx';

const direction = (t: Transaction) => (Number(t.amount) < 0 ? 'in' : 'out');
const magnitude = (t: Transaction) => Math.abs(Number(t.amount)).toFixed(2);

/** What only a transaction you added can change: its description, amount, direction and account. */
export function ManualFields({
  txn,
  accounts,
  onSaved,
  onError,
}: {
  txn: Transaction;
  accounts: Account[];
  onSaved: (t: Transaction) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(txn.name);
  const [dir, setDir] = useState(direction(txn));
  const [amount, setAmount] = useState(magnitude(txn));
  const [accountId, setAccountId] = useState(txn.account_id);
  useEffect(() => {
    setName(txn.name);
    setDir(direction(txn));
    setAmount(magnitude(txn));
    setAccountId(txn.account_id);
  }, [txn.id, txn.name, txn.amount, txn.account_id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (isPrivate())
    return <Fineprint>Turn off Private mode to change this transaction's amount.</Fineprint>;

  const body: Record<string, unknown> = {};
  if (name.trim() !== txn.name) body.name = name;
  if (accountId !== txn.account_id) body.account_id = accountId;
  if (dir !== direction(txn) || amount.trim() !== magnitude(txn)) {
    body.direction = dir;
    body.amount = amount.trim();
  }
  const changed = Object.keys(body).length > 0;
  const valid = name.trim().length > 0 && validAmount(amount);
  return (
    <div className={FIELD_BOX} role="group" aria-label="Details you entered">
      <Field>
        Description
        <Input
          className="h-10"
          value={name}
          maxLength={200}
          aria-label="Description"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field>
          Money
          <Select
            className="h-10"
            aria-label="Money in or out"
            value={dir}
            onChange={(e) => setDir(e.target.value as 'in' | 'out')}
          >
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </Select>
        </Field>
        <Field>
          Amount
          <Input
            className="h-10"
            inputMode="decimal"
            aria-label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
      </div>
      <Field>
        Account
        <Select
          className="h-10"
          aria-label="Account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {accountLabel(a)}
            </option>
          ))}
        </Select>
      </Field>
      {changed && !valid && (
        <Callout>A description and a positive amount with at most two decimals are needed.</Callout>
      )}
      <Button
        type="button"
        disabled={!changed || !valid}
        onClick={async () => {
          try {
            onSaved(await api('/transactions/' + encodeURIComponent(txn.id), body, 'PATCH'));
            onError('');
          } catch (e: any) {
            onError(e.message);
          }
        }}
      >
        Save changes
      </Button>
    </div>
  );
}
