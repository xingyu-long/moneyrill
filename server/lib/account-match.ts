export type KnownAccount = {
  id: string;
  provider_id: string;
  name: string;
  mask: string | null;
  kind: string;
  currency: string;
};
export type ReturnedAccount = {
  account_id: string;
  name: string;
  mask: string | null;
  kind: string;
  currency: string;
};

const key = (a: { name: string; mask: string | null; kind: string; currency: string }) =>
  [a.name.trim().toLowerCase(), (a.mask || '').trim(), a.kind, a.currency].join('|');

/**
 * Plaid gives an account a new id when it is removed and added back. Find the saved accounts the new ids
 * belong to: a returned id we have never seen, and a saved account Plaid no longer returns, with the same
 * name, last digits, type and currency. Only a one-to-one match counts and the last digits are required:
 * a wrong merge mixes two accounts' history, a missed one only leaves a duplicate. Returns new provider id -> saved account id.
 */
export function matchReturnedAccounts(known: KnownAccount[], returned: ReturnedAccount[]) {
  const knownIds = new Set(known.map((k) => k.provider_id));
  const returnedIds = new Set(returned.map((r) => r.account_id));
  const fresh = returned.filter((r) => !knownIds.has(r.account_id) && (r.mask || '').trim());
  const gone = known.filter((k) => !returnedIds.has(k.provider_id) && (k.mask || '').trim());
  const matches = new Map<string, string>();
  for (const f of fresh) {
    const candidates = gone.filter((g) => key(g) === key(f));
    const rivals = fresh.filter((o) => key(o) === key(f));
    if (candidates.length === 1 && rivals.length === 1) matches.set(f.account_id, candidates[0].id);
  }
  return matches;
}
