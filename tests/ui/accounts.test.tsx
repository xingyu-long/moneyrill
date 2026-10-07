import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import App from '../../src/App.tsx';
import { overview, stubApi } from './fixture.ts';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(stubApi()));
});

/** The Accounts page with some accounts changed. */
function withAccounts(change: (accounts: any[]) => void) {
  const api = stubApi();
  const data = structuredClone(overview);
  change(data.accounts);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any) =>
      url.startsWith('/api/overview')
        ? { ok: true, status: 200, json: async () => structuredClone(data) }
        : api(url, init),
    ),
  );
  return data.accounts;
}

const row = (name: string) => screen.getByText(name, { exact: false }).closest('button')!;

describe('Accounts page', () => {
  it('has Add an account beside its heading, and the other pages do not', async () => {
    history.replaceState(null, '', '/accounts');
    const { unmount } = render(<App />);
    expect(await screen.findByRole('button', { name: 'Add an account' })).toBeInTheDocument();
    unmount();
    history.replaceState(null, '', '/home');
    render(<App />);
    expect(await screen.findByText(/where you stand/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add an account' })).toBeNull();
  });

  it('the net worth card has assets, liabilities, the note and the export link', async () => {
    render(<App />);
    const label = await screen.findByText('TOTAL NET WORTH');
    const card = label.closest('section')!;
    expect(within(card).getByText('Assets')).toBeInTheDocument();
    expect(within(card).getByText('Liabilities')).toBeInTheDocument();
    expect(within(card).getByText(/Assets minus debts/)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /Export account balances/ })).toHaveAttribute(
      'href',
      '/api/export.csv',
    );
    // the chart's range belongs to the same card; Private mode is in the top bar
    expect(within(card).getByRole('group', { name: 'Chart range' })).toBeInTheDocument();
  });

  it('an account whose sync failed says Reconnect; a disconnected one does not', async () => {
    const accounts = withAccounts((list) => {
      list[0].last_error = 'ITEM_LOGIN_REQUIRED';
      list[1].last_error = 'DISCONNECTED';
    });
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    const failing = row(accounts[0].name);
    expect(within(failing).getByText('Reconnect')).toBeInTheDocument();
    expect(within(failing).getByText('Sync needs attention')).toBeInTheDocument();
    const gone = row(accounts[1].name);
    expect(within(gone).queryByText('Reconnect')).toBeNull();
    expect(within(gone).getByText('Disconnected')).toBeInTheDocument();
  });

  it('an account that is fine has no Reconnect tag, and a click opens its page', async () => {
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    expect(screen.queryByText('Reconnect')).toBeNull();
    row(overview.accounts[0].name).click();
    await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(location.pathname).toBe(`/accounts/${overview.accounts[0].id}`);
  });
});
