import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';

// One brokerage: 1,000 at the end of 2025, 1,100 on Jan 31, then 100 is deposited on Feb 10 and it ends at 1,300.
const overview = {
  accounts: [
    {
      id: 'brokerage',
      name: 'Individual brokerage',
      institution: 'Test Bank',
      kind: 'investment',
      currency: 'USD',
      mask: '0001',
      included: true,
      source: 'simulated',
      balance: '1300',
      balance_date: '2026-02-15',
      last_synced: '2026-02-15T12:00:00Z',
      last_error: null,
      provider_as_of: null,
      holdings_as_of: null,
    },
  ],
  balances: [
    ['2025-12-31', '1000'],
    ['2026-01-31', '1100'],
    ['2026-02-15', '1300'],
  ].map(([date, current_balance]) => ({
    account_id: 'brokerage',
    date,
    current_balance,
    provenance: 'simulated',
  })),
  holdings: [],
  benchmarks: [],
  connections: [],
  runs: [],
  mode: 'sandbox',
  environment: 'staging',
  hasSandboxKeys: false,
  hasPlaidKeys: false,
};

const calls: { url: string; method: string; body?: any }[] = [];

function serve(flows: unknown) {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body && JSON.parse(init.body) });
      if (url === '/api/investments/cash-flows-from')
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      if (url === '/api/investments/cash-flows')
        return flows === null
          ? { ok: false, status: 500, json: async () => ({ error: 'no' }) }
          : { ok: true, status: 200, json: async () => flows };
      return { ok: true, status: 200, json: async () => structuredClone(overview) };
    }),
  );
}

async function openMarket() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText('TOTAL NET WORTH');
  await user.click(
    within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
      name: /Investments/,
    }),
  );
  await screen.findByText('Portfolio value · all investment accounts');
  return user;
}

// 100 was added on Feb 10 (the balance went 1,000 -> 1,100 -> 1,300, so 100 of the second month's rise is the deposit).
const record = { flows: [{ date: '2026-02-10', amount: '100' }] };

describe('Portfolio return', () => {
  it('takes the deposit out: the return, the gain and what was contributed', async () => {
    serve(record);
    await openMarket();
    // The balance grew 30% (1,000 to 1,300), but 100 of that was a deposit.
    expect(await screen.findByText('YTD return')).toBeInTheDocument();
    const card = screen.getByText('YTD return').closest('section')!;
    expect(within(card).getByText('+19.7%')).toBeInTheDocument();
    expect(within(card).getByText('+$200.00')).toBeInTheDocument();
    expect(within(card).getByText('Contributed').querySelector('b')).toHaveTextContent('$100.00');
    expect(within(card).queryByText(/30\.0%/)).toBeNull();
  });

  it('says where the return is counted from and the balance then, and why the range was cut', async () => {
    serve(record);
    await openMarket();
    const line = await screen.findByTestId('counted-from');
    expect(line).toHaveTextContent('Counted from Dec 31, 2025 · opening balance $1,000.00');
    expect(line.textContent).not.toMatch(/\(/);
  });

  it('when the cash flows are known only from Feb 1 the span opens Jan 31 with its balance, and says why', async () => {
    serve({ ...record, from: '2026-02-01' });
    await openMarket();
    const cut = await screen.findByTestId('counted-from');
    expect(cut).toHaveTextContent('Counted from Jan 31, 2026 · opening balance $1,100.00');
    expect(cut).toHaveTextContent('cash flows are known from the day after');
  });

  it('when the cash flows cannot be loaded it says value change, and has no Contributed', async () => {
    serve(null);
    await openMarket();
    const label = await screen.findByText('YTD value change');
    const card = label.closest('section')!;
    expect(within(card).queryByText('Contributed')).toBeNull();
    // the balance went from 1,100 (the first one in the range) to 1,300, deposits included
    expect(within(card).getByText('+18.2%')).toBeInTheDocument();
    expect(within(card).getByText('+$200.00')).toBeInTheDocument();
  });

  it('the amounts follow Private mode; the percentage stays', async () => {
    serve(record);
    localStorage.setItem('moneyrill.private', '1');
    await openMarket();
    const card = (await screen.findByText('YTD return')).closest('section')!;
    expect(card.textContent).not.toMatch(/\$/);
    expect(screen.getByTestId('counted-from')).toHaveTextContent('opening balance ••••••');
    expect(within(card).getByText('+19.7%')).toBeInTheDocument();
  });
});
