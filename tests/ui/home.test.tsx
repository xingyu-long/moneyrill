import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { MASK, setPrivateMode } from '../../src/lib/format.ts';
import { todayIso } from '../../src/lib/calendar.ts';
import { stubApi } from './fixture.ts';

beforeEach(() => {
  localStorage.clear();
  setPrivateMode(false);
  delete document.documentElement.dataset.theme;
  history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', vi.fn(stubApi()));
});

describe('Home', () => {
  it('is the first page and shows the modules', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Net worth' })).toBeInTheDocument();
    for (const name of [
      'This month',
      'Assets and debt',
      'Investments',
      'Where it went this month',
      'Recent transactions',
    ])
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    // Spending and Accounts are off until chosen in Customize Home
    for (const name of ['Spending', 'Accounts'])
      expect(screen.queryByRole('heading', { name })).not.toBeInTheDocument();
    const nav = within(screen.getByRole('navigation', { name: 'Main' }));
    expect(nav.getAllByRole('link')[0]).toHaveAccessibleName(/Home/);
    expect(await screen.findByText('Whole Market')).toBeInTheDocument();
  });

  it('a module links to its full page', async () => {
    const user = userEvent.setup();
    render(<App />);
    const tile = (await screen.findByRole('heading', { name: 'Recent transactions' })).closest(
      'section',
    )!;
    await user.click(within(tile).getByRole('link', { name: /Transactions/ }));
    expect(location.pathname).toBe('/transactions');
  });

  it("This month links to this month's cash flow, not the default range", async () => {
    render(<App />);
    const tile = (await screen.findByRole('heading', { name: 'This month' })).closest('section')!;
    expect(within(tile).getByRole('link', { name: 'Cash flow' })).toHaveAttribute(
      'href',
      '/reports/cash-flow?range=this-month',
    );
  });

  it('the Spending card links to the Spending report', async () => {
    showEverything();
    render(<App />);
    const tile = (await screen.findByRole('heading', { name: 'Spending' })).closest('section')!;
    expect(within(tile).getByRole('link', { name: 'Spending' })).toHaveAttribute(
      'href',
      '/reports/spending',
    );
  });

  it('a recent transaction opens its details on Home, as on the Transactions page', async () => {
    const user = userEvent.setup();
    render(<App />);
    const tile = (await screen.findByRole('heading', { name: 'Recent transactions' })).closest(
      'section',
    )!;
    const row = (await within(tile).findAllByTitle(/^Show .+ details$/))[0];
    const name = row.getAttribute('title')!.replace(/^Show | details$/g, '');
    await user.click(row);
    expect(await screen.findByRole('dialog')).toHaveTextContent(name);
    // it opens here, not on the Transactions page
    expect(location.pathname).toBe('/');
  });

  it('Where it went links to this month, and each row to its category with this month chosen', async () => {
    const user = userEvent.setup();
    render(<App />);
    const tile = (await screen.findByRole('heading', { name: 'Where it went this month' })).closest(
      'section',
    )!;
    const rows = await within(tile).findAllByTitle(/^Show .+ this month$/);
    expect(within(tile).getByRole('link', { name: 'Spending' })).toHaveAttribute(
      'href',
      '/reports/spending?range=this-month',
    );
    // the default range (this year) with this month chosen, so the earlier months stay in view
    const month = todayIso().slice(0, 8) + '01';
    expect(rows[0].getAttribute('href')).toMatch(
      new RegExp(`^/reports/category/\\d+\\?type=expense&via=spending&period=${month}$`),
    );
    await user.click(rows[0]);
    expect(location.pathname).toMatch(/^\/reports\/category\/\d+$/);
    expect(location.search).toBe(`?type=expense&via=spending&period=${month}`);
  });

  it('private mode masks the amounts on Home too', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Net worth' });
    await user.click(screen.getByRole('button', { name: /Private mode/ }));
    const tiles = document.querySelector('.home-grid')!;
    expect(tiles.textContent).not.toMatch(/\$[\d,]+\.\d\d/);
  });
});

/** Every module on, in the order Home had before the Zen mockup: Spending second. */
const showEverything = () =>
  localStorage.setItem(
    'moneyrill.home',
    JSON.stringify({
      order: [
        'net-worth',
        'spending',
        'month',
        'assets',
        'accounts',
        'investments',
        'categories',
        'transactions',
      ],
      hidden: [],
      compare: 'month',
      v: 2,
    }),
  );

describe('Home spending trend', () => {
  beforeEach(showEverything);
  const cashFlowUrls = (mock: any) =>
    mock.mock.calls
      .map((c: any[]) => String(c[0]))
      .filter((u: string) => u.startsWith('/api/reports/cash-flow'))
      .map((u: string) => new URL(u, 'http://x').searchParams);

  it('compares this month with last month by default, per day', async () => {
    render(<App />);
    expect(await screen.findByRole('combobox', { name: 'Compare spending' })).toHaveValue('month');
    await screen.findByText(/spent this month/);
    const daily = cashFlowUrls(fetch).find((q: URLSearchParams) => q.get('interval') === 'day');
    expect(daily?.get('to')).toBe(todayIso());
    expect(daily?.get('from')).toMatch(/^\d{4}-\d\d-01$/);
  });

  it('changing the comparison reloads it and is remembered on this device', async () => {
    const user = userEvent.setup();
    render(<App />);
    const pick = await screen.findByRole('combobox', { name: 'Compare spending' });
    await user.selectOptions(pick, 'This year vs. last year');
    await screen.findByText(/spent this year/);
    expect(
      cashFlowUrls(fetch).some(
        (q: URLSearchParams) => q.get('from')?.endsWith('-01-01') && q.get('interval') === 'month',
      ),
    ).toBe(true);
    expect(JSON.parse(localStorage.getItem('moneyrill.home')!).compare).toBe('year');
  });
});

describe('Customize Home', () => {
  // Home no longer carries the button: it lives under Settings -> Display and navigation.
  const open = async () => {
    const user = userEvent.setup();
    history.replaceState(null, '', '/settings/display');
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Customize Home' }));
    return { user, dialog: await screen.findByRole('dialog', { name: 'Customize Home' }) };
  };
  const saved = () => JSON.parse(localStorage.getItem('moneyrill.home')!);

  it('lists every module with a switch; Spending and Accounts start off', async () => {
    const { dialog } = await open();
    const switches = within(dialog).getAllByRole('switch');
    expect(switches).toHaveLength(7); // Net worth is not one of them: it is always the hero
    const off = switches.filter(
      (s) => !(s as HTMLElement).getAttribute('aria-checked')?.includes('true'),
    );
    expect(off.map((s) => s.getAttribute('aria-label')).sort()).toEqual([
      'Show Accounts',
      'Show Spending trend',
    ]);
  });

  it('shows a module, hides it again, and remembers the choice', async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('switch', { name: 'Show Accounts' }));
    expect(saved().hidden).toEqual(['spending']);
    await user.click(within(dialog).getByRole('switch', { name: 'Show Accounts' }));
    expect([...saved().hidden].sort()).toEqual(['accounts', 'spending']);
  });

  it('reorders with the arrow keys, and Home follows after a reload', async () => {
    const { user, dialog } = await open();
    expect(within(dialog).queryByRole('button', { name: 'Move Net worth' })).toBeNull();
    within(dialog).getByRole('button', { name: 'Move This month' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(saved().order.slice(0, 2)).toEqual(['assets', 'month']);
    cleanup();
    history.replaceState(null, '', '/home');
    render(<App />);
    await screen.findByRole('heading', { name: 'This month' });
    const headings = [...document.querySelectorAll('.home-grid h2')].map((h) => h.textContent);
    // net worth stays the hero; the cards follow in the new order
    expect(headings.slice(0, 3)).toEqual(['Net worth', 'Assets and debt', 'This month']);
  });

  it('drags a module past several rows in one move, by the pointer position (touch or mouse)', async () => {
    const { dialog } = await open();
    // jsdom has no layout: rows are 40 tall, 50 apart, in the order they are in the list
    const index = (el: Element) => [...el.parentElement!.children].indexOf(el);
    const proto = HTMLElement.prototype;
    Object.defineProperty(proto, 'offsetTop', {
      configurable: true,
      get() {
        return index(this) * 50;
      },
    });
    Object.defineProperty(proto, 'offsetHeight', {
      configurable: true,
      get() {
        return 40;
      },
    });
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const top = this.hasAttribute('data-widget') ? index(this) * 50 : 0;
      return {
        top,
        left: 0,
        right: 0,
        bottom: top + 40,
        width: 0,
        height: 40,
        x: 0,
        y: top,
        toJSON() {},
      };
    };
    try {
      const grip = within(dialog).getByRole('button', { name: 'Move This month' });
      fireEvent.pointerDown(grip, { pointerId: 1, clientY: 20 });
      fireEvent.pointerMove(grip, { pointerId: 1, clientY: 220 });
      const order = () =>
        [...dialog.querySelectorAll('[data-widget]')].map((e) => (e as HTMLElement).dataset.widget);
      expect(order().slice(0, 4)).toEqual(['assets', 'investments', 'categories', 'month']);
      fireEvent.pointerMove(grip, { pointerId: 1, clientY: 20 });
      expect(order()[0]).toBe('month');
      fireEvent.pointerMove(grip, { pointerId: 1, clientY: 320 });
      fireEvent.pointerUp(grip, { pointerId: 1 });
      const after = order();
      expect(after.indexOf('month')).toBeGreaterThan(4);
      expect(saved().order).toEqual(after);
      // once released, moving no longer reorders
      fireEvent.pointerMove(grip, { pointerId: 1, clientY: 0 });
      expect(order()).toEqual(after);
    } finally {
      Element.prototype.getBoundingClientRect = rect;
      delete (proto as any).offsetTop;
      delete (proto as any).offsetHeight;
    }
  });

  it('with every module hidden Home offers a way back', async () => {
    localStorage.setItem(
      'moneyrill.home',
      JSON.stringify({
        order: [
          'net-worth',
          'month',
          'assets',
          'investments',
          'categories',
          'transactions',
          'spending',
          'accounts',
        ],
        hidden: [
          'net-worth',
          'month',
          'assets',
          'investments',
          'categories',
          'transactions',
          'spending',
          'accounts',
        ],
        compare: 'month',
        v: 2,
      }),
    );
    const user = userEvent.setup();
    history.replaceState(null, '', '/home');
    render(<App />);
    expect(await screen.findByText('Every module is hidden.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Customize/ }));
    expect(await screen.findByRole('dialog', { name: 'Customize Home' })).toBeInTheDocument();
  });

  it('ignores a damaged saved layout, and one saved under the older design', async () => {
    localStorage.setItem('moneyrill.home', '{nope');
    history.replaceState(null, '', '/home');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Net worth' })).toBeInTheDocument();
    cleanup();
    localStorage.setItem(
      'moneyrill.home',
      JSON.stringify({ order: ['accounts', 'net-worth'], hidden: ['month'], compare: 'month' }),
    );
    render(<App />);
    // the old layout is not used: Home opens on its default, with This month back
    expect(await screen.findByRole('heading', { name: 'This month' })).toBeInTheDocument();
  });

  it('is not on the Home page itself', async () => {
    history.replaceState(null, '', '/home');
    render(<App />);
    await screen.findByRole('heading', { name: 'Net worth' });
    expect(screen.queryByRole('button', { name: /Customize/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Sync/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add account/ })).toBeNull();
  });
});

describe('Home design', () => {
  afterEach(() => setPrivateMode(false));
  const net = async () =>
    (await screen.findByRole('heading', { name: 'Net worth' })).closest('section')!;
  const layout = (order: string[], hidden: string[] = []) =>
    localStorage.setItem(
      'moneyrill.home',
      JSON.stringify({ order, hidden, compare: 'month', v: 2 }),
    );

  it('opens with a greeting, and net worth is the hero when it comes first', async () => {
    render(<App />);
    const hero = await net();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(
      /^Good (morning|afternoon|evening)\.$/,
    );
    expect(hero.className).toContain('col-span-full');
    // the figure, the change, the range and Private mode all live in the hero
    expect(within(hero).getByText(/^\$[\d,]+$/)).toBeInTheDocument();
    expect(within(hero).getByRole('group', { name: 'Chart range' })).toBeInTheDocument();
    // the pill says what changed and over what; Private mode is in the top bar, not here
    expect(hero).toHaveTextContent(/since last month|Not enough history/);
    expect(within(hero).queryByRole('button', { name: /Private mode/ })).toBeNull();
  });

  it('net worth is always the hero, above the cards, however they are ordered', async () => {
    layout(
      ['transactions', 'spending', 'month', 'assets', 'accounts', 'investments', 'categories'],
      [],
    );
    render(<App />);
    const hero = await net();
    expect(hero.className).toContain('col-span-full');
    expect(document.querySelector('.home-grid')!.firstElementChild).toBe(hero);
    expect(within(hero).getByRole('group', { name: 'Chart range' })).toBeInTheDocument();
  });

  it('hiding every card still leaves net worth, and a way back', async () => {
    layout(
      ['month', 'assets', 'investments', 'categories', 'transactions', 'spending', 'accounts'],
      ['month', 'assets', 'investments', 'categories', 'transactions', 'spending', 'accounts'],
    );
    render(<App />);
    expect(await net()).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Every module is hidden.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'This month' })).toBeNull();
  });

  it('the money cards say it in a sentence', async () => {
    render(<App />);
    const month = (await screen.findByRole('heading', { name: 'This month' })).closest('section')!;
    await waitFor(() =>
      expect(month).toHaveTextContent("You've kept 36.9% of your income this month."),
    );
    const assets = screen.getByRole('heading', { name: 'Assets and debt' }).closest('section')!;
    expect(assets.textContent).toMatch(/You own \$[\d,]+ and owe \$[\d,]+\./);
    // the exact amounts stay under the sentence
    expect(within(assets).getByText('You owe')).toBeInTheDocument();
    const invest = screen.getByRole('heading', { name: 'Investments' }).closest('section')!;
    expect(invest.textContent).toMatch(/Your portfolio's value is (up|down) [\d.]+% /);
  });

  it('private mode hides the amounts in the sentences and the hero, not the percentages', async () => {
    localStorage.setItem('moneyrill.private', '1');
    render(<App />);
    const month = (await screen.findByRole('heading', { name: 'This month' })).closest('section')!;
    await waitFor(() => expect(month).toHaveTextContent('36.9%'));
    const assets = screen.getByRole('heading', { name: 'Assets and debt' }).closest('section')!;
    expect(assets.textContent).toContain(MASK);
    expect(assets.textContent).not.toMatch(/\$/);
    expect((await net()).textContent).not.toMatch(/\$/);
  });
});
