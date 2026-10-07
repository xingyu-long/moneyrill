import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { setPrivateMode } from '../../src/lib/format.ts';
import { manualTransaction, stubApi } from './fixture.ts';

let calls: { url: string; method: string; body: any }[] = [];
async function openTransactions(extra: any[] = []) {
  localStorage.clear();
  setPrivateMode(false);
  calls = [];
  vi.stubGlobal('fetch', vi.fn(stubApi(calls, extra)));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText('TOTAL NET WORTH');
  await user.click(
    within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
      name: /Transactions/,
    }),
  );
  await screen.findByText('Whole Market');
  return user;
}
const writes = (method: string) =>
  calls.filter((c) => c.method === method && c.url.startsWith('/api/transactions'));
async function openDialog() {
  const user = await openTransactions();
  await user.click(screen.getByRole('button', { name: 'Add transaction' }));
  return { user, dialog: await screen.findByRole('dialog', { name: 'Add transaction' }) };
}

describe('Add transaction', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('records money in, with the account, date, amount, description, category and notes', async () => {
    const { user, dialog } = await openDialog();
    const submit = within(dialog).getByRole('button', { name: 'Add transaction' });
    expect(submit).toBeDisabled(); // nothing entered yet
    // any account can be chosen, including an investment account
    const options = within(within(dialog).getByLabelText('Account')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toContain('Individual brokerage (…rage) · Test Bank');
    await user.selectOptions(within(dialog).getByLabelText('Account'), 'brokerage');
    await user.type(within(dialog).getByLabelText('Amount'), '12500');
    expect(submit).toBeDisabled(); // a description is still needed
    await user.type(within(dialog).getByLabelText('Description'), '  RSU vest AVGO  ');
    await user.selectOptions(within(dialog).getByLabelText('Category'), '3');
    await user.type(within(dialog).getByLabelText('Notes'), 'Q3 vest');
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(writes('POST')).toHaveLength(1));
    expect(writes('POST')[0].body).toEqual({
      account_id: 'brokerage',
      date: new Date().toLocaleDateString('en-CA'),
      amount: '12500',
      direction: 'in', // money in is the default for the things people add by hand
      name: '  RSU vest AVGO  ',
      category_id: 3,
      notes: 'Q3 vest',
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Add transaction' })).toBeNull(),
    );
    // the list reloads so the new transaction shows
    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/transactions?')).length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it('records money out', async () => {
    const { user, dialog } = await openDialog();
    expect(within(dialog).getByRole('button', { name: 'Money in' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Money out' }));
    expect(within(dialog).getByRole('button', { name: 'Money out' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.selectOptions(within(dialog).getByLabelText('Account'), 'checking');
    await user.type(within(dialog).getByLabelText('Amount'), '40.50');
    await user.type(within(dialog).getByLabelText('Description'), 'Cash for the plumber');
    await user.click(within(dialog).getByRole('button', { name: 'Add transaction' }));
    await waitFor(() =>
      expect(writes('POST')[0]?.body).toMatchObject({
        direction: 'out',
        amount: '40.50',
        category_id: null,
      }),
    );
  });

  it('only accepts a positive amount with at most two decimals', async () => {
    const { user, dialog } = await openDialog();
    await user.selectOptions(within(dialog).getByLabelText('Account'), 'brokerage');
    await user.type(within(dialog).getByLabelText('Description'), 'x');
    const amount = within(dialog).getByLabelText('Amount');
    const submit = within(dialog).getByRole('button', { name: 'Add transaction' });
    for (const bad of ['abc', '0', '-5', '1.234', '1,000', '1e3']) {
      await user.clear(amount);
      await user.type(amount, bad);
      expect(submit, bad).toBeDisabled();
      expect(
        within(dialog).getByText(/positive amount with at most two decimals/),
      ).toBeInTheDocument();
    }
    for (const good of ['1', '0.01', '12500', '40.5', '999999999999.99']) {
      await user.clear(amount);
      await user.type(amount, good);
      expect(submit, good).toBeEnabled();
    }
  });

  it('can be closed without saving: X, Cancel, and a click outside', async () => {
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText('Description'), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Close Add transaction' }));
    expect(screen.queryByRole('dialog', { name: 'Add transaction' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Add transaction' })).getByRole('button', {
        name: 'Cancel',
      }),
    );
    expect(screen.queryByRole('dialog', { name: 'Add transaction' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    await user.click(
      (await screen.findByRole('dialog', { name: 'Add transaction' })).parentElement!,
    );
    expect(screen.queryByRole('dialog', { name: 'Add transaction' })).toBeNull();
    expect(writes('POST')).toEqual([]);
  });

  it("shows the server's reason when it is refused", async () => {
    localStorage.clear();
    calls = [];
    const base = stubApi(calls);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: any = {}) =>
        url === '/api/transactions' && init.method === 'POST'
          ? { ok: false, status: 400, json: async () => ({ error: 'Unknown account' }) }
          : base(url, init),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    await user.click(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
        name: /Transactions/,
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Add transaction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add transaction' });
    await user.selectOptions(within(dialog).getByLabelText('Account'), 'brokerage');
    await user.type(within(dialog).getByLabelText('Amount'), '5');
    await user.type(within(dialog).getByLabelText('Description'), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Add transaction' }));
    expect(await screen.findByText('Unknown account')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add transaction' })).toBeInTheDocument(); // stays open
  });

  it('points to adding a manual account for a 401(k) that is not connected', async () => {
    const { user, dialog } = await openDialog();
    await user.click(
      within(dialog).getByRole('button', { name: /Add a manual account for your 401\(k\)/ }),
    );
    expect(await screen.findByRole('heading', { name: 'Add an account' })).toBeInTheDocument();
  });

  it('is not available in Private mode, because it needs the amounts', async () => {
    const user = await openTransactions();
    await user.click(screen.getByRole('button', { name: /Private mode/ }));
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add transaction' });
    expect(
      within(dialog).getByText(/Turn off Private mode to add a transaction/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Amount')).toBeNull();
  });
});

describe('A transaction you added', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('is marked Manual in the list and can be edited: description, amount, direction, account', async () => {
    const user = await openTransactions([manualTransaction]);
    const row = (await screen.findByText('RSU vest AVGO')).closest('button')!;
    expect(within(row).getByText('Manual')).toBeInTheDocument();
    expect(within(row).getByText('+$12,500.00')).toBeInTheDocument(); // money in
    await user.click(row);
    const drawer = await screen.findByRole('dialog', { name: 'RSU vest AVGO' });
    expect(within(drawer).getByText('Added by you')).toBeInTheDocument();
    expect(within(drawer).queryByText('Original statement')).toBeNull();
    const fields = within(drawer).getByRole('group', { name: 'Details you entered' });
    const save = within(fields).getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled(); // nothing changed yet
    expect(within(fields).getByLabelText('Amount')).toHaveValue('12500.00');
    expect(within(fields).getByLabelText('Money in or out')).toHaveValue('in');
    const amount = within(fields).getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '13000');
    await user.clear(within(fields).getByLabelText('Description'));
    await user.type(within(fields).getByLabelText('Description'), 'RSU vest (updated)');
    await user.selectOptions(within(fields).getByLabelText('Account'), 'roth');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(writes('PATCH')[0]).toBeTruthy());
    expect(writes('PATCH')[0].url).toBe('/api/transactions/t7');
    expect(writes('PATCH')[0].body).toEqual({
      name: 'RSU vest (updated)',
      account_id: 'roth',
      direction: 'in',
      amount: '13000',
    });
    // date, category and notes still work like any other transaction
    expect(within(drawer).getByLabelText('Notes')).toHaveValue('Q3 vest');
  });

  it('changing only the direction sends the amount with it', async () => {
    const user = await openTransactions([manualTransaction]);
    await user.click((await screen.findByText('RSU vest AVGO')).closest('button')!);
    const fields = within(await screen.findByRole('dialog', { name: 'RSU vest AVGO' })).getByRole(
      'group',
      { name: 'Details you entered' },
    );
    await user.selectOptions(within(fields).getByLabelText('Money in or out'), 'out');
    await user.click(within(fields).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(writes('PATCH')[0]?.body).toEqual({ direction: 'out', amount: '12500.00' }),
    );
  });

  it('can be deleted after asking, and not otherwise', async () => {
    const user = await openTransactions([manualTransaction]);
    await user.click((await screen.findByText('RSU vest AVGO')).closest('button')!);
    const drawer = await screen.findByRole('dialog', { name: 'RSU vest AVGO' });
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    await user.click(within(drawer).getByRole('button', { name: 'Delete transaction' }));
    expect(confirm.mock.calls[0][0]).toMatch(/Delete "RSU vest AVGO"\? This cannot be undone/);
    expect(writes('DELETE')).toEqual([]);
    await user.click(within(drawer).getByRole('button', { name: 'Delete transaction' }));
    await waitFor(() => expect(writes('DELETE')[0]?.url).toBe('/api/transactions/t7'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'RSU vest AVGO' })).toBeNull());
    expect(screen.queryByText('RSU vest AVGO')).toBeNull(); // gone from the list
  });

  it("the bank's own transactions have no description, amount or delete to change", async () => {
    const user = await openTransactions();
    await user.click((await screen.findByText('ZELLE TO LANDLORD')).closest('button')!);
    const drawer = await screen.findByRole('dialog', { name: 'ZELLE TO LANDLORD' });
    expect(within(drawer).getByText('Original statement')).toBeInTheDocument();
    expect(within(drawer).queryByRole('group', { name: 'Details you entered' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Delete transaction' })).toBeNull();
    expect(within(drawer).queryByLabelText('Amount')).toBeNull();
    expect(screen.queryByText('Manual')).toBeNull();
  });

  it('hides the amount fields in Private mode', async () => {
    const user = await openTransactions([manualTransaction]);
    await user.click(screen.getByRole('button', { name: /Private mode/ }));
    await user.click((await screen.findByText('RSU vest AVGO')).closest('button')!);
    const drawer = await screen.findByRole('dialog', { name: 'RSU vest AVGO' });
    expect(
      within(drawer).getByText(/Turn off Private mode to change this transaction's amount/),
    ).toBeInTheDocument();
    expect(within(drawer).queryByLabelText('Amount')).toBeNull();
  });
});
