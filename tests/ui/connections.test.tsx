import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import App from '../../src/App.tsx';
import { overview, stubApi } from './fixture.ts';

beforeEach(() => {
  localStorage.clear();
  const stub = stubApi();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any) => {
      if (!String(url).startsWith('/api/overview')) return stub(url, init);
      const data: any = structuredClone(overview);
      data.connections = [
        {
          id: 'c1',
          institution: 'Test Bank',
          products: ['transactions'],
          created_at: '2026-03-14T12:00:00Z',
        },
        { id: 'c2', institution: 'Old Bank', products: ['transactions'], created_at: null },
        {
          id: 'c3',
          institution: 'Broken Bank',
          products: ['transactions'],
          last_error: 'ITEM_LOGIN_REQUIRED',
          created_at: null,
        },
        {
          id: 'c4',
          institution: 'Gone Bank',
          products: ['transactions'],
          last_error: 'old',
          disconnected_at: '2026-09-01T12:00:00Z',
          created_at: null,
        },
      ];
      return { ok: true, status: 200, json: async () => data };
    }),
  );
});

describe('Connections page', () => {
  it('shows when each connection was added', async () => {
    history.replaceState(null, '', '/settings/connections');
    render(<App />);
    expect(await screen.findByText('Test Bank')).toBeInTheDocument();
    expect(screen.getByText(/^Added: .*2026/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Added:/)).toHaveLength(1);
  });
});

describe('Connection cards', () => {
  const card = async (name: string) => {
    history.replaceState(null, '', '/settings/connections');
    render(<App />);
    return (await screen.findByText(name)).closest<HTMLElement>('div.rounded-\\[22px\\]')!;
  };

  it('a connection that needs attention is outlined, tagged, and has its Reconnect filled', async () => {
    const broken = await card('Broken Bank');
    expect(broken.className).toContain('ring-clay');
    expect(within(broken).getByText('Needs attention')).toBeInTheDocument();
    expect(within(broken).getByRole('button', { name: 'Reconnect' }).className).toContain(
      'bg-clay',
    );
    expect(within(broken).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('a healthy connection is a plain card with both actions', async () => {
    const ok = await card('Test Bank');
    expect(ok.className).not.toContain('ring-clay');
    expect(within(ok).queryByText('Needs attention')).toBeNull();
    expect(within(ok).getByRole('button', { name: 'Reconnect' }).className).not.toContain(
      'bg-clay',
    );
  });

  it('a disconnected connection has no actions and no attention tag, even with an old error', async () => {
    const gone = await card('Gone Bank');
    expect(within(gone).queryByRole('button')).toBeNull();
    expect(within(gone).queryByText('Needs attention')).toBeNull();
    expect(within(gone).getByText(/Disconnected/)).toBeInTheDocument();
  });

  it('the page sentence counts only the live connection that needs attention', async () => {
    await card('Broken Bank');
    expect(screen.getByRole('heading', { level: 1 }).nextElementSibling).toHaveTextContent(
      'Everything stays on this machine, in your own database. One connection needs your attention.',
    );
  });
});
