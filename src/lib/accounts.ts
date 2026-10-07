import type { Account, Balance, Holding } from '../types.ts';
import { number } from './format.ts';

/** Production shows real accounts only; staging shows either the demo set or everything else. */
export function visibleAccounts(accounts: Account[], production: boolean, dataset: string) {
  return accounts.filter((a) =>
    production
      ? a.source !== 'simulated' && a.source !== 'plaid_sandbox'
      : dataset === 'simulated'
        ? a.source === 'simulated'
        : a.source !== 'simulated',
  );
}

/** The balance of an account you keep by hand can be typed in; a provider's balance cannot. */
export const balanceEditable = (a: Account) => a.source === 'manual';

/** Holdings can be typed in only where the provider supplies none: a manual account, or a synced one whose latest holdings are empty. Mirrors the server. */
export function holdingsEditable(a: Account, holdings: Holding[]) {
  if (a.kind !== 'investment') return false;
  if (a.source === 'manual') return true;
  const synced = holdings.filter((h) => h.account_id === a.id && h.provenance !== 'manual');
  const latest = a.holdings_as_of || synced.reduce((m, h) => (h.date > m ? h.date : m), '');
  return !synced.some((h) => h.date === latest);
}

export function searchAccounts(accounts: Account[], search: string) {
  const needle = search.toLowerCase();
  return accounts.filter((a) => (a.name + ' ' + a.institution).toLowerCase().includes(needle));
}

export function lastBalanceDate(balances: Balance[]) {
  return (
    balances.reduce((m, b) => (b.date > m ? b.date : m), '') ||
    new Date().toISOString().slice(0, 10)
  );
}

/** Assets minus debts across included accounts. Brokerage balances already include holdings. */
export function summarizeNetWorth(included: Account[]) {
  const assets = included
    .filter((a) => ['investment', 'cash'].includes(a.kind))
    .reduce((s, a) => s + (number(a.balance) || 0), 0);
  const liabilities = included
    .filter((a) => ['credit', 'loan'].includes(a.kind))
    .reduce((s, a) => s + (number(a.balance) || 0), 0);
  return { assets, liabilities, net: assets - liabilities };
}
