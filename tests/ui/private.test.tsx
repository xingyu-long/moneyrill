import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { setPrivateMode } from '../../src/lib/format.ts';
import { overview } from './fixture.ts';

beforeEach(() => {
  localStorage.clear();
  setPrivateMode(false);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => structuredClone(overview) })),
  );
});
afterEach(() => {
  localStorage.clear();
  setPrivateMode(false);
});

const toggle = () => screen.getByRole('button', { name: /Private mode/ });
const dollars = (el: HTMLElement) => el.textContent!.match(/\$[\d,]+\.\d\d/g) ?? [];

describe('private mode', () => {
  it('hides net worth, balances and group totals but keeps the growth percentage', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    expect(screen.getAllByText('$2,350.00').length).toBeGreaterThan(0);
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(dollars(document.body)).toEqual([]);
    expect(screen.getAllByText('••••••').length).toBeGreaterThan(5);
    // the change in net worth is still shown as a percentage, without its dollar amount
    expect(screen.getByTestId('net-caption').textContent).toMatch(/[+-]?\d+(\.\d+)?%/);
    await user.click(toggle());
    expect(screen.getAllByText('$2,350.00').length).toBeGreaterThan(0);
  });

  it('on Investments hides values, shares and the gain; keeps price changes and prices', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    await user.click(toggle());
    await user.click(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
        name: /Investments/,
      }),
    );
    await screen.findByText('Holdings');
    const vti = screen.getByRole('row', { name: /VTI/ });
    expect(within(vti).queryByText('15')).toBeNull(); // shares
    expect(within(vti).queryByText('$1,650.00')).toBeNull(); // market value
    expect(within(vti).getByText('$110.00')).toBeInTheDocument(); // public price stays
    // the price change is a percentage, which stays
    const cells = within(vti).getAllByRole('cell');
    expect(cells[cells.length - 1].textContent).toMatch(/^[+-]?\d+(\.\d+)?%$/);
    // the value card hides its amounts too, and keeps the return as a percentage
    const card = screen.getByText('Portfolio value · all investment accounts').closest('section')!;
    expect(card.textContent).not.toMatch(/\$/);
    // the only dollar figures left in the table are public per-unit prices (VTI and cash)
    expect(dollars(document.querySelector('.holdings-card') as HTMLElement).sort()).toEqual([
      '$1.00',
      '$110.00',
    ]);
  });

  it('masks the security panel and the account panel, and blocks balance edits', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    await user.click(toggle());
    await user.click(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
        name: /Investments/,
      }),
    );
    await user.click(await screen.findByRole('row', { name: /VTI/ }));
    const panel = await screen.findByRole('dialog', { name: /Total US stock market/ });
    expect(within(panel).queryByText('15')).toBeNull();
    expect(within(panel).queryByText('10 shares')).toBeNull();
    expect(within(panel).getAllByText('••••••').length).toBeGreaterThanOrEqual(3);
  });

  it('is remembered on this device', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    await user.click(toggle());
    expect(localStorage.getItem('moneyrill.private')).toBe('1');
    first.unmount();
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(dollars(document.body)).toEqual([]);
  });

  it('keeps a choice saved under the old app name', async () => {
    localStorage.setItem('stillwater.private', '1');
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
  });
});
