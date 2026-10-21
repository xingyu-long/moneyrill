import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../../src/App.tsx';
import { MASK, setPrivateMode } from '../../src/lib/format.ts';
import { dividendActivity, overview, stubApi } from './fixture.ts';

beforeEach(() => {
  localStorage.clear();
  setPrivateMode(false);
  vi.stubGlobal('fetch', vi.fn(stubApi()));
});
afterEach(() => {
  localStorage.clear();
  setPrivateMode(false);
});

// A connection as the Settings page lists it.
const conn = (id: string, over: object) => ({
  id,
  institution: 'Test Bank',
  products: ['transactions'],
  last_error: null,
  disconnected_at: null,
  last_synced: '2026-10-03T12:00:00Z',
  created_at: '2026-09-01T12:00:00Z',
  consent_expires_at: null,
  ...over,
});
const title = () => screen.getByRole('heading', { level: 1 });
/** The line under the title. */
const sentence = () => title().nextElementSibling as HTMLElement;

async function open(path: string) {
  history.replaceState(null, '', path);
  render(<App />);
  await screen.findByRole('heading', { level: 1 });
}

describe('Page titles', () => {
  it('Home greets by the time of day; every other page is named', async () => {
    await open('/home');
    expect(title().textContent).toMatch(/^Good (morning|afternoon|evening)\.$/);
    expect(sentence()).toHaveTextContent("Here's where you stand today.");
  });

  it.each([
    ['/accounts', 'Accounts'],
    ['/investments', 'Investments'],
    ['/transactions', 'Transactions'],
    ['/reports/cash-flow', 'Reports'],
    ['/settings', 'Settings'],
  ])('%s is titled %s', async (path, name) => {
    await open(path);
    expect(title()).toHaveTextContent(new RegExp(`^${name}$`));
  });
});

describe('The sentence under the title', () => {
  it('Accounts: how many, and how recently they synced', async () => {
    await open('/accounts');
    expect(sentence().textContent).toMatch(/^\w+ accounts, all synced within the last \d+ days\.$/);
  });

  it('Investments: the portfolio value and its move', async () => {
    await open('/investments');
    await waitFor(() =>
      expect(sentence().textContent).toMatch(/^Your portfolio is worth \$[\d,]+/),
    );
    expect(sentence().textContent).toMatch(/\.$/);
  });

  it('Transactions: this month, what went out and came in, and what is still pending', async () => {
    await open('/transactions');
    await waitFor(() => expect(sentence().textContent).not.toBe(''));
    expect(sentence().textContent).toMatch(
      /^\d+\+ this month, \$2,651 out and \$4,200 in\. One is still pending\.$/,
    );
  });

  it('Transactions: brokerage activity is never counted in the sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(stubApi([], [dividendActivity])));
    await open('/transactions');
    await waitFor(() => expect(sentence().textContent).not.toBe(''));
    // three bank and card rows and a dividend come back: the sentence counts the three
    expect(sentence().textContent).toMatch(/^3\+ this month/);
  });

  it('Reports: the chosen range, what was earned and spent, and the share kept', async () => {
    await open('/reports/spending');
    await waitFor(() => expect(sentence().textContent).not.toBe(''));
    expect(sentence().textContent).toBe(
      'This year you earned $4,200 and spent $2,651. You kept 36.9%.',
    );
  });

  it('Reports follows the range and says so when filters are on', async () => {
    await open('/reports/spending?range=last-month&categories=1');
    await waitFor(() => expect(sentence().textContent).not.toBe(''));
    expect(sentence().textContent).toBe(
      'Last month your filters match $4,200 earned and $2,651 spent.',
    );
  });

  it('a category page has its own figures, so no sentence', async () => {
    await open('/reports/category/2?type=expense');
    expect(sentence().textContent).toBe('');
  });

  it('Settings: where the data stays, and a connection that needs a look', async () => {
    await open('/settings');
    expect(sentence().textContent).toBe('Everything stays on this machine, in your own database.');
  });

  it('Settings: names a connection that needs attention', async () => {
    const api = stubApi();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: any) =>
        url.startsWith('/api/overview')
          ? {
              ok: true,
              status: 200,
              json: async () => ({
                ...structuredClone(overview),
                connections: [
                  conn('c1', { last_error: 'ITEM_LOGIN_REQUIRED' }),
                  conn('c2', {}),
                  conn('c3', { last_error: 'old', disconnected_at: '2026-09-01' }),
                ],
              }),
            }
          : api(url, init),
      ),
    );
    await open('/settings');
    await waitFor(() =>
      expect(sentence().textContent).toMatch(/One connection needs your attention\.$/),
    );
  });

  it('Accounts: an account with a problem is named instead of claiming everything synced', async () => {
    const api = stubApi();
    const withError = structuredClone(overview);
    (withError.accounts[0] as { last_error: string | null }).last_error = 'ITEM_LOGIN_REQUIRED';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: any) =>
        url.startsWith('/api/overview')
          ? { ok: true, status: 200, json: async () => structuredClone(withError) }
          : api(url, init),
      ),
    );
    await open('/accounts');
    expect(sentence().textContent).toMatch(/^\w+ accounts\. One needs reconnecting\.$/);
  });
});

describe('Private mode', () => {
  it.each(['/accounts', '/investments', '/transactions', '/reports/spending', '/settings'])(
    'no amount appears in the title or sentence on %s',
    async (path) => {
      localStorage.setItem('moneyrill.private', '1');
      await open(path);
      // give the figures time to arrive: the sentence is empty or masked, never an amount
      await new Promise((r) => setTimeout(r, 150));
      const text = title().textContent! + sentence().textContent!;
      expect(text).not.toMatch(/\$/);
      if (/Transactions|spending|investments/.test(path))
        await waitFor(() => expect(sentence().textContent).toContain(MASK));
    },
  );
});
