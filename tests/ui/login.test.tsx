import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { overview } from './fixture.ts';

type Session = {
  authenticated: boolean;
  configured: boolean;
  passphrase: string;
};
let session: Session;
const calls: string[] = [];

beforeEach(() => {
  session = {
    authenticated: false,
    configured: true,
    passphrase: 'correct horse battery',
  };
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
          configured: session.configured,
          authenticated: session.authenticated,
        });
      if (path === '/api/auth/setup') {
        const body = JSON.parse(init.body);
        if (session.configured) return reply(409, { error: 'A passphrase is already set' });
        session.passphrase = body.passphrase;
        session.configured = true;
        session.authenticated = true;
        return reply(200, { ok: true });
      }
      if (path === '/api/auth/passphrase') {
        const body = JSON.parse(init.body);
        if (!session.authenticated) return reply(401, { error: 'Sign in required' });
        if (body.current !== session.passphrase)
          return reply(401, { error: 'Incorrect passphrase' });
        session.passphrase = body.passphrase;
        return reply(200, { ok: true });
      }
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

  it('offers no way to create a passphrase when one exists', async () => {
    render(<App />);
    await screen.findByLabelText('Passphrase');
    expect(screen.queryByLabelText('New passphrase')).toBeNull();
    expect(screen.queryByLabelText('Repeat the passphrase')).toBeNull();
  });

  it('on first run lets you choose the passphrase and signs you in', async () => {
    session.configured = false;
    const user = userEvent.setup();
    render(<App />);
    const create = await screen.findByRole('button', { name: 'Create passphrase' });
    expect(screen.queryByLabelText('Passphrase')).toBeNull();
    expect(screen.queryByLabelText('Setup code')).toBeNull();
    expect(create).toBeDisabled();

    await user.type(screen.getByLabelText('New passphrase'), 'a brand new passphrase');
    await user.type(screen.getByLabelText('Repeat the passphrase'), 'a brand new passphras');
    expect(screen.getByText('The passphrases do not match.')).toBeInTheDocument();
    expect(create).toBeDisabled();

    await user.type(screen.getByLabelText('Repeat the passphrase'), 'e');
    await user.click(create);
    expect(await screen.findByText('TOTAL NET WORTH')).toBeInTheDocument();
    expect(session.passphrase).toBe('a brand new passphrase');
  });

  it('holds back a passphrase that is too short', async () => {
    session.configured = false;
    const user = userEvent.setup();
    render(<App />);
    const create = await screen.findByRole('button', { name: 'Create passphrase' });
    await user.type(screen.getByLabelText('New passphrase'), 'too short');
    await user.type(screen.getByLabelText('Repeat the passphrase'), 'too short');
    expect(create).toBeDisabled();
  });

  it('shows what the server says when creating the passphrase fails', async () => {
    session.configured = false;
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('New passphrase'), 'a brand new passphrase');
    await user.type(screen.getByLabelText('Repeat the passphrase'), 'a brand new passphrase');
    session.configured = true; // someone else got there first
    await user.click(screen.getByRole('button', { name: 'Create passphrase' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A passphrase is already set');
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

describe('Settings → Sign-in', () => {
  const NEXT = 'another long passphrase';
  async function openPage() {
    history.replaceState(null, '', '/settings/sign-in');
    render(<App />);
    return userEvent.setup();
  }

  it('changes the passphrase and says other devices were signed out', async () => {
    session.authenticated = true;
    const user = await openPage();
    const button = await screen.findByRole('button', { name: 'Change passphrase' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Current passphrase'), session.passphrase);
    await user.type(screen.getByLabelText('New passphrase'), NEXT);
    await user.type(screen.getByLabelText('Repeat the passphrase'), NEXT);
    await user.click(button);
    expect(await screen.findByRole('status')).toHaveTextContent('Other devices were signed out');
    expect(session.passphrase).toBe(NEXT);
    expect(screen.getByLabelText('Current passphrase')).toHaveValue('');
    expect(screen.getByLabelText('New passphrase')).toHaveValue('');
    // Still signed in here.
    expect(screen.queryByLabelText('Passphrase')).toBeNull();
  });

  it('shows a wrong current passphrase and changes nothing', async () => {
    session.authenticated = true;
    const user = await openPage();
    await user.type(await screen.findByLabelText('Current passphrase'), 'not it');
    await user.type(screen.getByLabelText('New passphrase'), NEXT);
    await user.type(screen.getByLabelText('Repeat the passphrase'), NEXT);
    await user.click(screen.getByRole('button', { name: 'Change passphrase' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect passphrase');
    expect(session.passphrase).toBe('correct horse battery');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps the button off until the new passphrase is long enough and repeated', async () => {
    session.authenticated = true;
    const user = await openPage();
    const button = await screen.findByRole('button', { name: 'Change passphrase' });
    await user.type(screen.getByLabelText('Current passphrase'), session.passphrase);
    await user.type(screen.getByLabelText('New passphrase'), 'short');
    await user.type(screen.getByLabelText('Repeat the passphrase'), 'short');
    expect(button).toBeDisabled();
    await user.clear(screen.getByLabelText('New passphrase'));
    await user.clear(screen.getByLabelText('Repeat the passphrase'));
    await user.type(screen.getByLabelText('New passphrase'), NEXT);
    await user.type(screen.getByLabelText('Repeat the passphrase'), NEXT + 'x');
    expect(button).toBeDisabled();
  });
});
