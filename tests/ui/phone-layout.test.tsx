import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { stubApi } from './fixture.ts';

// jsdom does no layout, so these pin the phone classes (Tailwind's `max-[760px]:` variants) that keep the
// Investments page inside a phone screen. The layout itself is checked in a browser on staging.
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(stubApi()));
  history.replaceState(null, '', '/investments');
});

describe('Investments on a phone (max-width: 760px)', () => {
  it('drops Price and Shares and pins the Security column of the holdings table', async () => {
    render(<App />);
    await screen.findByText('Holdings');
    const vti = screen.getByRole('row', { name: /VTI/ });
    for (const cls of ['.col-price', '.col-shares'])
      expect(vti.querySelector(cls)!.className).toContain('max-[760px]:hidden');
    expect(vti.querySelector('td')!.className).toContain('max-[760px]:sticky');
    expect(vti.querySelector('td')!.className).toContain('max-[760px]:left-0');
  });
});

describe('Settings on a phone (max-width: 760px)', () => {
  const show = async (path: string) => {
    history.replaceState(null, '', path);
    render(<App />);
    return screen.findByRole('navigation', { name: 'Settings pages' });
  };

  it('shows the list of pages alone at /settings, with the page hidden', async () => {
    // the list and the "Yours to keep." card are one column, which is what hides when a page is open
    const column = (await show('/settings')).parentElement!;
    expect(column.className).not.toContain('max-[760px]:hidden');
    expect(column.nextElementSibling!.className).toContain('max-[760px]:hidden');
  });

  it('shows one page alone at /settings/<page>, with the list hidden and a way back', async () => {
    const column = (await show('/settings/sync')).parentElement!;
    expect(column.className).toContain('max-[760px]:hidden');
    expect(column.nextElementSibling!.className).not.toContain('max-[760px]:hidden');
    expect(screen.getByRole('link', { name: 'Back to settings' })).toBeInTheDocument();
  });
});

describe('The shell on a phone (max-width: 760px)', () => {
  const open = async () => {
    history.replaceState(null, '', '/accounts');
    render(<App />);
    return screen.findByRole('navigation', { name: 'Main' });
  };

  it('has no breadcrumb: the page you are on is the chosen item of the bar', async () => {
    const nav = await open();
    expect(screen.queryByText(/^Workspace/)).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Accounts/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('floats the tab bar above the bottom edge, clear of the home indicator, with room under the page', async () => {
    const nav = await open();
    for (const cls of ['max-[760px]:fixed', 'max-[760px]:inset-x-[18px]', 'safe-area-inset-bottom'])
      expect(nav.className).toContain(cls);
    expect(within(nav).getAllByRole('link')[0].className).toContain('max-[760px]:flex-1');
    expect(nav.closest('.flex.min-h-screen')!.className).toContain('safe-area-inset-bottom');
  });

  it('shows only the chosen pages in the bar, in order, with a More button', async () => {
    const nav = await open();
    const settings = within(nav).getByRole('link', { name: /Settings/ });
    expect(settings.className).toContain('max-[760px]:hidden');
    expect(settings.className).toContain('off-bar');
    const more = within(nav).getByRole('button', { name: /More/ });
    expect(more.className).toContain('max-[760px]:flex');
    expect(more.className).toContain('hidden');
    // the bar's order is the order chosen in Settings: Home, then the chosen pages, then More
    const order = (name: RegExp) =>
      within(nav)
        .getByRole('link', { name })
        .getAttribute('style')
        ?.match(/--bar-order: (-?\d+)/)?.[1];
    expect([/Home/, /Accounts/, /Investments/, /Transactions/, /Reports/].map(order)).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(order(/Settings/)).toBe('-1');
    await userEvent.setup().click(more);
    expect(screen.getByRole('menu').className).toContain('fixed');
  });

  it('lets the page draw under the home indicator', () => {
    expect(readFileSync('index.html', 'utf8')).toContain('viewport-fit=cover');
  });
});
