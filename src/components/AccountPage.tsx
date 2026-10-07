import { Fragment, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { api } from '../api.ts';
import { Chart, Range, Trend } from './common.tsx';
import { HoldingsEditor } from './HoldingsEditor.tsx';
import { TransactionDrawer } from './TransactionDrawer.tsx';
import { TransactionGroups } from './TransactionGroups.tsx';
import { balanceEditable, holdingsEditable } from '../lib/accounts.ts';
import {
  cash,
  dateLabel,
  delta,
  isPrivate,
  MASK,
  number,
  pct,
  price,
  shares,
} from '../lib/format.ts';
import { buildHoldingRows } from '../lib/holdings.ts';
import { groupByDate } from '../lib/transactions.ts';
import { tabPath } from '../lib/routes.ts';
import { navigate } from '../state/router.ts';
import { useApp } from '../state/AppContext.tsx';
import { useCategories } from '../state/useCategories.ts';
import { useTransactions } from '../state/useTransactions.ts';
import type { Account } from '../types.ts';
import { Badge } from './ui/badge.tsx';
import { Button } from './ui/button.tsx';
import { Card } from './ui/card.tsx';
import { DetailList, EYEBROW, FORM, Field } from './ui/form.tsx';
import { Input } from './ui/input.tsx';
import { Switch } from './ui/switch.tsx';
import { Table, Td, Th } from './ui/table.tsx';
import { Fineprint } from './settings/SettingsCard.tsx';

const KIND: Record<string, string> = {
  cash: 'Cash',
  credit: 'Credit card',
  investment: 'Investment',
  loan: 'Loan',
};
const provider = (a: Account) =>
  a.source === 'plaid_production'
    ? 'Plaid'
    : a.source === 'plaid_sandbox'
      ? 'Plaid Sandbox'
      : a.source === 'simulated'
        ? 'Demo data'
        : a.source === 'manual'
          ? 'Entered by hand'
          : 'Imported';
const status = (a: Account) =>
  a.last_error === 'DISCONNECTED'
    ? 'Disconnected'
    : a.last_error === 'ACCOUNT_NOT_RETURNED'
      ? 'No longer shared by the bank'
      : a.last_error
        ? 'Sync needs attention'
        : a.source.startsWith('plaid_')
          ? 'Connected'
          : a.source === 'manual'
            ? 'No connection'
            : 'Not connected';

const back = (e: React.MouseEvent<HTMLAnchorElement>) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(tabPath('Accounts'));
};

function Transactions({ account }: { account: Account }) {
  const { data, setError } = useApp();
  const { categories } = useCategories();
  const list = useTransactions({ q: '', account: account.id, category: '' }, data.runs[0]?.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = list.rows.find((t) => t.id === openId) ?? null;
  const groups = groupByDate(list.rows);
  return (
    <>
      <Card aria-label="Transactions" className="overflow-hidden">
        <h2 className="m-0 border-b border-border px-5 py-4 text-base font-medium">Transactions</h2>
        {list.error && (
          <p className="m-0 px-[18px] py-7 text-xs text-muted-foreground">{list.error}</p>
        )}
        {!list.error && !list.loading && !groups.length && (
          <p className="m-0 px-[18px] py-7 text-xs text-muted-foreground">
            No transactions for this account yet.
          </p>
        )}
        <TransactionGroups groups={groups} onOpen={setOpenId} />
        {list.hasMore && (
          <div className="border-t border-border p-3.5 text-center">
            <Button variant="outline" onClick={() => void list.more()}>
              Load more
            </Button>
          </div>
        )}
      </Card>
      {open && (
        <TransactionDrawer
          txn={open}
          categories={categories}
          onClose={() => setOpenId(null)}
          onSaved={list.replace}
          onDeleted={list.remove}
          onError={setError}
        />
      )}
    </>
  );
}

function Holdings({ account, editable }: { account: Account; editable: boolean }) {
  const { data, start } = useApp();
  const [editing, setEditing] = useState(false);
  const rows = buildHoldingRows([account], data.holdings, start, data.prices);
  const total = rows.reduce((s, h) => s + (h.value ?? 0), 0);
  const priced = rows.reduce((m, h) => (h.priceDate && h.priceDate > m ? h.priceDate : m), '');
  const classes = [...new Set(rows.map((h) => h.asset_class))];
  const typedIn = data.holdings.filter(
    (h) => h.account_id === account.id && h.provenance === 'manual',
  );
  return (
    <Card aria-label="Holdings" className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="m-0 text-base font-medium">Holdings</h2>
        {editable && !editing && !isPrivate() && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            {typedIn.length ? 'Edit holdings' : 'Add holdings'}
          </Button>
        )}
      </div>
      {editing ? (
        <HoldingsEditor account={account} current={typedIn} onDone={() => setEditing(false)} />
      ) : rows.length ? (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Security</Th>
                <Th>Price</Th>
                <Th>Shares</Th>
                <Th>Value</Th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => (
                <Fragment key={c}>
                  <tr>
                    <Td
                      colSpan={4}
                      className="bg-muted/40 text-[10px] font-medium text-muted-foreground"
                    >
                      {c === 'Unreported' ? 'Not explained by holdings' : c}
                    </Td>
                  </tr>
                  {rows
                    .filter((h) => h.asset_class === c)
                    .map((h) => (
                      <tr key={h.security_id}>
                        <Td>
                          <strong className="block text-xs">{h.symbol || '—'}</strong>
                          <span className="mt-1 block text-[10px] font-normal text-muted-foreground">
                            {h.name}
                          </span>
                        </Td>
                        <Td>{price(h.price)}</Td>
                        <Td>{shares(h.quantity)}</Td>
                        <Td className="font-medium">{cash(h.value)}</Td>
                      </tr>
                    ))}
                </Fragment>
              ))}
              <tr>
                <Td className="font-medium">Total</Td>
                <Td />
                <Td />
                <Td className="font-medium">{cash(total)}</Td>
              </tr>
            </tbody>
          </Table>
          {priced && (
            <p className="m-0 border-t border-border px-5 py-3 text-[10px] text-muted-foreground">
              Prices are closing prices from Yahoo Finance (latest {dateLabel(priced)}), the same
              for every account. The balance above comes from your bank.
            </p>
          )}
        </>
      ) : (
        <p className="m-0 px-[18px] py-7 text-xs text-muted-foreground">
          No holdings for this account.
        </p>
      )}
    </Card>
  );
}

function BalanceForm({ account }: { account: Account }) {
  const { action, busy } = useApp();
  if (isPrivate()) return <Fineprint>Turn off private mode to edit this balance.</Fineprint>;
  return (
    <form
      className={FORM}
      onSubmit={(e) => {
        e.preventDefault();
        const value = new FormData(e.currentTarget).get('balance');
        void action(
          () => api('/accounts/' + encodeURIComponent(account.id), { balance: value }, 'PATCH'),
          'Balance saved and net worth recalculated',
        );
      }}
    >
      <Field>
        Update current balance
        <Input
          className="h-10"
          name="balance"
          type="number"
          step="0.01"
          required
          defaultValue={account.balance || '0'}
        />
      </Field>
      <Button disabled={busy}>Save balance</Button>
    </form>
  );
}

/** One account on its own page: balance and history, its transactions or holdings, and where the data comes from. */
export function AccountPage({ id }: { id: string }) {
  const { action, data, history, start } = useApp();
  const account = data.accounts.find((a) => a.id === id);
  if (!account)
    return (
      <Card className="p-6 text-xs">
        <a href={tabPath('Accounts')} onClick={back} className="text-positive">
          ← Accounts
        </a>
        <p className="mb-0 mt-4 text-muted-foreground">This account was not found.</p>
      </Card>
    );
  const points = history([account], start, false);
  const first = points.length > 1 ? (points[0]?.value ?? null) : null;
  const balance = number(account.balance);
  const adjustment = number(account.balance_adjustment) || 0;
  const canBalance = balanceEditable(account);
  const canHoldings = holdingsEditable(account, data.holdings);
  const invest = account.kind === 'investment';
  const count = buildHoldingRows([account], data.holdings, start, data.prices).filter(
    (h) => h.asset_class !== 'Unreported',
  ).length;
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-xs">
        <a
          href={tabPath('Accounts')}
          onClick={back}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={14} />
          Accounts
        </a>
        <span className="text-muted-foreground">/</span>
        <h2 className="m-0 text-sm font-medium">
          {account.name}
          {account.mask && <small className="ml-1 text-muted-foreground">…{account.mask}</small>}
        </h2>
      </nav>
      <Card className="mb-6 p-5">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className={EYEBROW}>CURRENT BALANCE</div>
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-4xl font-medium tracking-tight tabular-nums">
                {account.currency === 'USD'
                  ? cash(balance)
                  : isPrivate()
                    ? `${MASK} ${account.currency}`
                    : `${account.balance ?? '—'} ${account.currency}`}
              </span>
              {balance !== null && (
                <Trend value={pct(balance, first)} amount={delta(balance, first)} />
              )}
            </div>
            <p className="m-0 mt-1.5 text-[11px] text-muted-foreground">
              {account.balance_date
                ? `As of ${dateLabel(account.balance_date)}`
                : 'Balance unavailable'}
            </p>
            {adjustment !== 0 && balance !== null && (
              <p className="m-0 mt-1 text-[11px] text-muted-foreground">
                Your bank reported {cash(balance - adjustment)}; the holdings priced at the latest
                closes add {adjustment > 0 ? '+' : '−'}
                {cash(Math.abs(adjustment))}.
              </p>
            )}
          </div>
          <Range />
        </div>
        <Chart points={points} />
      </Card>
      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-6 max-[1150px]:grid-cols-1">
        {invest ? (
          <Holdings account={account} editable={canHoldings} />
        ) : (
          <Transactions account={account} />
        )}
        <div className="grid gap-6">
          <Card aria-label="Summary" className="p-5">
            <h2 className="m-0 mb-1 text-base font-medium">Summary</h2>
            <DetailList
              rows={[
                ['Institution', account.institution],
                ['Account type', KIND[account.kind] ?? account.kind],
                ['Currency', account.currency],
                ...(invest ? ([['Total holdings', count]] as [string, number][]) : []),
                [
                  'Include in net worth',
                  <Switch
                    key="included"
                    aria-label="Include in net worth"
                    checked={account.included}
                    onCheckedChange={(included) =>
                      void action(
                        () =>
                          api('/accounts/' + encodeURIComponent(account.id), { included }, 'PATCH'),
                        'Net worth recalculated',
                      )
                    }
                  />,
                ],
              ]}
            />
          </Card>
          <Card aria-label="Connection status" className="p-5">
            <h2 className="m-0 mb-1 text-base font-medium">Connection status</h2>
            <DetailList
              rows={[
                [
                  'Last update',
                  account.last_synced ? new Date(account.last_synced).toLocaleString() : '—',
                ],
                [
                  'Status',
                  <Badge key="status" variant={account.last_error ? 'danger' : 'success'}>
                    {status(account)}
                  </Badge>,
                ],
                ['Data provider', provider(account)],
              ]}
            />
          </Card>
          {(canBalance || canHoldings) && (
            <Card aria-label="Edit account" className="p-5">
              <h2 className="m-0 mb-2 text-base font-medium">Edit this account</h2>
              <Fineprint className="mb-4">
                {canBalance
                  ? 'You keep this account by hand, so you can change its balance.'
                  : 'The bank sends no holdings for this account, so you can enter them yourself. Its balance still comes from the bank.'}
              </Fineprint>
              {canBalance && <BalanceForm account={account} />}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
