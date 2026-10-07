import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { setPrivateMode } from '../../src/lib/format.ts';
import { dayLabel, todayIso } from '../../src/lib/calendar.ts';
import { plainTransaction, refund, splitTransaction, stubApi } from './fixture.ts';

let calls: { url: string; method: string; body: any }[] = [];
beforeEach(() => {
  localStorage.clear();
  setPrivateMode(false);
  calls = [];
  vi.stubGlobal('fetch', vi.fn(stubApi(calls)));
});
afterEach(() => setPrivateMode(false));

async function openTab(name: RegExp, settingsPage?: string) {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText('TOTAL NET WORTH');
  await user.click(
    within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name }),
  );
  if (settingsPage)
    await user.click(
      within(screen.getByRole('navigation', { name: 'Settings pages' })).getByRole('link', {
        name: settingsPage,
      }),
    );
  return user;
}
const patches = () => calls.filter((c) => c.method === 'PATCH');

describe('Transactions tab', () => {
  it('is in the sidebar and lists transactions grouped by date with a net total per day', async () => {
    await openTab(/Transactions/);
    await screen.findByText('Whole Market');
    expect(screen.getByText('October 3, 2026')).toBeInTheDocument();
    expect(screen.getByText('October 2, 2026')).toBeInTheDocument();
    // 3200 in - 1850 out
    expect(screen.getByText('+$1,350.00')).toBeInTheDocument();
    // merchant falls back to the statement text
    expect(screen.getByText('ZELLE TO LANDLORD')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getAllByText('Everyday checking (…1234)').length).toBe(3);
  });

  it('does not show the account data-source switch, which would not filter transactions', async () => {
    await openTab(/Transactions/);
    await screen.findByText('Whole Market');
    expect(screen.queryByLabelText('Dataset')).toBeNull();
  });

  it('shows money in as +$ and money out as plain $', async () => {
    await openTab(/Transactions/);
    const payroll = (await screen.findByText('Acme Corp')).closest('button')!;
    expect(within(payroll).getByText('+$3,200.00')).toBeInTheDocument();
    const rent = screen.getByText('ZELLE TO LANDLORD').closest('button')!;
    expect(within(rent).getByText('$1,850.00')).toBeInTheDocument();
    expect(within(rent).getByText(/Rent/)).toBeInTheDocument();
    const groceries = screen.getByText('Whole Market').closest('button')!;
    expect(within(groceries).getByText('auto')).toBeInTheDocument(); // category was suggested
  });

  it('loads more pages and sends filters to the server', async () => {
    const user = await openTab(/Transactions/);
    await screen.findByText('Whole Market');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('cursor=next'))).toBe(true));
    await user.click(
      within(screen.getByRole('group', { name: 'Categories' })).getAllByRole('button')[0],
    );
    await waitFor(() => expect(calls.some((c) => /[?&]categories=\d+/.test(c.url))).toBe(true));
    await user.type(screen.getByLabelText('Search transactions'), 'market');
    await waitFor(() => expect(calls.some((c) => c.url.includes('q=market'))).toBe(true));
  });

  it('hides amounts in private mode', async () => {
    const user = await openTab(/Transactions/);
    await screen.findByText('Whole Market');
    await user.click(screen.getByRole('button', { name: /Private mode/ }));
    const list = screen.getByRole('region', { name: 'Transactions' });
    expect(list.textContent).not.toMatch(/\$\d/);
    // three amounts and two day totals, none showing a direction for the day
    expect(within(list).getAllByText(/••••••/).length).toBe(5);
    expect(screen.queryByText('+••••••', { selector: '.txn-day-head span' })).toBeNull();
  });

  it('edits category, date and notes in the drawer; nothing else is editable', async () => {
    const user = await openTab(/Transactions/);
    await user.click((await screen.findByText('ZELLE TO LANDLORD')).closest('button')!);
    const drawer = await screen.findByRole('dialog', { name: 'ZELLE TO LANDLORD' });
    expect(within(drawer).getByText('Original statement')).toBeInTheDocument();

    await user.selectOptions(within(drawer).getByLabelText('Category'), '3');
    await waitFor(() => expect(patches()[0]?.body).toEqual({ category_id: 3 }));
    await user.selectOptions(within(drawer).getByLabelText('Category'), 'auto');
    await waitFor(() => expect(patches()[1]?.body).toEqual({ category_id: null }));

    await user.click(within(drawer).getByLabelText('Date')); // opens the calendar
    const calendar = await within(drawer).findByRole('group', { name: 'Choose a date' });
    expect(within(calendar).getByText('October 2026')).toBeInTheDocument();
    expect(within(calendar).getByRole('button', { name: 'October 2, 2026' })).toHaveAttribute(
      'aria-pressed',
      'true',
    ); // the current date is marked
    await user.click(within(calendar).getByRole('button', { name: 'October 1, 2026' }));
    await waitFor(() => expect(patches()[2]?.body).toEqual({ date: '2026-10-01' }));
    expect(within(drawer).queryByRole('group', { name: 'Choose a date' })).toBeNull(); // closes
    await user.click(await within(drawer).findByRole('button', { name: /Reset to bank date/ }));
    await waitFor(() => expect(patches()[3]?.body).toEqual({ date: null }));

    const notes = within(drawer).getByLabelText('Notes');
    await user.type(notes, 'March rent');
    await user.tab();
    await waitFor(() => expect(patches()[4]?.body).toEqual({ notes: 'March rent' }));
    expect(patches().every((p) => p.url === '/api/transactions/t2')).toBe(true);
    expect(within(drawer).queryByLabelText(/Amount|Merchant|Name/)).toBeNull();

    await user.click(within(drawer).getByRole('button', { name: /Close transaction details/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('picks a date from a calendar: other months, no typing, closes without saving', async () => {
    const user = await openTab(/Transactions/);
    await user.click((await screen.findByText('ZELLE TO LANDLORD')).closest('button')!);
    const drawer = await screen.findByRole('dialog', { name: 'ZELLE TO LANDLORD' });
    const open = () => user.click(within(drawer).getByLabelText('Date'));
    expect(within(drawer).getByLabelText('Date')).toHaveTextContent('October 2, 2026');

    // closes without saving: Escape, and a click outside
    await open();
    await within(drawer).findByRole('group', { name: 'Choose a date' });
    await user.keyboard('{Escape}');
    expect(within(drawer).queryByRole('group', { name: 'Choose a date' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'ZELLE TO LANDLORD' })).toBeInTheDocument(); // drawer stays
    await open();
    await user.click(within(drawer).getByText('TRANSACTION'));
    expect(within(drawer).queryByRole('group', { name: 'Choose a date' })).toBeNull();
    expect(patches()).toEqual([]);

    // another month, with the neighbouring days shown dimmed, then pick one
    await open();
    const calendar = await within(drawer).findByRole('group', { name: 'Choose a date' });
    await user.click(within(calendar).getByRole('button', { name: 'Previous month' }));
    expect(within(calendar).getByText('September 2026')).toBeInTheDocument();
    await user.click(within(calendar).getByRole('button', { name: 'September 15, 2026' }));
    await waitFor(() => expect(patches()[0]?.body).toEqual({ date: '2026-09-15' }));

    // picking the date that is already chosen saves nothing
    await open();
    await user.click(
      within(within(drawer).getByRole('group', { name: 'Choose a date' })).getByRole('button', {
        name: 'September 15, 2026',
      }),
    );
    expect(patches().length).toBe(1);
  });

  it('does not offer dates more than a year ahead', async () => {
    const user = await openTab(/Transactions/);
    await user.click((await screen.findByText('ZELLE TO LANDLORD')).closest('button')!);
    const drawer = await screen.findByRole('dialog', { name: 'ZELLE TO LANDLORD' });
    await user.click(within(drawer).getByLabelText('Date'));
    const calendar = await within(drawer).findByRole('group', { name: 'Choose a date' });
    for (let i = 0; i < 40; i++)
      await user.click(within(calendar).getByRole('button', { name: 'Next month' }));
    for (const day of within(calendar).getAllByRole('button', { name: /, \d{4}$/ }))
      expect(day).toBeDisabled();
  });

  it('does not save notes that did not change', async () => {
    const user = await openTab(/Transactions/);
    await user.click((await screen.findByText('Acme Corp')).closest('button')!);
    const drawer = await screen.findByRole('dialog', { name: 'Acme Corp' });
    await user.click(within(drawer).getByLabelText('Notes'));
    await user.tab();
    expect(patches()).toEqual([]);
  });
});

describe('Transactions design', () => {
  // A wide screen: the matchMedia stub answers the wide-screen query with yes and everything else with no.
  const wideScreen = () =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width: 1280px'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  afterEach(() => {
    delete (window as any).matchMedia;
  });
  const lastList = () => [...calls].reverse().find((c) => /\/transactions\?/.test(c.url))!.url;

  it('each day is its own card under a heading with the day total', async () => {
    await openTab(/Transactions/);
    await screen.findByText('Whole Market');
    // the day holding Acme Corp: its card is a region named by its date, with the day's net total above it
    const day = (await screen.findByText('Acme Corp')).closest<HTMLElement>('section[aria-label]')!;
    expect(day).toHaveAccessibleName(/^[A-Z][a-z]+ \d+, 2026$/);
    expect(within(day).getByText('+$1,350.00')).toBeInTheDocument();
    expect(within(day).getByText('ZELLE TO LANDLORD')).toBeInTheDocument();
  });

  it('a long name is cut short on a phone instead of widening the page', async () => {
    await openTab(/Transactions/);
    // jsdom has no layout, so check the classes that let the name shrink: the name is its own element that may get
    // narrower than its text and ends in an ellipsis, while the Pending tag and the amount keep their width
    await screen.findByText('Whole Market');
    const tag = screen.getByText('Pending');
    const name = tag.parentElement!.firstElementChild!;
    expect(name).toHaveClass('truncate', 'min-w-0');
    expect(name.parentElement).toHaveClass('min-w-0');
    expect(tag).toHaveClass('shrink-0', 'whitespace-nowrap');
    const row = tag.closest('button')!;
    expect(row.lastElementChild).toHaveClass('shrink-0', 'tabular-nums');
  });

  it('When narrows the list to a month or a year; All time is the list as it was', async () => {
    const user = await openTab(/Transactions/);
    await screen.findByText('Whole Market');
    expect(lastList()).not.toContain('from=');
    expect(
      within(screen.getByRole('radiogroup', { name: 'When' })).getByRole('radio', {
        name: 'All time',
      }),
    ).toBeChecked();
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'When' })).getByRole('radio', {
        name: 'This month',
      }),
    );
    const monthStart = todayIso().slice(0, 8) + '01';
    await waitFor(() => expect(lastList()).toContain(`from=${monthStart}`));
    expect(lastList()).toContain('to=');
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'When' })).getByRole('radio', {
        name: 'This year',
      }),
    );
    await waitFor(() => expect(lastList()).toContain(`from=${todayIso().slice(0, 4)}-01-01`));
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'When' })).getByRole('radio', {
        name: 'All time',
      }),
    );
    await waitFor(() => expect(lastList()).not.toContain('from='));
  });

  it('Custom range asks for From and To; a start after the end moves the end, so the range stays valid', async () => {
    const user = await openTab(/Transactions/);
    await screen.findByText('Whole Market');
    const when = screen.getByRole('radiogroup', { name: 'When' });
    await user.click(within(when).getByRole('radio', { name: 'Custom range' }));
    const monthStart = todayIso().slice(0, 8) + '01';
    const today = todayIso();
    // a new range starts as this month, up to today
    await waitFor(() => expect(lastList()).toContain(`from=${monthStart}`));
    expect(lastList()).toContain(`to=${today}`);
    // To moves back to the first of the month: the range is one day
    await user.click(document.getElementById('transactions-to')!);
    await user.click(screen.getByRole('button', { name: dayLabel(monthStart) }));
    await waitFor(() => expect(lastList()).toContain(`to=${monthStart}`));
    // From moves past To: To follows it, so both are today
    await user.click(document.getElementById('transactions-from')!);
    await user.click(screen.getByRole('button', { name: dayLabel(today) }));
    await waitFor(() => expect(lastList()).toContain(`from=${today}&to=${today}`));
    // a preset takes the range away again
    await user.click(within(when).getByRole('radio', { name: 'All time' }));
    await waitFor(() => expect(lastList()).not.toContain('from='));
    expect(screen.queryByLabelText('From')).toBeNull();
  });

  it('accounts are listed under their bank, several can be picked, and All accounts clears them', async () => {
    const user = await openTab(/Transactions/);
    await screen.findByText('Whole Market');
    const accounts = screen.getByRole('group', { name: 'Accounts' });
    const bank = within(accounts).getByRole('group', { name: 'Test Bank' });
    const picks = within(bank).getAllByRole('button');
    expect(picks.length).toBeGreaterThanOrEqual(2);
    expect(within(accounts).getByRole('button', { name: 'All accounts' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(picks[0]);
    await user.click(picks[1]);
    expect(picks[0]).toHaveAttribute('aria-pressed', 'true');
    expect(picks[1]).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(lastList()).toMatch(/accounts=/));
    expect(new URL(lastList(), 'http://x').searchParams.get('accounts')!.split(',')).toHaveLength(
      2,
    );
    // taking one away leaves the other
    await user.click(picks[0]);
    await waitFor(() =>
      expect(new URL(lastList(), 'http://x').searchParams.get('accounts')!.split(',')).toHaveLength(
        1,
      ),
    );
    await user.click(within(accounts).getByRole('button', { name: 'All accounts' }));
    await waitFor(() => expect(lastList()).not.toContain('accounts='));
    expect(picks[1]).toHaveAttribute('aria-pressed', 'false');
  });

  it('categories are chips: several can be picked at once, and a chip picked again lets go', async () => {
    const user = await openTab(/Transactions/);
    await screen.findByText('Whole Market');
    const chips = within(screen.getByRole('group', { name: 'Categories' })).getAllByRole('button');
    expect(chips.length).toBeGreaterThanOrEqual(2);
    await user.click(chips[0]);
    await user.click(chips[1]);
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(
        new URL(lastList(), 'http://x').searchParams.get('categories')!.split(','),
      ).toHaveLength(2),
    );
    await user.click(chips[0]);
    expect(chips[0]).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() =>
      expect(
        new URL(lastList(), 'http://x').searchParams.get('categories')!.split(','),
      ).toHaveLength(1),
    );
    expect(lastList()).not.toMatch(/[?&]category=/);
  });

  it('on a phone the filters fold behind a Filters button that counts what is picked', async () => {
    const user = await openTab(/Transactions/);
    await screen.findByText('Whole Market');
    const toggle = screen.getByRole('button', { name: /^Filters/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(
      within(screen.getByRole('group', { name: 'Categories' })).getAllByRole('button')[0],
    );
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument();
  });

  it('adding a transaction is one button: a floating round one on a phone, named all the same', async () => {
    await openTab(/Transactions/);
    const add = await screen.findByRole('button', { name: 'Add transaction' });
    expect(add.className).toContain('max-[760px]:fixed');
    expect(add.className).toContain('max-[760px]:rounded-full'.replace('max-[760px]:', ''));
    expect(add.className).toContain('safe-area-inset-bottom');
  });

  it('on a narrow screen the detail covers the page, as a sheet from the bottom on a phone', async () => {
    const user = await openTab(/Transactions/);
    await user.click((await screen.findByText('Acme Corp')).closest('button')!);
    const sheet = await screen.findByRole('dialog', { name: 'Acme Corp' });
    expect(sheet.className).toContain('max-[760px]:rounded-t-[26px]');
    expect(screen.queryByRole('complementary', { name: 'Transaction details' })).toBeNull();
  });

  it('on a wide screen the detail sits beside the list: no cover, the row marked, Escape closes it', async () => {
    wideScreen();
    const user = await openTab(/Transactions/);
    const row = (await screen.findByText('ZELLE TO LANDLORD')).closest('button')!;
    await user.click(row);
    const docked = await screen.findByRole('complementary', { name: 'Transaction details' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(docked).getByText('Original statement')).toBeInTheDocument();
    expect(row.className).toContain('bg-accent');
    // it edits the same way as in the drawer
    await user.selectOptions(within(docked).getByLabelText('Category'), '3');
    await waitFor(() => expect(patches()[0]?.body).toEqual({ category_id: 3 }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Transaction details' })).toBeNull();
    // and the close button does the same
    await user.click(row);
    await user.click(
      within(await screen.findByRole('complementary')).getByRole('button', {
        name: 'Close transaction details',
      }),
    );
    expect(screen.queryByRole('complementary', { name: 'Transaction details' })).toBeNull();
  });

  it('on a wide screen a pending transaction is read-only beside the list too', async () => {
    wideScreen();
    const user = await openTab(/Transactions/);
    await user.click((await screen.findByText('Whole Market')).closest('button')!); // pending
    const docked = await screen.findByRole('complementary', { name: 'Transaction details' });
    expect(within(docked).getByRole('note')).toHaveTextContent(/pending/);
    expect(within(docked).queryByLabelText('Category')).toBeNull();
  });
});

describe('Merchant history link', () => {
  it('the drawer links to the merchant, and money in opens it as income', async () => {
    const user = await openTab(/Transactions/);
    await user.click((await screen.findByText('Acme Corp')).closest('button')!);
    const drawer = await screen.findByRole('dialog', { name: 'Acme Corp' });
    const link = await within(drawer).findByRole('link', { name: 'View 4 transactions' });
    expect(link).toHaveAttribute(
      'href',
      '/reports/merchant/Acme%20Corp?range=all-time&type=income&via=income',
    );
    await user.click(link);
    expect(location.pathname).toBe('/reports/merchant/Acme%20Corp');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByRole('img', { name: 'Acme Corp per period' })).toBeInTheDocument();
  });
});

describe('Pending transactions', () => {
  it('open read-only: nothing on them can be changed', async () => {
    const user = await openTab(/Transactions/);
    await user.click((await screen.findByText('Whole Market')).closest('button')!); // pending
    const drawer = await screen.findByRole('dialog', { name: 'Whole Market' });
    expect(within(drawer).getByRole('note')).toHaveTextContent(
      /pending, so it can't be edited until it posts/,
    );
    // the values are shown, as text
    expect(within(drawer).getByText('October 3, 2026')).toBeInTheDocument();
    expect(within(drawer).getByText(/Groceries/)).toBeInTheDocument();
    expect(within(drawer).getByText('Original statement')).toBeInTheDocument();
    // but there is nothing to edit
    expect(within(drawer).queryByLabelText('Date')).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Date' })).toBeNull();
    expect(within(drawer).queryByLabelText('Category')).toBeNull();
    expect(within(drawer).queryByLabelText('Notes')).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Split' })).toBeNull();
    expect(
      within(drawer).queryByRole('button', { name: /Reset to bank date|Edit split/ }),
    ).toBeNull();
    expect(within(drawer).queryByText(/Changes save automatically/)).toBeNull();
    expect(within(drawer).queryByRole('textbox')).toBeNull();
    expect(within(drawer).queryByRole('combobox')).toBeNull();
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('keep a split read-only too, and a posted transaction stays editable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(stubApi(calls, [{ ...splitTransaction, pending: true }, plainTransaction])),
    );
    const user = await openTab(/Transactions/);
    await user.click((await screen.findByText('Big Box')).closest('button')!);
    let drawer = await screen.findByRole('dialog', { name: 'Big Box' });
    expect(within(drawer).getByText(/Split into 2 parts/)).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Edit split' })).toBeNull();
    await user.click(within(drawer).getByRole('button', { name: /Close transaction details/ }));
    await user.click((await screen.findByText('Roaster Shop')).closest('button')!);
    drawer = await screen.findByRole('dialog', { name: 'Roaster Shop' });
    expect(within(drawer).queryByRole('note')).toBeNull();
    expect(within(drawer).getByLabelText('Notes')).toBeInTheDocument();
  });
});

describe('Splitting a transaction', () => {
  const withExtra = (...extra: any[]) => vi.stubGlobal('fetch', vi.fn(stubApi(calls, extra)));
  beforeEach(() => withExtra(plainTransaction));
  const puts = () => calls.filter((c) => c.method === 'PUT');

  it('shows a split transaction with its parts under it, and totals it once', async () => {
    withExtra(splitTransaction);
    await openTab(/Transactions/);
    const parent = (await screen.findByText('Big Box')).closest('button')!;
    expect(within(parent).getByText(/Split · 2 parts/)).toBeInTheDocument();
    expect(within(parent).getByText('$100.00')).toBeInTheDocument();
    const first = screen.getByRole('button', { name: 'Part 1 of Big Box' });
    expect(within(first).getByText('food')).toBeInTheDocument(); // the part's notes label it
    expect(within(first).getByText(/Groceries/)).toBeInTheDocument();
    expect(within(first).getByText('$60.00')).toBeInTheDocument();
    const second = screen.getByRole('button', { name: 'Part 2 of Big Box' });
    expect(within(second).getByText('Part 2')).toBeInTheDocument();
    expect(within(second).getByText(/Rent/)).toBeInTheDocument();
    expect(within(second).getByText('Oct 15')).toBeInTheDocument(); // this part has its own date
    expect(within(first).queryByText(/Oct/)).toBeNull(); // the other keeps the transaction's date
    // the day total counts the $100 once (not 100 + 60 + 40)
    expect(screen.getByText('October 1, 2026').parentElement!.textContent).toContain('−$100.00');
  });

  it('splits into parts: shows what is left, saves only when it adds up', async () => {
    const user = await openTab(/Transactions/);
    await user.click((await screen.findByText('Roaster Shop')).closest('button')!); // $64.10
    const drawer = await screen.findByRole('dialog', { name: 'Roaster Shop' });
    await user.click(within(drawer).getByRole('button', { name: 'Split' }));
    const editor = within(drawer).getByRole('group', { name: 'Split' });
    const save = within(editor).getByRole('button', { name: 'Save split' });
    expect(within(editor).queryByText(/changed this amount/)).toBeNull(); // nothing is out of balance yet
    expect(within(editor).getByLabelText('Amount of part 1')).toHaveValue('64.10');
    expect(save).toBeDisabled(); // part 2 is empty
    const one = within(editor).getByLabelText('Amount of part 1');
    await user.clear(one);
    await user.type(one, '40');
    expect(within(editor).getByText('24.10 left to assign')).toBeInTheDocument();
    await user.type(within(editor).getByLabelText('Amount of part 2'), '30');
    expect(within(editor).getByText('5.90 too much')).toBeInTheDocument();
    expect(save).toBeDisabled();
    await user.clear(within(editor).getByLabelText('Amount of part 2'));
    await user.type(within(editor).getByLabelText('Amount of part 2'), '24.10');
    expect(within(editor).getByText(/is assigned/)).toBeInTheDocument();
    await user.selectOptions(within(editor).getByLabelText('Category of part 2'), '2');
    await user.type(within(editor).getByLabelText('Notes of part 2'), 'rent share');
    await user.click(save);
    await waitFor(() =>
      expect(puts()[0]).toMatchObject({
        url: '/api/transactions/t6/splits',
        body: {
          splits: [
            { amount: '40.00', category_id: 1, notes: '', date: null },
            { amount: '24.10', category_id: 2, notes: 'rent share', date: null },
          ],
        },
      }),
    );
    // the drawer now shows the split in place of the category
    expect(await within(drawer).findByText(/Split into 2 parts/)).toBeInTheDocument();
  });

  const openSplit = async (name: string) => {
    const user = await openTab(/Transactions/);
    await user.click((await screen.findByText(name)).closest('button')!);
    const drawer = await screen.findByRole('dialog', { name });
    await user.click(within(drawer).getByRole('button', { name: 'Split' }));
    return { user, drawer };
  };

  it('splits evenly into N parts; leftover cents go to the first parts', async () => {
    const { user, drawer } = await openSplit('Roaster Shop'); // $64.10
    const count = within(drawer).getByLabelText('Number of parts');
    await user.clear(count);
    await user.type(count, '3');
    await user.click(within(drawer).getByRole('button', { name: 'Split evenly' }));
    expect(within(drawer).getByLabelText('Amount of part 1')).toHaveValue('21.37');
    expect(within(drawer).getByLabelText('Amount of part 2')).toHaveValue('21.37');
    expect(within(drawer).getByLabelText('Amount of part 3')).toHaveValue('21.36');
    expect(within(drawer).getByText(/is assigned/)).toBeInTheDocument();
    // the parts can still be adjusted by hand afterwards
    await user.type(within(drawer).getByLabelText('Notes of part 3'), 'tip');
    await user.click(within(drawer).getByRole('button', { name: 'Save split' }));
    await waitFor(() =>
      expect(puts()[0]?.body.splits).toEqual([
        { amount: '21.37', category_id: 1, notes: '', date: null },
        { amount: '21.37', category_id: 1, notes: '', date: null },
        { amount: '21.36', category_id: 1, notes: 'tip', date: null },
      ]),
    );
  });

  it('only offers 2 to 20 equal parts', async () => {
    const { user, drawer } = await openSplit('Roaster Shop');
    const count = within(drawer).getByLabelText('Number of parts');
    const go = within(drawer).getByRole('button', { name: 'Split evenly' });
    for (const [value, ok] of [
      ['2', true],
      ['1', false],
      ['21', false],
      ['20', true],
      ['', false],
    ] as const) {
      await user.clear(count);
      if (value) await user.type(count, value);
      if (ok) expect(go).toBeEnabled();
      else expect(go).toBeDisabled();
    }
  });

  it('can space the dates one per week or per month', async () => {
    const { user, drawer } = await openSplit('Roaster Shop'); // dated October 3, 2026
    const count = within(drawer).getByLabelText('Number of parts');
    await user.clear(count);
    await user.type(count, '3');
    await user.selectOptions(within(drawer).getByLabelText('Spacing of dates'), 'monthly');
    await user.click(within(drawer).getByRole('button', { name: 'Split evenly' }));
    expect(within(drawer).getByLabelText('Date', { selector: '#part-date-0' })).toHaveTextContent(
      'October 3, 2026',
    );
    expect(within(drawer).getByLabelText('Date', { selector: '#part-date-1' })).toHaveTextContent(
      'November 3, 2026',
    );
    expect(within(drawer).getByLabelText('Date', { selector: '#part-date-2' })).toHaveTextContent(
      'December 3, 2026',
    );
    await user.click(within(drawer).getByRole('button', { name: 'Save split' }));
    await waitFor(() =>
      expect(puts()[0]?.body.splits.map((s: any) => s.date)).toEqual([
        null,
        '2026-11-03',
        '2026-12-03',
      ]),
    );
  });

  it('weekly spacing, and refuses parts dated more than a year ahead', async () => {
    const { user, drawer } = await openSplit('Roaster Shop');
    const count = within(drawer).getByLabelText('Number of parts');
    await user.clear(count);
    await user.type(count, '3');
    await user.selectOptions(within(drawer).getByLabelText('Spacing of dates'), 'weekly');
    await user.click(within(drawer).getByRole('button', { name: 'Split evenly' }));
    expect(within(drawer).getByLabelText('Date', { selector: '#part-date-1' })).toHaveTextContent(
      'October 10, 2026',
    );
    await user.clear(count);
    await user.type(count, '20');
    await user.selectOptions(within(drawer).getByLabelText('Spacing of dates'), 'monthly');
    await user.click(within(drawer).getByRole('button', { name: 'Split evenly' }));
    expect(within(drawer).getByText('A part is dated more than a year ahead')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Save split' })).toBeDisabled();
  });

  it('gives each part its own date from a calendar, and can put it back', async () => {
    const { user, drawer } = await openSplit('Roaster Shop');
    const part2 = within(drawer).getByLabelText('Date', { selector: '#part-date-1' });
    expect(part2).toHaveTextContent('October 3, 2026'); // the transaction's own date
    expect(within(drawer).queryByRole('button', { name: /Use the transaction's date/ })).toBeNull();
    await user.click(part2);
    await user.click(await screen.findByRole('button', { name: 'October 20, 2026' }));
    expect(part2).toHaveTextContent('October 20, 2026');
    await user.click(
      within(drawer).getByRole('button', { name: "Use the transaction's date for part 2" }),
    );
    expect(part2).toHaveTextContent('October 3, 2026');
    await user.click(part2);
    await user.click(await screen.findByRole('button', { name: 'October 25, 2026' }));
    const one = within(drawer).getByLabelText('Amount of part 1');
    await user.clear(one);
    await user.type(one, '40');
    await user.type(within(drawer).getByLabelText('Amount of part 2'), '24.10');
    await user.click(within(drawer).getByRole('button', { name: 'Save split' }));
    await waitFor(() =>
      expect(puts()[0]?.body.splits.map((s: any) => s.date)).toEqual([null, '2026-10-25']),
    );
  });

  it('adds and removes parts, and the new part starts with what is left', async () => {
    const user = await openTab(/Transactions/);
    await user.click((await screen.findByText('Roaster Shop')).closest('button')!);
    const drawer = await screen.findByRole('dialog', { name: 'Roaster Shop' });
    await user.click(within(drawer).getByRole('button', { name: 'Split' }));
    const one = within(drawer).getByLabelText('Amount of part 1');
    await user.clear(one);
    await user.type(one, '20');
    await user.click(within(drawer).getByRole('button', { name: 'Add part' }));
    expect(within(drawer).getByLabelText('Amount of part 3')).toHaveValue('44.10');
    expect(within(drawer).getByRole('button', { name: 'Remove part 3' })).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Remove part 3' }));
    expect(within(drawer).queryByLabelText('Amount of part 3')).toBeNull();
    // never fewer than two parts
    expect(within(drawer).queryByRole('button', { name: 'Remove part 2' })).toBeNull();
  });

  it('uses the sign of the transaction: money in is split into money in', async () => {
    withExtra(refund);
    const user = await openTab(/Transactions/);
    await user.click((await screen.findByText('Refund Store')).closest('button')!);
    const drawer = await screen.findByRole('dialog', { name: 'Refund Store' });
    await user.click(within(drawer).getByRole('button', { name: 'Split' }));
    const one = within(drawer).getByLabelText('Amount of part 1');
    expect(one).toHaveValue('30.00'); // shown as a plain amount
    await user.clear(one);
    await user.type(one, '10');
    await user.type(within(drawer).getByLabelText('Amount of part 2'), '20');
    await user.click(within(drawer).getByRole('button', { name: 'Save split' }));
    await waitFor(() =>
      expect(puts()[0]?.body.splits.map((s: any) => s.amount)).toEqual(['-10.00', '-20.00']),
    );
  });

  it('edits an existing split, removes it after asking, and can be cancelled', async () => {
    withExtra(splitTransaction);
    const user = await openTab(/Transactions/);
    await user.click((await screen.findByText('Big Box')).closest('button')!);
    const drawer = await screen.findByRole('dialog', { name: 'Big Box' });
    expect(within(drawer).queryByLabelText('Category')).toBeNull(); // replaced by the split summary
    expect(within(drawer).getByText(/Split into 2 parts/)).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Edit split' }));
    expect(within(drawer).getByLabelText('Amount of part 1')).toHaveValue('60.00');
    expect(within(drawer).getByLabelText('Notes of part 1')).toHaveValue('food');
    await user.click(within(drawer).getByRole('button', { name: 'Cancel' }));
    expect(puts()).toEqual([]);

    await user.click(within(drawer).getByRole('button', { name: 'Edit split' }));
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    await user.click(within(drawer).getByRole('button', { name: 'Remove split' }));
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
    await user.click(within(drawer).getByRole('button', { name: 'Remove split' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/transactions/t4/splits'),
    );
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(within(drawer).getByLabelText('Category')).toBeInTheDocument());
  });

  it('warns when the bank changed the amount after the split', async () => {
    withExtra({ ...splitTransaction, split_balanced: false });
    const user = await openTab(/Transactions/);
    const parent = (await screen.findByText('Big Box')).closest('button')!;
    expect(within(parent).getByText('Amount changed')).toBeInTheDocument();
    await user.click(parent);
    const drawer = await screen.findByRole('dialog', { name: 'Big Box' });
    await user.click(within(drawer).getByRole('button', { name: 'Edit split' }));
    expect(within(drawer).getByText(/changed this amount after it was split/)).toBeInTheDocument();
  });

  it('hides split amounts to edit in private mode', async () => {
    const user = await openTab(/Transactions/);
    await user.click(screen.getByRole('button', { name: /Private mode/ }));
    await user.click((await screen.findByText('Roaster Shop')).closest('button')!);
    const drawer = await screen.findByRole('dialog', { name: 'Roaster Shop' });
    await user.click(within(drawer).getByRole('button', { name: 'Split' }));
    expect(within(drawer).getByText(/Turn off Private mode to split/)).toBeInTheDocument();
    expect(within(drawer).queryByLabelText('Amount of part 1')).toBeNull();
  });
});

describe('Settings categories', () => {
  const card = () => screen.getByRole('heading', { name: 'Categories' }).closest('section')!;
  const body = (method: string, url: string) =>
    calls.find((c) => c.method === method && c.url === url)?.body;

  it('shows Income, Expenses and Transfers, each with its groups and categories', async () => {
    await openTab(/Settings/, 'Categories');
    await screen.findByRole('heading', { name: 'Income' });
    expect(
      within(card())
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Income', 'Expenses', 'Transfers']);
    const food = within(card()).getByRole('group', { name: 'Food & Dining' });
    expect(within(food).getByText('Groceries')).toBeInTheDocument();
    expect(within(food).getByText('Dog food')).toBeInTheDocument();
    expect(within(food).getByText('Custom')).toBeInTheDocument(); // only the user's own
    expect(within(card()).getByRole('group', { name: 'Income' })).toHaveTextContent('Paychecks');
    expect(within(card()).getByRole('group', { name: 'Transfers' })).toHaveTextContent('Transfer');
  });

  it('creates a category under a group, with a chosen icon', async () => {
    const user = await openTab(/Settings/, 'Categories');
    await screen.findByRole('heading', { name: 'Income' });
    const food = within(card()).getByRole('group', { name: 'Food & Dining' });
    await user.click(within(food).getByRole('button', { name: 'Create Category' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create Category' });
    await user.type(within(dialog).getByLabelText('Category name'), 'Pet supplies');
    await user.click(within(dialog).getByRole('button', { name: 'Choose icon' }));
    await user.click(within(dialog).getByRole('tab', { name: 'Shopping' }));
    await user.click(within(dialog).getByRole('button', { name: 'dog pet' }));
    expect(within(dialog).getByRole('button', { name: 'Choose icon' })).toHaveTextContent('🐶');
    expect(within(dialog).getByLabelText('Group')).toHaveValue('2'); // the group it was opened from
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(body('POST', '/api/categories')).toEqual({
        name: 'Pet supplies',
        emoji: '🐶',
        group_id: 2,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes a category or group dialog without saving: X button, Escape, or clicking outside', async () => {
    const user = await openTab(/Settings/, 'Categories');
    await screen.findByRole('heading', { name: 'Income' });
    const writes = () => calls.filter((c) => c.method !== 'GET' && c.url.includes('categor'));

    await user.click(within(card()).getByRole('button', { name: /Dog food/ }));
    let dialog = await screen.findByRole('dialog', { name: 'Edit Category' });
    await user.type(within(dialog).getByLabelText('Category name'), ' changed');
    await user.click(within(dialog).getByRole('button', { name: 'Close Edit Category' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(within(card()).getByRole('button', { name: /Dog food/ }));
    await screen.findByRole('dialog', { name: 'Edit Category' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Edit group Food & Dining' }));
    dialog = await screen.findByRole('dialog', { name: 'Edit Group' });
    await user.click(within(dialog).getByRole('button', { name: 'Close Edit Group' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes()).toEqual([]); // nothing was saved
    // reopening shows the original, not the discarded text
    await user.click(within(card()).getByRole('button', { name: /Dog food/ }));
    expect(await screen.findByLabelText('Category name')).toHaveValue('Dog food');
  });

  it('searches icons by name and accepts a pasted emoji', async () => {
    const user = await openTab(/Settings/, 'Categories');
    await screen.findByRole('heading', { name: 'Income' });
    await user.click(
      within(within(card()).getByRole('group', { name: 'Housing' })).getByRole('button', {
        name: 'Create Category',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Choose icon' }));
    await user.type(within(dialog).getByLabelText('Search icons'), 'coffee');
    expect(within(dialog).getByRole('button', { name: 'coffee' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'dog pet' })).toBeNull();
    await user.clear(within(dialog).getByLabelText('Search icons'));
    await user.click(within(dialog).getByRole('button', { name: 'Choose icon' })); // close
    await user.click(within(dialog).getByRole('button', { name: 'Choose icon' })); // open again
    await user.click(within(dialog).getByLabelText('Search icons'));
    await user.paste('🧶');
    expect(within(dialog).getByRole('button', { name: 'Choose icon' })).toHaveTextContent('🧶');
  });

  it('edits a category: name, icon and group', async () => {
    const user = await openTab(/Settings/, 'Categories');
    await screen.findByRole('heading', { name: 'Income' });
    await user.click(within(card()).getByRole('button', { name: /Dog food/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Category' });
    const name = within(dialog).getByLabelText('Category name');
    expect(name).toHaveValue('Dog food');
    await user.clear(name);
    await user.type(name, 'Pet food');
    // only groups of the same type (expenses) are offered
    const options = within(within(dialog).getByLabelText('Group')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Food & Dining', 'Housing', 'Other']);
    await user.selectOptions(within(dialog).getByLabelText('Group'), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(body('PATCH', '/api/categories/7')).toEqual({
        name: 'Pet food',
        emoji: '🐶',
        group_id: 3,
      }),
    );
  });

  it('asks before deleting a category, and never offers to delete Uncategorized', async () => {
    const user = await openTab(/Settings/, 'Categories');
    await screen.findByRole('heading', { name: 'Income' });
    await user.click(within(card()).getByRole('button', { name: /Uncategorized/ }));
    let dialog = await screen.findByRole('dialog', { name: 'Edit Category' });
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeDisabled();
    await user.click(dialog.parentElement!); // click outside to close
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    await user.click(within(card()).getByRole('button', { name: /Dog food/ }));
    dialog = await screen.findByRole('dialog', { name: 'Edit Category' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(confirm.mock.calls[0][0]).toMatch(
      /0 transactions will go back to their automatic category/,
    );
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/categories/7'),
    );
  });

  it('creates, renames and deletes groups; only an empty group can be deleted', async () => {
    const user = await openTab(/Settings/, 'Categories');
    await screen.findByRole('heading', { name: 'Income' });
    const expenses = card().querySelectorAll('.category-type')[1] as HTMLElement;
    await user.click(within(expenses).getByRole('button', { name: 'Create group' }));
    let dialog = await screen.findByRole('dialog', { name: 'Create Group' });
    await user.type(within(dialog).getByLabelText('Group name'), 'Pets');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(body('POST', '/api/category-groups')).toEqual({ name: 'Pets', type: 'expense' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Edit group Food & Dining' }));
    dialog = await screen.findByRole('dialog', { name: 'Edit Group' });
    expect(within(dialog).getByRole('button', { name: 'Delete group' })).toBeDisabled(); // has categories
    const name = within(dialog).getByLabelText('Group name');
    await user.clear(name);
    await user.type(name, 'Eating out');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(body('PATCH', '/api/category-groups/2')).toEqual({ name: 'Eating out' }),
    );
  });
});
