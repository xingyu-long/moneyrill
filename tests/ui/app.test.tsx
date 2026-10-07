import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { overview } from './fixture.ts';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => structuredClone(overview) })),
  );
});

async function openInvestments() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText('TOTAL NET WORTH');
  await user.click(
    within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
      name: /Investments/,
    }),
  );
  await screen.findByText('Holdings');
  return user;
}

const symbols = () =>
  within(screen.getAllByRole('rowgroup')[1])
    .getAllByRole('row')
    .map(
      (row) =>
        within(row)
          .getAllByRole('cell')[0]
          .textContent!.split(/(?=[A-Z][a-z])/)[0],
    );

describe('Accounts tab', () => {
  it('shows net worth as assets minus debts and groups the accounts', async () => {
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    // 1100 + 700 + 250 + 500 - 200
    expect(screen.getAllByText('$2,350.00').length).toBeGreaterThan(0);
    for (const group of ['Investments', 'Cash', 'Credit cards']) {
      // each group's heading is a button that opens and closes it
      expect(
        screen.getByRole('button', { name: new RegExp('^' + group), expanded: true }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText(/Individual brokerage/)).toBeInTheDocument();
    expect(screen.getByText(/Travel card/)).toBeInTheDocument();
  });

  it('a group closes and opens from its heading', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    const heading = () => screen.getByRole('button', { name: /^Credit cards/ });
    expect(screen.getByText(/Travel card/)).toBeInTheDocument();
    await user.click(heading());
    expect(heading()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Travel card/)).toBeNull();
    await user.click(heading());
    expect(screen.getByText(/Travel card/)).toBeInTheDocument();
  });
});

describe('Investments holdings table', () => {
  it('sums the same security across accounts and hides account names', async () => {
    await openInvestments();
    const vti = screen.getByRole('row', { name: /VTI/ });
    expect(within(vti).getByText('15')).toBeInTheDocument(); // 10 + 5 shares
    expect(within(vti).getByText('$1,650.00')).toBeInTheDocument(); // 1100 + 550
    expect(screen.queryByText('Individual brokerage', { selector: '.holding-account' })).toBeNull();
    expect(document.querySelectorAll('.security-symbol').length).toBe(2); // VTI, CASH
  });

  it('leaves out balance the holdings do not explain', async () => {
    await openInvestments();
    expect(screen.queryByText('Unreported account value')).toBeNull();
    expect(screen.queryByText('Mystery account')).toBeNull();
  });

  it('sorts by market value and flips direction when a header is clicked again', async () => {
    const user = await openInvestments();
    expect(screen.getByRole('columnheader', { name: /Value/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(symbols()[0]).toBe('VTI');
    await user.click(screen.getByRole('button', { name: /Value/ }));
    expect(screen.getByRole('columnheader', { name: /Value/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(symbols()[0]).not.toBe('VTI');
    await user.click(screen.getByRole('button', { name: /Value/ }));
    expect(symbols()[0]).toBe('VTI');
  });

  it('marks only the Price and Shares columns as droppable on a phone', async () => {
    await openInvestments();
    const headers = screen.getAllByRole('columnheader');
    const marked = (cls: string) =>
      headers.filter((h) => h.classList.contains(cls)).map((h) => h.textContent);
    expect(marked('col-price')).toEqual([expect.stringMatching(/^Price/)]);
    expect(marked('col-shares')).toEqual([expect.stringMatching(/^Shares/)]);
    const vti = screen.getByRole('row', { name: /VTI/ });
    expect(vti.querySelector('.col-shares')).toHaveTextContent('15');
    expect(vti.querySelectorAll('.col-price, .col-shares')).toHaveLength(2);
  });

  it('sorts alphabetically by security', async () => {
    const user = await openInvestments();
    await user.click(
      within(screen.getByRole('columnheader', { name: /^Security/ })).getByRole('button'),
    );
    const list = symbols().filter((s) => s !== '—');
    expect(list).toEqual([...list].sort());
  });
});

describe('Security detail panel', () => {
  it('lists each account holding the security with its shares and value', async () => {
    const user = await openInvestments();
    await user.click(screen.getByRole('row', { name: /VTI/ }));
    const panel = await screen.findByRole('dialog', { name: /Total US stock market/ });
    expect(within(panel).getByText('Summary')).toBeInTheDocument();
    expect(within(panel).getByText('Individual brokerage')).toBeInTheDocument();
    expect(within(panel).getByText('Roth IRA')).toBeInTheDocument();
    expect(within(panel).getByText('10 shares')).toBeInTheDocument();
    expect(within(panel).getByText('5 shares')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /Close security details/ }));
    expect(screen.queryByRole('dialog', { name: /Total US stock market/ })).toBeNull();
  });
});
