import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { setPrivateMode } from '../../src/lib/format.ts';
import { monarchSummary, stubApi } from './fixture.ts';

let calls: { url: string; method: string; body: any }[] = [];
const CSV =
  'Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags,Owner,Reviewed,Id\n2026-01-01,A,B,C (...1111),S,,-1,,,,1\n';
const file = () => new File([CSV], 'monarch.csv', { type: 'text/csv' });
const imports = () => calls.filter((c) => c.url === '/api/transactions/import-monarch');

async function openCard(monarch?: Parameters<typeof stubApi>[2]) {
  localStorage.clear();
  setPrivateMode(false);
  calls = [];
  vi.stubGlobal('fetch', vi.fn(stubApi(calls, [], monarch)));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText('TOTAL NET WORTH');
  await user.click(
    within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
      name: /Settings/,
    }),
  );
  await user.click(
    within(screen.getByRole('navigation', { name: 'Settings pages' })).getByRole('link', {
      name: 'Data',
    }),
  );
  const card = (await screen.findByRole('heading', { name: 'Import from Monarch' })).closest(
    'section',
  )!;
  const input = card.querySelector('input[type=file]') as HTMLInputElement;
  return { user, card, input };
}

describe('Import from Monarch', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows a dry-run summary first and saves nothing until you confirm', async () => {
    const { user, card, input } = await openCard();
    expect(within(card).getByText(/bank and card/)).toBeInTheDocument();
    await user.upload(input, file());
    const summary = await within(card).findByLabelText('Import summary');
    expect(imports()).toHaveLength(1);
    expect(imports()[0].body).toEqual({ csv: CSV, commit: false });
    expect(within(summary).getByText('90')).toBeInTheDocument(); // added
    expect(within(summary).getByText('20')).toBeInTheDocument(); // filled in from Monarch
    expect(
      within(summary).getByText(/3 match Plaid transactions that already have your own category/),
    ).toBeInTheDocument();
    expect(within(summary).getByText(/2 were imported before/)).toBeInTheDocument();
    expect(
      within(summary).getByText(/5 fall inside Plaid's history without a match/),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText(/30 are for accounts that are not bank or card accounts/),
    ).toBeInTheDocument();
    expect(within(summary).getByText(/1 are dated in the future/)).toBeInTheDocument();
    expect(within(summary).getByText(/2 could not be read \(lines 7, 9\)/)).toBeInTheDocument();
    expect(within(summary).getByText(/Imported from Monarch.*RSU \(4\)/)).toBeInTheDocument();
    // accounts: the matched one and the skipped one with its reason
    const venture = within(summary).getByRole('row', { name: /Rewards Card \(\.\.\.1111\)/ });
    expect(within(venture).getByText('Rewards Card (…1111) · Example Bank')).toBeInTheDocument();
    expect(within(summary).getByRole('row', { name: /Apple Card/ })).toHaveClass('skipped');
    expect(imports().filter((c) => c.body.commit)).toEqual([]);
  });

  it('imports after confirming, with the same file, and then says what it did', async () => {
    const { user, card, input } = await openCard();
    await user.upload(input, file());
    await within(card).findByLabelText('Import summary');
    await user.click(within(card).getByRole('button', { name: 'Import 110 changes' }));
    await waitFor(() => expect(imports()[1]?.body).toEqual({ csv: CSV, commit: true }));
    expect(
      await within(card).findByText(
        'Added 90 transactions, filled in 20 from Monarch, created 1 categories.',
      ),
    ).toBeInTheDocument();
    expect(within(card).queryByLabelText('Import summary')).toBeNull();
  });

  it('cancel throws the file away without saving', async () => {
    const { user, card, input } = await openCard();
    await user.upload(input, file());
    await within(card).findByLabelText('Import summary');
    await user.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(within(card).queryByLabelText('Import summary')).toBeNull();
    expect(imports().filter((c) => c.body.commit)).toEqual([]);
  });

  it('has nothing to import: the button is disabled and says so', async () => {
    const { user, card, input } = await openCard(() => ({
      status: 200,
      json: monarchSummary({
        totals: {
          rows: 5,
          notBankOrCard: 5,
          toImport: 0,
          toMerge: 0,
          keptYours: 0,
          leftOut: 0,
          alreadyImported: 0,
        },
      }),
    }));
    await user.upload(input, file());
    await within(card).findByLabelText('Import summary');
    expect(within(card).getByRole('button', { name: 'Import 0 changes' })).toBeDisabled();
    expect(within(card).getByText('Nothing to import from this file.')).toBeInTheDocument();
  });

  it("shows the server's reason when the file is not accepted", async () => {
    const { user, card, input } = await openCard(() => ({
      status: 400,
      json: { error: 'This does not look like a Monarch export: no "Merchant" column' },
    }));
    await user.upload(input, file());
    expect(await screen.findByText(/does not look like a Monarch export/)).toBeInTheDocument();
    expect(within(card).queryByLabelText('Import summary')).toBeNull();
  });

  it('shows only counts, so Private mode needs no special handling', async () => {
    const { user, card, input } = await openCard();
    await user.click(screen.getByRole('button', { name: /Private mode/ }));
    await user.upload(input, file());
    const summary = await within(card).findByLabelText('Import summary');
    expect(summary.textContent).not.toMatch(/\$\d/);
  });
});
