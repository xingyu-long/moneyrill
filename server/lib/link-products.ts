// Plaid's recommended personal-finance flow keeps brokerage coverage while
// requesting investment consent without requiring every bank to support it.
export const accountLinkProducts = {
  products: ['transactions'],
  additional_consented_products: ['investments'],
};
// Reconnect (update mode) lets the owner add or remove accounts only when Account Select is enabled.
export const reconnectLinkOptions = { update: { account_selection_enabled: true } };
export const requestedAccountProducts = ['transactions', 'investments'];
export function productsForAccounts(requested: string[], accounts: { type: string }[]) {
  return requested.filter(
    (product) =>
      product !== 'investments' || accounts.some((account) => account.type === 'investment'),
  );
}
