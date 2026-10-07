import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { todayIso } from '../../src/lib/calendar.ts';
import { setPrivateMode } from '../../src/lib/format.ts';
import { lastRange, resolveSpec } from '../../src/lib/reportDates.ts';
import { cashFlowReport, categoryReport, stubApi } from './fixture.ts';

let calls: { url: string; method: string; body: any }[] = [];
function serve(reports: { cashFlow?: any; categories?: any } = {}) {
  vi.stubGlobal('fetch', vi.fn(stubApi(calls, [], undefined, reports)));
}
beforeEach(() => {
  localStorage.clear();
  setPrivateMode(false);
  calls = [];
  serve();
});
afterEach(() => setPrivateMode(false));

async function openReports() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText('TOTAL NET WORTH');
  await user.click(
    within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: /Reports/ }),
  );
  return user;
}
const last = (prefix: string) => {
  const urls = calls.filter((c) => c.url.startsWith(prefix)).map((c) => new URL(c.url, 'http://x'));
  return urls[urls.length - 1];
};
const tab = (name: string) => screen.getByRole('tab', { name });
// Reports opens on this year.
const yearStart = `${todayIso().slice(0, 4)}-01-01`;
const dateButton = () => screen.getByRole('button', { name: 'This year' });

describe('Reports tab', () => {
  it('opens on this year, and the address stays bare until another range is chosen', async () => {
    await openReports();
    await screen.findByText('Total net income');
    expect(dateButton()).toBeInTheDocument();
    expect(location.pathname + location.search).toBe('/reports/cash-flow');
    const q = last('/api/reports/cash-flow').searchParams;
    expect([q.get('from'), q.get('to')]).toEqual([yearStart, todayIso()]);
  });

  it('opens the breakdown on the current month, and a category opened from it keeps that month', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    const month = todayIso().slice(0, 8) + '01';
    expect(screen.getByLabelText('Breakdown period')).toHaveValue(month);
    await waitFor(() => {
      const q = last('/api/reports/cash-flow').searchParams;
      expect([q.get('breakdownFrom'), q.get('breakdownTo')]).toEqual([month, todayIso()]);
      // the tiles and the chart still cover the whole range
      expect(q.get('from')).toBe(yearStart);
    });
    expect(screen.getByText('Where it went this month')).toBeInTheDocument();
    await user.click(
      await within(screen.getByRole('region', { name: 'Income breakdown' })).findByRole('button', {
        name: /Paychecks/,
      }),
    );
    await screen.findByRole('img', { name: 'Paychecks per period' });
    expect(location.search).toContain(`period=${month}`);
  });

  it('a range that stops before this month opens the breakdown on the whole range', async () => {
    history.replaceState(null, '', '/reports/cash-flow?range=last-year');
    render(<App />);
    await screen.findByText('Total net income');
    expect(screen.getByLabelText('Breakdown period')).toHaveValue('');
    expect(last('/api/reports/cash-flow').searchParams.get('breakdownFrom')).toBeNull();
  });

  it('is in the sidebar with Cash flow, Spending and Income, and has no data-source switch', async () => {
    await openReports();
    await screen.findByText('Total net income');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Cash flow',
      'Spending',
      'Income',
    ]);
    expect(tab('Cash flow')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByLabelText('Dataset')).toBeNull();
    expect(screen.queryByRole('button', { name: /Add account/ })).toBeNull();
  });

  it('cash flow shows the four tiles, then spending and income side by side with their shares', async () => {
    await openReports();
    await screen.findByText('Total net income');
    const tile = (label: string) =>
      screen
        .getAllByText(label)
        .map((e) => e.closest('.rpt-tile'))
        .find(Boolean) as HTMLElement;
    expect(within(tile('Total income')).getByText('$4,200.00')).toBeInTheDocument();
    expect(within(tile('Total expenses')).getByText('$2,650.50')).toBeInTheDocument();
    expect(within(tile('Total net income')).getByText('$1,549.50')).toBeInTheDocument();
    expect(within(tile('Savings rate')).getByText('36.9%')).toBeInTheDocument();
    const spending = screen.getByRole('region', { name: 'Spending breakdown' });
    expect(within(spending).getByText(/Rent/)).toBeInTheDocument();
    expect(within(spending).getByText('$1,850.00')).toBeInTheDocument();
    expect(within(spending).getByText('(69.8%)')).toBeInTheDocument();
    const income = screen.getByRole('region', { name: 'Income breakdown' });
    expect(within(income).getByText(/Paychecks/)).toBeInTheDocument();
    expect(within(income).getByText('$4,200.00')).toBeInTheDocument();
    // Summary is gone from the cash flow page: its figures are the four cards above
    expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull();
    expect(last('/api/reports/cash-flow').searchParams.get('interval')).toBe('month');
  });

  it('shows a dash for the savings rate when there was no income', async () => {
    serve({
      cashFlow: cashFlowReport({
        totals: { income: '0.00', expenses: '10.00', net: '-10.00', savings_rate: null },
      }),
    });
    await openReports();
    await screen.findByText('Total net income');
    expect(
      within(document.querySelector('.rpt-tiles') as HTMLElement).getByText('—'),
    ).toBeInTheDocument();
  });

  it('picking a period narrows only the breakdown, and the interval is sent to the server', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.selectOptions(screen.getByLabelText('Breakdown period'), '2026-09-01');
    await waitFor(() => {
      const q = last('/api/reports/cash-flow').searchParams;
      expect([q.get('breakdownFrom'), q.get('breakdownTo')]).toEqual(['2026-09-01', '2026-09-30']);
      expect(q.get('from')).toBe(yearStart);
    });
    await user.click(screen.getByRole('button', { name: 'Show the whole range' }));
    await waitFor(() =>
      expect(last('/api/reports/cash-flow').searchParams.get('breakdownFrom')).toBeNull(),
    );
    await user.selectOptions(screen.getByLabelText('Interval'), 'quarter');
    await waitFor(() =>
      expect(last('/api/reports/cash-flow').searchParams.get('interval')).toBe('quarter'),
    );
  });

  it('the Date popover applies a preset and the range follows the owner to the other tabs', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.click(dateButton());
    const dialog = screen.getByRole('dialog', { name: 'Date range' });
    await user.click(within(dialog).getByRole('button', { name: 'Last 7 days' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    const week = lastRange(7, 'day', todayIso());
    await waitFor(() => {
      const q = last('/api/reports/cash-flow').searchParams;
      expect([q.get('from'), q.get('to')]).toEqual([week.from, week.to]);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(tab('Spending'));
    await waitFor(() => {
      const q = last('/api/reports/categories').searchParams;
      expect([q.get('from'), q.get('to'), q.get('type')]).toEqual([week.from, week.to, 'expense']);
      const t = last('/api/transactions').searchParams;
      expect([t.get('from'), t.get('to'), t.get('type')]).toEqual([week.from, week.to, 'expense']);
    });
    // the address carries the range; only the page is remembered on this device, never the range
    expect(location.pathname + location.search).toBe('/reports/spending?range=last-7-days');
    expect(localStorage.getItem('moneyrill.reports.url')).toBe('/reports/spending');
  });

  it('"Last N units" needs a number and Clear returns to all time', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.click(dateButton());
    const dialog = screen.getByRole('dialog', { name: 'Date range' });
    await user.click(within(dialog).getByRole('button', { name: 'Last' }));
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.type(within(dialog).getByPlaceholderText('Enter number'), '3');
    await user.click(within(dialog).getByRole('radio', { name: 'Month' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    const three = lastRange(3, 'month', todayIso());
    await waitFor(() =>
      expect(last('/api/reports/cash-flow').searchParams.get('from')).toBe(three.from),
    );
    await user.click(screen.getByRole('button', { name: 'Last 3 months' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Date range' })).getByRole('button', {
        name: 'Clear',
      }),
    );
    await waitFor(() => expect(last('/api/reports/cash-flow').searchParams.get('from')).toBeNull());
  });

  it('the Filters popover sends the chosen categories and accounts, and counts them', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(within(dialog).getByText('0 filters selected')).toBeInTheDocument();
    // transfers never count, so they cannot be chosen
    expect(within(dialog).queryByText(/Transfer/)).toBeNull();
    await user.click(within(dialog).getByRole('checkbox', { name: /Groceries/ }));
    expect(within(dialog).getByText('1 filter selected')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Accounts' }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Everyday checking/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      const q = last('/api/reports/cash-flow').searchParams;
      expect([q.get('categories'), q.get('accounts')]).toEqual(['1', 'checking']);
    });
    expect(screen.getByRole('button', { name: 'Filters · 2' })).toBeInTheDocument();
  });

  it('choosing every category in a group, then removing a chip', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Food & Dining' }));
    expect(within(dialog).getByText('2 filters selected')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Remove Dog food/ }));
    expect(within(dialog).getByText('1 filter selected')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Search filters'), 'rent');
    expect(within(dialog).queryByRole('checkbox', { name: /Groceries/ })).toBeNull();
    expect(within(dialog).getByRole('checkbox', { name: /Rent/ })).toBeInTheDocument();
  });

  it('spending shows the donut total, legend, transactions and summary', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.click(tab('Spending'));
    await screen.findByText('Total transactions');
    const donut = screen.getByRole('img', { name: 'Spending by category' }).parentElement!;
    expect(within(donut).getByText('$2,650.50')).toBeInTheDocument();
    const legend = screen.getByRole('list');
    // a category with a negative net (refunds) cannot be drawn and is not listed
    expect(within(legend).getAllByRole('listitem')).toHaveLength(2);
    expect(within(legend).getByText(/Rent/)).toBeInTheDocument();
    expect(within(legend).getByText('$1,850.00 (69.8%)')).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('41')).toBeInTheDocument();
    expect(within(summary).getByText('$64.65')).toBeInTheDocument();
    expect(within(summary).getByText('August 1, 2026')).toBeInTheDocument();
    expect(await screen.findByText('Whole Market')).toBeInTheDocument();
  });

  it('clicking a legend item opens that category, period by period', async () => {
    // this year ends today, so the month is cut to today while it is not over
    const octoberTo = todayIso() < '2026-10-31' ? todayIso() : '2026-10-31';
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.click(tab('Spending'));
    await screen.findByText('Total transactions');
    await user.click(within(screen.getByRole('list')).getByRole('button', { name: /Groceries/ }));
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText(/Groceries/)).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByRole('img', { name: 'Groceries per period' })).toBeInTheDocument();
    const flow = last('/api/reports/cash-flow').searchParams;
    expect([flow.get('categories'), flow.get('interval'), flow.get('today')]).toEqual([
      '1',
      'month',
      todayIso(),
    ]);
    // the latest period with spending is shown first; October is not over in the made-up data
    expect(
      await screen.findByRole('heading', { name: 'October 2026 (so far)' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      const t = last('/api/transactions').searchParams;
      expect([t.get('from'), t.get('to'), t.get('categories'), t.get('type')]).toEqual([
        '2026-10-01',
        octoberTo,
        '1',
        'expense',
      ]);
      const sum = last('/api/reports/categories').searchParams;
      expect([sum.get('from'), sum.get('to'), sum.get('categories')]).toEqual([
        '2026-10-01',
        octoberTo,
        '1',
      ]);
    });
    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument();
  });

  it('a category page switches periods and intervals, and goes back to the report it came from', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.click(tab('Spending'));
    await screen.findByText('Total transactions');
    await user.click(within(screen.getByRole('list')).getByRole('button', { name: /Rent/ }));
    await screen.findByRole('heading', { name: 'October 2026 (so far)' });
    await user.selectOptions(screen.getByLabelText('Period'), '2026-09-01');
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
    await waitFor(() => {
      const t = last('/api/transactions').searchParams;
      expect([t.get('from'), t.get('to'), t.get('categories')]).toEqual([
        '2026-09-01',
        '2026-09-30',
        '2',
      ]);
    });
    await user.click(screen.getByRole('button', { name: 'Quarterly' }));
    await waitFor(() =>
      expect(last('/api/reports/cash-flow').searchParams.get('interval')).toBe('quarter'),
    );
    expect(screen.getByRole('button', { name: 'Quarterly' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', {
        name: 'Spending',
      }),
    );
    expect(tab('Spending')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Total transactions')).toBeInTheDocument();
  });

  it('a category in the cash flow breakdown opens it as income or spending', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    const breakdown = screen.getByRole('region', { name: 'Income breakdown' });
    await user.click(within(breakdown).getByRole('button', { name: /Paychecks/ }));
    expect(await screen.findByRole('img', { name: 'Paychecks per period' })).toBeInTheDocument();
    await waitFor(() => {
      const t = last('/api/transactions').searchParams;
      expect([t.get('type'), t.get('categories')]).toEqual(['income', '3']);
    });
    expect(
      within(screen.getByRole('region', { name: 'Summary' })).getByText('Total income'),
    ).toBeInTheDocument();
  });

  it("a category page keeps the chosen date range: the period's dates are cut to it", async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.click(dateButton());
    const dialog = screen.getByRole('dialog', { name: 'Date range' });
    await user.click(within(dialog).getByRole('button', { name: 'Last 7 days' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    const week = lastRange(7, 'day', todayIso());
    const breakdown = await screen.findByRole('region', { name: 'Spending breakdown' });
    await user.click(within(breakdown).getByRole('button', { name: /Rent/ }));
    await screen.findByRole('heading', { name: 'October 2026 (so far)' });
    await waitFor(() => {
      const t = last('/api/transactions').searchParams;
      expect([t.get('from'), t.get('to')]).toEqual([
        week.from > '2026-10-01' ? week.from : '2026-10-01',
        week.to < '2026-10-31' ? week.to : '2026-10-31',
      ]);
      expect(last('/api/reports/cash-flow').searchParams.get('from')).toBe(week.from);
    });
  });

  it('income lists income, with the type sent to the server', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.click(tab('Income'));
    await screen.findByText('Total transactions');
    expect(screen.getByRole('img', { name: 'Income by category' })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('Total income').nextSibling).toHaveTextContent('+$4,200.00');
    await waitFor(() => expect(last('/api/transactions').searchParams.get('type')).toBe('income'));
  });

  it('editing a transaction from a report reloads the figures', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.click(tab('Spending'));
    // a posted transaction: a pending one is read-only
    await user.click(await screen.findByText('ZELLE TO LANDLORD'));
    const before = calls.filter((c) => c.url.startsWith('/api/reports/categories')).length;
    await user.type(await screen.findByLabelText('Notes'), 'x');
    await user.tab();
    await waitFor(() =>
      expect(
        calls.filter((c) => c.url.startsWith('/api/reports/categories')).length,
      ).toBeGreaterThan(before),
    );
  });

  it('private mode hides every amount but keeps percentages', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.click(screen.getByRole('button', { name: /Private mode/ }));
    expect(screen.queryByText('$4,200.00')).toBeNull();
    expect(screen.queryByText('$1,850.00')).toBeNull();
    expect(screen.getAllByText('••••••').length).toBeGreaterThan(5);
    expect(screen.getAllByText('36.9%').length).toBeGreaterThan(0);
    expect(screen.getByText('(69.8%)')).toBeInTheDocument();
    await user.click(tab('Spending'));
    await screen.findByText('Total transactions');
    expect(screen.queryByText('$2,650.50')).toBeNull();
    expect(
      screen.getByText('$1,850.00 (69.8%)'.replace('$1,850.00', '••••••')),
    ).toBeInTheDocument();
  });

  it('says so when nothing matches, and when there is nothing yet', async () => {
    serve({
      cashFlow: cashFlowReport({ first_date: null, last_date: null, series: [] }),
      categories: categoryReport('expense', { total: '0.00', slices: [] }),
    });
    const user = await openReports();
    // Reports opens on this year, so an empty page names the date range first
    await screen.findByText(/No income or spending in this date range/);
    await user.click(tab('Spending'));
    await screen.findByText(/No spending in this date range/);
    await user.click(dateButton());
    await user.click(
      within(screen.getByRole('dialog', { name: 'Date range' })).getByRole('button', {
        name: 'Clear',
      }),
    );
    await screen.findByText(/No transactions yet/);
    // with a category or account filter on, the message says the filter matched nothing
    cleanup();
    history.replaceState(null, '', '/reports/spending?range=all-time&categories=1');
    render(<App />);
    await screen.findByText('No spending matches these filters.');
  });

  it('reopens the report left on this device, over the default range: the range and filters are not kept', async () => {
    // an older release kept the whole address, here an all-time Income report with a filter
    localStorage.setItem('moneyrill.reports.url', '/reports/income?range=all-time&categories=3');
    await openReports();
    await screen.findByText('Total transactions');
    expect(tab('Income')).toHaveAttribute('aria-selected', 'true');
    expect(location.pathname + location.search).toBe('/reports/income');
    expect(screen.getByRole('button', { name: 'This year' })).toBeInTheDocument();
    expect(last('/api/reports/categories').searchParams.get('categories')).toBeNull();
    expect(last('/api/reports/categories').searchParams.get('from')).toBe(yearStart);
  });

  it('ignores a damaged remembered report, and one that is not a report page', async () => {
    localStorage.setItem('moneyrill.reports.url', '/elsewhere');
    await openReports();
    await screen.findByText('Total net income');
    expect(location.pathname).toBe('/reports/cash-flow');
    cleanup();
    history.replaceState(null, '', '/accounts');
    // a merchant or category page is not remembered either
    localStorage.setItem('moneyrill.reports.url', '/reports/merchant/Acme?type=expense');
    await openReports();
    await screen.findByText('Total net income');
    expect(location.pathname).toBe('/reports/cash-flow');
  });

  it('reopens a report saved under the old app name', async () => {
    localStorage.setItem('stillwater.reports.url', '/reports/income?categories=3');
    await openReports();
    await screen.findByText('Total transactions');
    expect(location.pathname + location.search).toBe('/reports/income');
  });

  it('opens straight from an address, with the range, filters and sub-tab in it', async () => {
    history.replaceState(
      null,
      '',
      '/reports/spending?range=last-month&categories=1,2&accounts=checking',
    );
    render(<App />);
    await screen.findByText('Total transactions');
    expect(tab('Spending')).toHaveAttribute('aria-selected', 'true');
    const month = resolveSpec({ mode: 'preset', id: 'lastMonth' }, todayIso());
    const q = last('/api/reports/categories').searchParams;
    expect([q.get('from'), q.get('to'), q.get('categories'), q.get('accounts')]).toEqual([
      month.from,
      month.to,
      '1,2',
      'checking',
    ]);
    expect(screen.getByRole('button', { name: 'Last month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters · 3' })).toBeInTheDocument();
  });

  it('a category page has its own address, including the chosen period', async () => {
    history.replaceState(
      null,
      '',
      '/reports/category/2?type=expense&via=spending&period=2026-08-01',
    );
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText(/Rent/),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Period'), '2026-09-01');
    // a new period replaces the entry, so Back still leaves the category page in one step
    expect(location.search).toContain('period=2026-09-01');
    await user.click(screen.getByRole('button', { name: 'Quarterly' }));
    expect(location.search).toContain('interval=quarter');
    expect(location.search).not.toContain('period=');
  });

  it('Back and Forward move between reports and in and out of a category', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.click(tab('Spending'));
    await screen.findByText('Total transactions');
    await user.click(within(screen.getByRole('list')).getByRole('button', { name: /Rent/ }));
    await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(location.pathname).toBe('/reports/category/2');
    await act(async () => {
      history.back();
      await new Promise((r) => setTimeout(r, 30));
    });
    await waitFor(() => expect(location.pathname).toBe('/reports/spending'));
    expect(tab('Spending')).toHaveAttribute('aria-selected', 'true');
    await act(async () => {
      history.back();
      await new Promise((r) => setTimeout(r, 30));
    });
    await waitFor(() => expect(location.pathname).toBe('/reports/cash-flow'));
    expect(tab('Cash flow')).toHaveAttribute('aria-selected', 'true');
    await act(async () => {
      history.forward();
      await new Promise((r) => setTimeout(r, 30));
    });
    await waitFor(() => expect(tab('Spending')).toHaveAttribute('aria-selected', 'true'));
  });

  it('an unknown category id says so instead of failing', async () => {
    history.replaceState(null, '', '/reports/category/999?type=expense');
    render(<App />);
    expect(await screen.findByText('This category no longer exists.')).toBeInTheDocument();
  });

  it('the drawer links to the merchant: "View N transactions" opens its history', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.click(tab('Spending'));
    await user.click(await screen.findByText('Whole Market'));
    const drawer = await screen.findByRole('dialog', { name: 'Whole Market' });
    const link = await within(drawer).findByRole('link', { name: 'View 4 transactions' });
    expect(link).toHaveAttribute(
      'href',
      '/reports/merchant/Whole%20Market?range=all-time&type=expense&via=spending',
    );
    expect(last('/api/transactions').searchParams.get('merchant')).toBe('Whole Market');
    await user.click(link);
    expect(location.pathname).toBe('/reports/merchant/Whole%20Market');
    expect(await screen.findByRole('img', { name: 'Whole Market per period' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Whole Market' })).toBeNull();
    const flow = last('/api/reports/cash-flow').searchParams;
    expect([flow.get('merchant'), flow.get('categories'), flow.get('from')]).toEqual([
      'Whole Market',
      null,
      null,
    ]);
    await waitFor(() => {
      const t = last('/api/transactions').searchParams;
      expect([t.get('merchant'), t.get('type')]).toEqual(['Whole Market', 'expense']);
    });
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Whole Market'),
    ).toBeInTheDocument();
  });

  it('a merchant page can switch between spending and income, and goes back to where it came from', async () => {
    history.replaceState(null, '', '/reports/merchant/Acme%20Corp?type=income&via=income');
    render(<App />);
    expect(await screen.findByRole('img', { name: 'Acme Corp per period' })).toBeInTheDocument();
    const user = userEvent.setup();
    const kind = screen.getByRole('group', { name: 'Kind' });
    expect(within(kind).getByRole('button', { name: 'Income' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(kind).getByRole('button', { name: 'Spending' }));
    expect(location.search).toContain('type=expense');
    await waitFor(() => expect(last('/api/transactions').searchParams.get('type')).toBe('expense'));
    await user.click(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', {
        name: 'Income',
      }),
    );
    expect(location.pathname).toBe('/reports/income');
  });

  it("the merchant page keeps the owner's date range and account filter", async () => {
    history.replaceState(
      null,
      '',
      '/reports/merchant/Whole%20Market?range=last-year&accounts=checking&type=expense',
    );
    render(<App />);
    await screen.findByRole('img', { name: 'Whole Market per period' });
    const year = resolveSpec({ mode: 'preset', id: 'lastYear' }, todayIso());
    const q = last('/api/reports/cash-flow').searchParams;
    expect([q.get('merchant'), q.get('from'), q.get('to'), q.get('accounts')]).toEqual([
      'Whole Market',
      year.from,
      year.to,
      'checking',
    ]);
  });

  it('a category opened with a period picked in the breakdown opens on that period', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.selectOptions(screen.getByLabelText('Breakdown period'), '2026-09-01');
    const breakdown = screen.getByRole('region', { name: 'Spending breakdown' });
    await user.click(await within(breakdown).findByRole('button', { name: /Rent/ }));
    // not October, the latest period, but the September that was picked
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
    expect(location.pathname).toBe('/reports/category/2');
    expect(location.search).toContain('period=2026-09-01');
    expect(screen.getByLabelText('Period')).toHaveValue('2026-09-01');
    await waitFor(() => {
      const t = last('/api/transactions').searchParams;
      expect([t.get('from'), t.get('to'), t.get('categories')]).toEqual([
        '2026-09-01',
        '2026-09-30',
        '2',
      ]);
    });
  });

  it("the category opens at the chart's interval, and on its latest period if none was picked", async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.selectOptions(screen.getByLabelText('Interval'), 'quarter');
    await waitFor(() =>
      expect(last('/api/reports/cash-flow').searchParams.get('interval')).toBe('quarter'),
    );
    // the breakdown opens on the current quarter; the whole range is a choice
    await user.click(await screen.findByRole('button', { name: 'Show the whole range' }));
    const breakdown = screen.getByRole('region', { name: 'Income breakdown' });
    await user.click(await within(breakdown).findByRole('button', { name: /Paychecks/ }));
    await screen.findByRole('img', { name: 'Paychecks per period' });
    expect(location.search).toContain('interval=quarter');
    expect(location.search).not.toContain('period=');
    expect(screen.getByRole('button', { name: 'Quarterly' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('going back to the cash flow keeps the page you came from, and the period is a fresh choice there', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    await user.selectOptions(screen.getByLabelText('Breakdown period'), '2026-08-01');
    await user.click(
      await within(screen.getByRole('region', { name: 'Spending breakdown' })).findByRole(
        'button',
        {
          name: /Rent/,
        },
      ),
    );
    expect(await screen.findByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', {
        name: 'Cash flow',
      }),
    );
    expect(location.pathname).toBe('/reports/cash-flow');
    expect(await screen.findByText('Total net income')).toBeInTheDocument();
  });
});

describe('Reports design', () => {
  it('Cash flow, Spending and Income are pills; the chosen one is filled', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    expect(tab('Cash flow').className).toContain('bg-primary');
    expect(tab('Spending').className).not.toContain('bg-primary');
    await user.click(tab('Spending'));
    expect(location.pathname).toBe('/reports/spending');
    await waitFor(() => expect(tab('Spending').className).toContain('bg-primary'));
    expect(tab('Cash flow').className).not.toContain('bg-primary');
  });

  it('a breakdown row is a round emoji over a thin bar, and still opens its category month by month', async () => {
    const user = await openReports();
    await screen.findByText('Total net income');
    const breakdown = screen.getByRole('region', { name: 'Spending breakdown' });
    const rows = within(breakdown).getAllByTitle('Show this category month by month');
    expect(rows.length).toBe(2); // the two expense categories
    // the thin bar's width is the share of the largest slice
    const bars = rows.map((r) => r.querySelector('i') as HTMLElement);
    expect(bars[0].style.width).toBe('100%');
    await user.click(rows[1]);
    expect(location.pathname).toMatch(/^\/reports\/category\/\d+$/);
  });

  it('the totals follow Private mode', async () => {
    localStorage.setItem('moneyrill.private', '1');
    await openReports();
    await screen.findByText('Total net income');
    const tiles = document.querySelector('.rpt-tiles') as HTMLElement;
    expect(tiles.textContent).not.toMatch(/\$/);
    expect(within(tiles).getByText('36.9%')).toBeInTheDocument();
  });
});
