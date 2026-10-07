import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { stubApi } from './fixture.ts';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(stubApi()));
});

const main = () => within(screen.getByRole('navigation', { name: 'Main' }));
const pages = () => within(screen.getByRole('navigation', { name: 'Settings pages' }));

async function open(path: string) {
  history.replaceState(null, '', path);
  render(<App />);
  await screen.findByRole('navigation', { name: 'Settings pages' });
  return userEvent.setup();
}

describe('Settings pages', () => {
  it('lists the pages, each with its own address, and shows Connections when none is chosen', async () => {
    const user = await open('/settings');
    expect(
      pages()
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual([
      'Connections',
      'Data',
      'Categories',
      'Sync settings & activity',
      'Display and navigation',
      'Sign-in',
    ]);
    expect(pages().getByRole('link', { name: 'Connections' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('heading', { name: 'Import from Monarch' })).not.toBeInTheDocument();
    await user.click(pages().getByRole('link', { name: 'Data' }));
    expect(location.pathname).toBe('/settings/data');
    expect(await screen.findByRole('heading', { name: 'Import from Monarch' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sync schedule' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Back to settings' }));
    expect(location.pathname).toBe('/settings');
  });

  it('opens the page named in the address, and keeps Settings selected in the sidebar', async () => {
    await open('/settings/sync');
    expect(await screen.findByRole('heading', { name: 'Sync schedule' })).toBeInTheDocument();
    expect(main().getByRole('link', { name: /Settings/ })).toHaveAttribute('aria-current', 'page');
    expect(pages().getByRole('link', { name: 'Sync settings & activity' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('Edit navigation', () => {
  const display = () => open('/settings/display');
  const order = (label: string) =>
    (main().getByRole('link', { name: new RegExp(label) }) as HTMLElement).style.getPropertyValue(
      '--bar-order',
    );
  const saved = () => JSON.parse(localStorage.getItem('moneyrill.tabbar') ?? 'null');

  it('starts with Home and four pages in the bar, Settings under More, and the bar full', async () => {
    await display();
    expect(screen.getByText('5 of 5')).toBeInTheDocument();
    expect(screen.getByText(/The bar is full/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Settings to the tab bar' })).toBeNull();
    expect(main().getByRole('link', { name: /Settings/ })).toHaveClass('off-bar');
    expect(main().getByRole('button', { name: /More/ })).toBeInTheDocument();
  });

  it('removes and adds pages, and the choice is kept on this device', async () => {
    const user = await display();
    await user.click(screen.getByRole('button', { name: 'Remove Investments from the tab bar' }));
    expect(screen.getByText('4 of 5')).toBeInTheDocument();
    expect(saved()).toEqual(['Accounts', 'Transactions', 'Reports']);
    expect(main().getByRole('link', { name: /Investments/ })).toHaveClass('off-bar');
    await user.click(screen.getByRole('button', { name: 'Add Settings to the tab bar' }));
    expect(screen.getByText('5 of 5')).toBeInTheDocument();
    expect(saved()).toEqual(['Accounts', 'Transactions', 'Reports', 'Settings']);
    expect(main().getByRole('link', { name: /Settings/ })).not.toHaveClass('off-bar');
  });

  it('reorders the bar', async () => {
    const user = await display();
    expect(order('Reports')).toBe('4');
    await user.click(screen.getByRole('button', { name: 'Move Reports earlier' }));
    expect(saved()).toEqual(['Accounts', 'Investments', 'Reports', 'Transactions']);
    expect(order('Reports')).toBe('3');
    expect(order('Transactions')).toBe('4');
    expect(screen.getByRole('button', { name: 'Move Accounts earlier' })).toBeDisabled();
  });

  it('More lists the pages that are not in the bar and goes to one', async () => {
    const user = await display();
    await user.click(main().getByRole('button', { name: /More/ }));
    const menu = within(screen.getByRole('menu'));
    expect(menu.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Settings']);
    await user.click(menu.getByRole('menuitem', { name: 'Settings' }));
    expect(location.pathname).toBe('/settings');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('always has a More, because only four pages fit beside Home', async () => {
    localStorage.setItem(
      'moneyrill.tabbar',
      JSON.stringify(['Accounts', 'Transactions', 'Settings', 'Reports']),
    );
    const user = await display();
    await user.click(main().getByRole('button', { name: /More/ }));
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['Investments']);
  });

  it('ignores a damaged saved bar', async () => {
    localStorage.setItem('moneyrill.tabbar', '["Home","Nope"]');
    await display();
    expect(screen.getByText('5 of 5')).toBeInTheDocument();
  });
});

describe('Appearance', () => {
  it('can be chosen on the Display page', async () => {
    const user = await open('/settings/display');
    await user.click(screen.getByRole('button', { name: /Dark/ }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('moneyrill.theme')).toBe('dark');
    expect(screen.getByRole('button', { name: /Dark/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
