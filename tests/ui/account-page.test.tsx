import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { setPrivateMode } from '../../src/lib/format.ts';
import { overview, stubApi } from './fixture.ts';

let calls: { url: string; method: string; body: any }[] = [];
// The fixture portfolio, plus a manual account and a synced brokerage that came with no holdings.
function serve(extraAccounts: any[] = [], extra: any = {}) {
  const base = stubApi(calls);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any = {}) => {
      if (url.startsWith('/api/overview')) {
        const o: any = structuredClone(overview);
        o.accounts.push(...extraAccounts);
        Object.assign(o, extra);
        return { ok: true, status: 200, json: async () => o };
      }
      if (url.endsWith('/holdings') || /^\/api\/accounts\//.test(url)) {
        calls.push({ url, method: init.method || 'GET', body: JSON.parse(init.body) });
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return base(url, init);
    }),
  );
}
const manual = {
  id: 'handmade',
  name: '401(k) by hand',
  institution: 'Manual account',
  kind: 'cash',
  currency: 'USD',
  mask: '',
  included: true,
  source: 'manual',
  balance: '900',
  balance_date: '2026-10-03',
  last_synced: '2026-10-03T12:00:00Z',
  last_error: null,
  provider_as_of: null,
  holdings_as_of: null,
};
async function open(id: string) {
  history.replaceState(null, '', '/accounts/' + id);
  render(<App />);
  await screen.findByRole('navigation', { name: 'Breadcrumb' });
}

beforeEach(() => {
  localStorage.clear();
  setPrivateMode(false);
  calls = [];
  serve([manual]);
});

describe('Account page', () => {
  it('opens from the account list and goes back to it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    await user.click(screen.getByRole('button', { name: /Everyday checking/ }));
    expect(location.pathname).toBe('/accounts/checking');
    const crumb = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumb).getByText(/Everyday checking/)).toBeInTheDocument();
    expect(screen.getByText('CURRENT BALANCE')).toBeInTheDocument();
    expect(screen.getAllByText('$500.00').length).toBeGreaterThan(0);
    await user.click(within(crumb).getByRole('link', { name: /Accounts/ }));
    expect(location.pathname).toBe('/accounts');
    await screen.findByText('TOTAL NET WORTH');
  });

  it('a bank account shows its transactions, a summary and the connection status', async () => {
    await open('checking');
    expect(screen.getByRole('region', { name: 'Transactions' })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('Test Bank')).toBeInTheDocument();
    expect(within(summary).getByText('Cash')).toBeInTheDocument();
    const status = screen.getByRole('region', { name: 'Connection status' });
    expect(within(status).getByText('Demo data')).toBeInTheDocument();
  });

  it('a brokerage shows its holdings grouped by type, with a total', async () => {
    await open('roth');
    const holdings = screen.getByRole('region', { name: 'Holdings' });
    expect(within(holdings).getByText('VTI')).toBeInTheDocument();
    expect(within(holdings).getByText('Cash')).toBeInTheDocument();
    expect(within(holdings).getByText('$700.00')).toBeInTheDocument(); // 550 + 150
    expect(
      within(screen.getByRole('region', { name: 'Summary' })).getByText('2'),
    ).toBeInTheDocument();
  });

  it('an account whose holdings were synced cannot be edited', async () => {
    await open('roth');
    expect(screen.queryByRole('region', { name: 'Edit account' })).toBeNull();
    expect(screen.queryByRole('button', { name: /holdings/i })).toBeNull();
  });

  it('a synced bank balance cannot be edited either', async () => {
    await open('checking');
    expect(screen.queryByRole('region', { name: 'Edit account' })).toBeNull();
    expect(screen.queryByLabelText('Update current balance')).toBeNull();
  });

  it('the balance of an account you keep by hand can be changed', async () => {
    const user = userEvent.setup();
    await open('handmade');
    const edit = screen.getByRole('region', { name: 'Edit account' });
    const input = within(edit).getByLabelText('Update current balance');
    await user.clear(input);
    await user.type(input, '950.50');
    await user.click(within(edit).getByRole('button', { name: 'Save balance' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'PATCH' && c.url === '/api/accounts/handmade')?.body,
      ).toEqual({
        balance: '950.5',
      }),
    );
  });

  it('a brokerage with no synced holdings can get holdings typed in, and they are sent as a list', async () => {
    const user = userEvent.setup();
    await open('empty');
    expect(screen.getByText('Not explained by holdings')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add holdings' }));
    const save = screen.getByRole('button', { name: 'Save holdings' });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('Symbol 1'), 'voo');
    await user.type(screen.getByLabelText('Name 1'), 'Vanguard S&P 500');
    await user.type(screen.getByLabelText('Shares 1'), '2.5');
    await user.type(screen.getByLabelText('Price 1'), '100');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.url === '/api/accounts/empty/holdings');
      expect(put?.body).toEqual({
        holdings: [
          {
            symbol: 'voo',
            name: 'Vanguard S&P 500',
            asset_class: 'Equities',
            quantity: '2.5',
            price: '100',
          },
        ],
      });
    });
  });

  it('holdings cannot be saved with a missing name or a zero quantity', async () => {
    const user = userEvent.setup();
    await open('empty');
    await user.click(screen.getByRole('button', { name: 'Add holdings' }));
    await user.type(screen.getByLabelText('Name 1'), 'Something');
    await user.type(screen.getByLabelText('Shares 1'), '0');
    await user.type(screen.getByLabelText('Price 1'), '10');
    expect(screen.getByRole('button', { name: 'Save holdings' })).toBeDisabled();
  });

  it('an account that does not exist says so, with a way back', async () => {
    history.replaceState(null, '', '/accounts/nope');
    render(<App />);
    await screen.findByText('This account was not found.');
    expect(screen.getByRole('link', { name: '← Accounts' })).toHaveAttribute('href', '/accounts');
  });

  it('private mode hides the balance, and the editors with it', async () => {
    localStorage.setItem('moneyrill.private', '1'); // the app reads the setting on this device
    await open('handmade');
    expect(screen.queryByText('$900.00')).toBeNull();
    expect(screen.getByText('Turn off private mode to edit this balance.')).toBeInTheDocument();
  });

  it('a synced brokerage shows each ticker at the downloaded close, with a note saying so', async () => {
    const synced = {
      ...manual,
      id: 'synced',
      name: 'Brokerage (synced)',
      kind: 'investment',
      source: 'plaid_production',
      balance: '4000',
      holdings_as_of: '2026-10-03',
    };
    const held = (symbol: string, price: string, value: string) => ({
      account_id: 'synced',
      security_id: 'synced:' + symbol,
      date: '2026-10-03',
      quantity: '10',
      price,
      value,
      cost_basis: null,
      symbol,
      name: symbol + ' fund',
      asset_class: 'Equities',
      provenance: 'plaid_production',
    });
    serve([synced], {
      holdings: [...overview.holdings, held('VOO', '400', '4000')],
      prices: [
        { symbol: 'VOO', date: '2026-10-01', close: '395' },
        { symbol: 'VOO', date: '2026-10-03', close: '410' },
      ],
    });
    await open('synced');
    const holdings = screen.getByRole('region', { name: 'Holdings' });
    expect(within(holdings).getByText('$410.00')).toBeInTheDocument(); // the close, not the bank's $400
    expect(within(holdings).getAllByText('$4,100.00')).toHaveLength(2); // the row and the total
    expect(within(holdings).queryByText('$400.00')).toBeNull();
    expect(
      within(holdings).getByText(/closing prices from Yahoo Finance \(latest Oct 3\)/),
    ).toBeInTheDocument();
    // the bank's own values explain the balance, so no unreported row appears
    expect(within(holdings).queryByText('Unreported account value')).toBeNull();
  });

  it('the demo accounts keep their own prices and show no market-price note', async () => {
    serve([manual], {
      prices: [{ symbol: 'VTI', date: '2026-10-03', close: '999' }],
    });
    await open('roth');
    const holdings = screen.getByRole('region', { name: 'Holdings' });
    expect(within(holdings).queryByText('$999.00')).toBeNull();
    expect(within(holdings).queryByText(/Yahoo Finance/)).toBeNull();
  });

  it('a balance priced at the latest closes adds up with the holdings and says how it got there', async () => {
    const synced = {
      ...manual,
      id: 'priced',
      name: 'Brokerage (priced)',
      kind: 'investment',
      source: 'plaid_production',
      balance: '4100', // the bank said 4000; the holdings at the close are worth 100 more
      balance_adjustment: '100',
      holdings_as_of: '2026-10-03',
    };
    serve([synced], {
      holdings: [
        ...overview.holdings,
        {
          account_id: 'priced',
          security_id: 'priced:VOO',
          date: '2026-10-03',
          quantity: '10',
          price: '400',
          value: '4000',
          cost_basis: null,
          symbol: 'VOO',
          name: 'VOO fund',
          asset_class: 'Equities',
          provenance: 'plaid_production',
        },
      ],
      prices: [{ symbol: 'VOO', date: '2026-10-03', close: '410' }],
    });
    await open('priced');
    const holdings = screen.getByRole('region', { name: 'Holdings' });
    expect(within(holdings).getAllByText('$4,100.00')).toHaveLength(2); // the row and the total
    expect(within(holdings).queryByText('Unreported account value')).toBeNull();
    expect(
      screen.getByText(
        /Your bank reported \$4,000\.00; the holdings priced at the latest closes add \+\$100\.00/,
      ),
    ).toBeInTheDocument();
  });

  it('with no adjustment there is no note', async () => {
    await open('roth');
    expect(screen.queryByText(/Your bank reported/)).toBeNull();
  });
});
