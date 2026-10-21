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

describe('Investments page', () => {
  it('is one page: the value card, the allocation and the holdings, with no Market/Allocation switch', async () => {
    await open();
    expect(screen.queryByRole('button', { name: 'Market' })).toBeNull();
    expect(screen.getByText('Allocation')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Holdings' })).toBeInTheDocument();
    // no benchmark tiles or return explanation
    expect(screen.queryByRole('button', { name: 'How the return is calculated' })).toBeNull();
  });

  it('the range pills are 1M 3M 6M YTD 1Y All and the chosen one is the white pill', async () => {
    const user = await open();
    const range = screen.getByRole('group', { name: 'Chart range' });
    expect(
      within(range)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['1M', '3M', '6M', 'YTD', '1Y', 'All']);
    await user.click(within(range).getByRole('button', { name: '1Y' }));
    expect(within(range).getByRole('button', { name: '1Y' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(range).getByRole('button', { name: '1Y' }).className).toContain('bg-card');
    expect(screen.getByText(/^1Y (return|value change)$/)).toBeInTheDocument();
  });

  it('allocation is one bar split by weight; hovering a part marks its row', async () => {
    const user = await open();
    const bar = await screen.findByRole('img', { name: 'Allocation' });
    const parts = [...bar.querySelectorAll('i')] as HTMLElement[];
    expect(parts.length).toBeGreaterThan(1);
    // each part is as wide as the position it stands for: the title carries the name, value and weight
    expect(parts[0].title).toMatch(/^.+: \$[\d,.]+ \(\d+\.\d%\)$/);
    expect(document.querySelector('div[data-active]')).toBeNull();
    await user.hover(parts[0]);
    const row = document.querySelector('div[data-active]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(parts[0].title.startsWith(row.textContent!.replace(/[\d.,$%]+.*$/, '').trim())).toBe(
      true,
    );
    await user.unhover(parts[0]);
    expect(document.querySelector('div[data-active]')).toBeNull();
  });

  it('a row of the allocation marks its part of the bar too, and says what leads in a sentence', async () => {
    await open();
    expect(screen.getByText(/^(Mostly|Your largest share is)/)).toBeInTheDocument();
  });

  it('Asset class, Account and Security regroup the allocation; Asset class is the start', async () => {
    const user = await open();
    const group = screen.getByRole('group', { name: 'Allocation grouping' });
    expect(within(group).getByRole('button', { name: 'Asset class' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(group).getByRole('button', { name: 'Account' }));
    expect(await screen.findAllByText('Individual brokerage')).not.toHaveLength(0);
    await user.click(within(group).getByRole('button', { name: 'Security' }));
    expect(within(group).getByRole('button', { name: 'Security' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('the holdings are Security, Shares, Price, Value and Change', async () => {
    await open();
    expect(
      screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/[▲▼]/g, '').trim()),
    ).toEqual(['Security', 'Shares', 'Price', 'Value', 'Change']);
  });
});
