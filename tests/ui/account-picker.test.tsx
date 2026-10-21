import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { stubApi } from './fixture.ts';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(stubApi()));
  history.replaceState(null, '', '/investments');
});

const open = async () => {
  render(<App />);
  await screen.findByText('Portfolio value');
  return userEvent.setup();
};
const picker = () => document.querySelector('.account-picker') as HTMLElement;
const button = () => within(picker()).getByRole('button', { expanded: false });
const account = (name: RegExp) => within(picker()).getByRole('button', { name });
const card = () => screen.getByText('Portfolio value').closest('section')!;
const value = () => card().querySelector('.font-serif')!.textContent;

describe('Investment account picker', () => {
  it('starts on every account, with nothing to clear', async () => {
    const user = await open();
    expect(button()).toHaveTextContent('All investment accounts');
    expect(within(picker()).queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(value()).toBe('$2,050.00'); // 1100 + 700 + 250
    expect(screen.getByRole('row', { name: /VTI/ })).toHaveTextContent('$1,650.00');
    await user.click(button());
    for (const name of [/Individual brokerage/, /Roth IRA/, /Mystery account/])
      expect(account(name)).toHaveAttribute('aria-pressed', 'false');
  });

  it('picking accounts narrows the value and the holdings, names the count and offers Clear', async () => {
    const user = await open();
    await user.click(button());
    await user.click(account(/Individual brokerage/));
    expect(account(/Individual brokerage/)).toHaveAttribute('aria-pressed', 'true');
    expect(value()).toBe('$1,100.00');
    expect(within(picker()).getByRole('button', { name: /1 account$/ })).toBeInTheDocument();
    // the holdings count only the picked account: its 10 VTI, and not the Roth's VTI or cash
    expect(screen.getByRole('row', { name: /VTI/ })).toHaveTextContent('$1,100.00');
    expect(screen.queryByRole('row', { name: /CASH/ })).toBeNull();
    await user.click(account(/Roth IRA/));
    expect(value()).toBe('$1,800.00');
    expect(within(picker()).getByRole('button', { name: /2 accounts$/ })).toBeInTheDocument();
    expect(within(picker()).getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('a part of the portfolio shows its value change, not the return, and no Contributed', async () => {
    const user = await open();
    await user.click(button());
    await user.click(account(/Roth IRA/));
    expect(within(card()).getByText(/value change$/)).toBeInTheDocument();
    expect(within(card()).queryByText(/ return$/)).toBeNull();
    expect(within(card()).queryByText('Contributed')).toBeNull();
  });

  it('Clear goes back to every account', async () => {
    const user = await open();
    await user.click(button());
    await user.click(account(/Roth IRA/));
    await user.click(within(picker()).getByRole('button', { name: 'Clear' }));
    expect(value()).toBe('$2,050.00');
    expect(within(picker()).queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(account(/All investment accounts/)).toBeInTheDocument();
    expect(account(/Roth IRA/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('taking the last pick away means every account again, never an empty portfolio', async () => {
    const user = await open();
    await user.click(button());
    await user.click(account(/Roth IRA/));
    await user.click(account(/Roth IRA/));
    expect(value()).toBe('$2,050.00');
    expect(within(picker()).queryByRole('button', { name: 'Clear' })).toBeNull();
  });
});
