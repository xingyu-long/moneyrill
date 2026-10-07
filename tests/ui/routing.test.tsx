import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { stubApi } from './fixture.ts';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(stubApi()));
});

const nav = () => within(screen.getByRole('navigation', { name: 'Main' }));
const heading = () => screen.getByRole('heading', { level: 1 }).textContent;
const step = async (fn: () => void) =>
  act(async () => {
    fn();
    await new Promise((r) => setTimeout(r, 30));
  });

describe('Addresses', () => {
  it('each tab has its own address, and the sidebar items are real links', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    expect(location.pathname).toBe('/accounts');
    expect(nav().getByRole('link', { name: /Accounts/ })).toHaveAttribute('aria-current', 'page');
    for (const [name, path] of [
      ['Home', '/home'],
      ['Investments', '/investments'],
      ['Transactions', '/transactions'],
      ['Reports', '/reports/cash-flow'],
      ['Settings', '/settings'],
      ['Accounts', '/accounts'],
    ]) {
      const link = nav().getByRole('link', { name: new RegExp(name) });
      expect(link).toHaveAttribute('href', path);
      await user.click(link);
      expect(location.pathname).toBe(path);
      expect(nav().getByRole('link', { name: new RegExp(name) })).toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  });

  it('opens the page named in the address (a reload or a bookmark)', async () => {
    history.replaceState(null, '', '/transactions');
    render(<App />);
    expect(await screen.findByText('Whole Market')).toBeInTheDocument();
    expect(heading()).toBe('Transactions');
  });

  it('Back and Forward move between tabs', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    await user.click(nav().getByRole('link', { name: /Transactions/ }));
    await user.click(nav().getByRole('link', { name: /Settings/ }));
    expect(heading()).toBe('Settings');
    await step(() => history.back());
    await waitFor(() => expect(heading()).toBe('Transactions'));
    expect(location.pathname).toBe('/transactions');
    await step(() => history.back());
    await waitFor(() => expect(heading()).toBe('Accounts'));
    await step(() => history.forward());
    await waitFor(() => expect(heading()).toBe('Transactions'));
  });

  it('an unknown address is replaced by Home', async () => {
    history.replaceState(null, '', '/no-such-page');
    render(<App />);
    await waitFor(() => expect(location.pathname).toBe('/home'));
  });

  it("keeps Plaid's bank-authorization return address untouched", async () => {
    history.replaceState(null, '', '/?oauth_state_id=abc');
    render(<App />);
    await screen.findByRole('heading', { name: 'Net worth' });
    expect(location.pathname + location.search).toBe('/?oauth_state_id=abc');
  });

  it('a click with Cmd or Ctrl is left to the browser (open in a new tab)', async () => {
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    const link = nav().getByRole('link', { name: /Settings/ });
    // jsdom does not open tabs; what matters is that the app does not take over the click
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { ctrlKey: true });
    expect(location.pathname).toBe('/accounts');
    expect(heading()).toBe('Accounts');
  });
});
