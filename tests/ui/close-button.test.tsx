import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { setPrivateMode } from '../../src/lib/format.ts';
import { stubApi } from './fixture.ts';

beforeEach(() => {
  localStorage.clear();
  setPrivateMode(false);
  vi.stubGlobal('fetch', vi.fn(stubApi()));
});

const link = (name: RegExp) =>
  within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name });

// A close button inside the scrolling part scrolls away with the content: on a phone the panel fills the
// screen and there is then no way to close it.
const scrolls = (el: HTMLElement) => !!el.closest('.overflow-auto');

describe('Close button of drawers and dialogs', () => {
  it('a drawer keeps its close button outside what scrolls', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    await user.click(link(/Investments/));
    await screen.findByText('Portfolio value');
    await user.click(screen.getByRole('row', { name: /VTI/ }));
    const drawer = await screen.findByRole('dialog', { name: /Total US stock market/ });
    const close = within(drawer).getByRole('button', { name: 'Close security details' });
    expect(scrolls(close)).toBe(false);
    expect(scrolls(within(drawer).getByRole('heading', { level: 2 }))).toBe(true);
    await user.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a dialog keeps its close button outside what scrolls', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    await user.click(link(/Transactions/));
    await user.click(await screen.findByRole('button', { name: 'Add transaction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add transaction' });
    const close = within(dialog).getByRole('button', { name: /Close/ });
    expect(scrolls(close)).toBe(false);
    expect(scrolls(within(dialog).getByRole('heading', { level: 2 }))).toBe(true);
    await user.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
