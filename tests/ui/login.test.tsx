import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { overview } from './fixture.ts';

type Session = { authenticated: boolean; configured: boolean; passphrase: string };
let session: Session;
const calls: string[] = [];

beforeEach(() => {
  session = { authenticated: false, configured: true, passphrase: 'correct horse battery' };
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: any) => {
      const path = String(url);
      calls.push(`${init?.method || 'GET'} ${path}`);
      const reply = (status: number, body: unknown) => ({
        ok: status < 400,
        status,
        json: async () => body,
      });
      if (path === '/api/auth/status')
        return reply(200, {
          required: true,
          configured: session.configured,
          authenticated: session.authenticated,
        });
      if (path === '/api/auth/login') {
        if (JSON.parse(init.body).passphrase !== session.passphrase)
          return reply(401, { error: 'Incorrect passphrase' });
        session.authenticated = true;
        return reply(200, { ok: true });
      }
      if (path === '/api/auth/logout') {
        session.authenticated = false;
        return reply(200, { ok: true });
      }
      if (!session.authenticated) return reply(401, { error: 'Sign in required' });
      return reply(200, { ...structuredClone(overview), hasPlaidKeys: true });
    }),
  );
});

describe('sign-in', () => {
  it('shows the sign-in page and loads no financial data until signed in', async () => {
    render(<App />);
    expect(await screen.findByLabelText('Passphrase')).toBeInTheDocument();
    expect(screen.queryByText('TOTAL NET WORTH')).toBeNull();
    expect(calls.some((c) => c.endsWith('/api/overview'))).toBe(false);
  });

  it('rejects a wrong passphrase and accepts the right one', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('Passphrase'), 'not it');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect passphrase');
    expect(screen.queryByText('TOTAL NET WORTH')).toBeNull();

    await user.clear(screen.getByLabelText('Passphrase'));
    await user.type(screen.getByLabelText('Passphrase'), session.passphrase);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('TOTAL NET WORTH')).toBeInTheDocument();
  });

  it('signs out and returns to the sign-in page', async () => {
    session.authenticated = true;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Passphrase')).toBeInTheDocument();
    expect(screen.queryByText('TOTAL NET WORTH')).toBeNull();
  });

  it('tells you how to set a passphrase when none exists yet', async () => {
    session.configured = false;
    render(<App />);
    expect(await screen.findByText(/set-passphrase\.sh/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Passphrase')).toBeNull();
  });

  it('falls back to the sign-in page if the session expires while using the app', async () => {
    session.authenticated = true;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('TOTAL NET WORTH');
    session.authenticated = false;
    // the next thing that asks the server for something finds the session over
    await user.click(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
        name: /Settings/,
      }),
    );
    await user.click(await screen.findByRole('button', { name: /Add an account/ }));
    expect(await screen.findByLabelText('Passphrase')).toBeInTheDocument();
  });
});
