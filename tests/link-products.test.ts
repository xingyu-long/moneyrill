import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountLinkProducts,
  requestedAccountProducts,
  productsForAccounts,
  reconnectLinkOptions,
} from '../server/lib/link-products.ts';
test('new account flow does not require a bank to support Investments', () => {
  assert.deepEqual(accountLinkProducts.products, ['transactions']);
  assert.deepEqual(accountLinkProducts.additional_consented_products, ['investments']);
});
test('holdings are enabled for investment accounts, not ordinary bank-only Items', () => {
  assert.deepEqual(
    productsForAccounts(requestedAccountProducts, [{ type: 'credit' }, { type: 'depository' }]),
    ['transactions'],
  );
  assert.deepEqual(productsForAccounts(requestedAccountProducts, [{ type: 'investment' }]), [
    'transactions',
    'investments',
  ]);
});
test('reconnect enables account selection so accounts can be added or removed', () => {
  assert.deepEqual(reconnectLinkOptions, { update: { account_selection_enabled: true } });
  // A new connection is not update mode.
  assert.equal('update' in accountLinkProducts, false);
});
