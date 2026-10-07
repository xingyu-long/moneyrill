type Account = { id: string; kind: string };
type Balance = { account_id: string; date: string; current_balance: string | null };

// Accounts enter history on their first snapshot; never backfill new accounts.
export function balanceHistory(
  accounts: Account[],
  balances: Balance[],
  from: string,
  signed: boolean,
) {
  const ids = new Set(accounts.map((a) => a.id));
  const rows = balances
    .filter((b) => ids.has(b.account_id))
    .sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set(rows.map((b) => b.date))].filter((date) => date >= from);
  const latest = new Map<string, string | null>();
  let cursor = 0;
  return dates.map((date) => {
    while (cursor < rows.length && rows[cursor].date <= date) {
      const b = rows[cursor++];
      latest.set(b.account_id, b.current_balance);
    }
    let total = 0,
      missing = 0;
    for (const account of accounts) {
      if (!latest.has(account.id)) continue;
      const balance = latest.get(account.id);
      if (balance == null) {
        missing++;
        continue;
      }
      total += Number(balance) * (signed && ['credit', 'loan'].includes(account.kind) ? -1 : 1);
    }
    return { date, value: missing ? null : total, missing };
  });
}
