import type { ReportFilters } from './FiltersPopover.tsx';

/** What every report is about: a date range (none = all time) and the accounts and categories chosen. */
export type Scope = {
  from?: string;
  to?: string;
  today?: string;
  /** One merchant, on a merchant's history page. */
  merchant?: string;
} & ReportFilters;

/** The same scope as report query parameters. */
export const scopeParams = (s: Scope): Record<string, string | undefined> => ({
  from: s.from,
  to: s.to,
  categories: s.categories.length ? s.categories.join(',') : undefined,
  accounts: s.accounts.length ? s.accounts.join(',') : undefined,
  today: s.today,
  merchant: s.merchant,
});
