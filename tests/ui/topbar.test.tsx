import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { overview, stubApi } from './fixture.ts';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(stubApi()));
  history.replaceState(null, '', '/home');
});

const main = async () => within(await screen.findByRole('navigation', { name: 'Main' }));

describe('The top bar', () => {
  it('has the wordmark and every page in one nav, with the open page current', async () => {
    render(<App />);
    const nav = await main();
    expect(nav.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Home',
      'Accounts',
      'Investments',
      'Transactions',
      'Reports',
      'Settings',
    ]);
    expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'Reports' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'moneyrill' })).toHaveAttribute('href', '/home');
  });

  it('opens Settings from the round button, which stays the current page inside Settings', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click((await main()).getByRole('link', { name: 'Settings' }));
    expect(location.pathname).toBe('/settings');
    expect((await main()).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('keeps only what belongs to the whole app: the environment, search and Private mode', async () => {
    render(<App />);
    await main();
    expect(document.querySelector('.env-badge')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Private mode' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // the theme choice is under Settings -> Display; the offline note and the sync buttons are gone
    expect(screen.queryByRole('button', { name: /Appearance/ })).toBeNull();
    expect(screen.queryByText(/Offline-ready/)).toBeNull();
  });

  it('staging shows its badge and no Sync button in the top bar', async () => {
    render(<App />);
    await main();
    expect(document.querySelector('.env-badge.staging')).toHaveTextContent('STAGING');
    expect(screen.queryByRole('button', { name: 'Sync accounts' })).toBeNull();
  });

  it('production has no badge; its round Sync button syncs the connected accounts', async () => {
    const user = userEvent.setup();
    const calls: { url: string; method: string; body: any }[] = [];
    const api = stubApi(calls);
    const production = (connections: unknown[]) =>
      vi.fn(async (url: string, init: any) =>
        url.startsWith('/api/overview')
          ? {
              ok: true,
              status: 200,
              json: async () => ({ ...structuredClone(overview), mode: 'production', connections }),
            }
          : api(url, init),
      );
    // no connection: nothing to sync, so the button is off
    vi.stubGlobal('fetch', production([]));
    const { unmount } = render(<App />);
    await main();
    expect(document.querySelector('.env-badge')).toBeNull();
    expect(document.querySelector('.env-strip')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Sync accounts' })).toBeDisabled();
    unmount();
    // one connection: the button syncs
    vi.stubGlobal(
      'fetch',
      production([{ id: 'c1', institution_name: 'Test Bank', disconnected_at: null }]),
    );
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Sync accounts' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/sync')).toBe(true));
  });

  it('Private mode is the round eye in the top bar on every page, and toggles', async () => {
    const user = userEvent.setup();
    render(<App />);
    await main();
    await user.click(screen.getByRole('button', { name: 'Private mode' }));
    expect(screen.getByRole('button', { name: 'Private mode on' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click((await main()).getByRole('link', { name: 'Investments' }));
    expect(screen.getAllByRole('button', { name: /Private mode/ })).toHaveLength(1);
  });

  it('search opens Transactions with the search box ready to type in', async () => {
    const user = userEvent.setup();
    render(<App />);
    await main();
    await user.click(screen.getByRole('link', { name: 'Search' }));
    expect(location.pathname).toBe('/transactions');
    const box = await screen.findByRole('searchbox', { name: 'Search transactions' });
    await waitFor(() => expect(box).toHaveFocus());
  });
});

describe('Settings, where the sidebar footer went', () => {
  it('shows what the app promises and the workspace beside the list of pages', async () => {
    history.replaceState(null, '', '/settings');
    render(<App />);
    expect(await screen.findByText('Yours to keep.')).toBeInTheDocument();
    expect(screen.getByText('Your workspace')).toBeInTheDocument();
    const list = screen.getByRole('navigation', { name: 'Settings pages' });
    expect(list.parentElement).toContainElement(screen.getByText('Yours to keep.'));
  });
});
