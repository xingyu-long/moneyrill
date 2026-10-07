import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../../src/App.tsx';
import { versionLabel } from '../../src/components/Footer.tsx';
import { overview } from './fixture.ts';

function serve(version: unknown, mode = 'sandbox') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url);
      const body =
        path === '/api/health'
          ? { ok: true, mode, version }
          : path === '/api/auth/status'
            ? { required: false, configured: false, authenticated: false }
            : { ...structuredClone(overview), mode };
      return { ok: true, status: 200, json: async () => body };
    }),
  );
}

describe('running version and environment', () => {
  beforeEach(() => {
    document.title = '';
  });

  it('formats the version label', () => {
    expect(versionLabel({ commit: 'c4ad6c8', builtAt: null })).toBe('v c4ad6c8');
    expect(versionLabel({ commit: 'c4ad6c8', builtAt: '2026-10-03T17:34:00Z' })).toMatch(
      /^v c4ad6c8 · built Oct 3, /,
    );
  });

  it('shows the commit in the footer and marks staging in the tab title', async () => {
    serve({ commit: 'c4ad6c8', builtAt: '2026-10-03T17:34:00Z' });
    render(<App />);
    expect(await screen.findByText(/v c4ad6c8 · built Oct 3/)).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Moneyrill · STAGING'));
    expect(document.querySelector('.env-strip.staging')).not.toBeNull();
    expect(document.querySelector('.env-badge.staging')).toHaveTextContent('STAGING');
  });

  it('shows no environment marks and a plain title in production', async () => {
    serve({ commit: 'abc1234', builtAt: null }, 'production');
    render(<App />);
    expect(await screen.findByText(/v abc1234/)).toBeInTheDocument();
    // The version comes from /api/health but the environment from /api/overview, so it can arrive a moment later.
    await waitFor(() => expect(document.title).toBe('Moneyrill'));
    // production shows no strip and no badge; the round Sync button is its place in the top bar
    expect(document.querySelector('.env-strip')).toBeNull();
    expect(document.querySelector('.env-badge')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sync accounts' })).toBeInTheDocument();
  });

  it('still works when the version is unavailable', async () => {
    serve(undefined);
    render(<App />);
    expect(await screen.findByText('TOTAL NET WORTH')).toBeInTheDocument();
    expect(screen.queryByText(/ v /)).toBeNull();
  });
});
