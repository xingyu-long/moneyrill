import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { stubApi } from './fixture.ts';

const calls: { url: string; method: string; body: any }[] = [];
beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(stubApi(calls)));
});

describe('Sync settings & activity', () => {
  it('says the schedule in a sentence, and the sentence follows what is saved', async () => {
    history.replaceState(null, '', '/settings/sync');
    render(<App />);
    await screen.findByLabelText('Time of day');
    const sentence = () =>
      screen.getByText(/Moneyrill checks your banks/).closest('p') as HTMLElement;
    expect(sentence()).toHaveTextContent('Moneyrill checks your banks every day at 1:00 PM.');
    const user = userEvent.setup();
    const time = screen.getByLabelText('Time of day');
    await user.clear(time);
    await user.type(time, '06:30');
    // typing alone does not change the sentence: it describes the saved schedule
    expect(sentence()).toHaveTextContent('1:00 PM');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    await vi.waitFor(() => expect(sentence()).toHaveTextContent('every day at 6:30 AM.'));
  });

  it('shows the current schedule and saves a new time and an off switch', async () => {
    history.replaceState(null, '', '/settings/sync');
    render(<App />);
    const time = await screen.findByLabelText('Time of day');
    expect(time).toHaveValue('13:00');
    const save = screen.getByRole('button', { name: 'Save schedule' });
    expect(save).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Use the default' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.clear(time);
    await user.type(time, '06:30');
    await user.click(save);
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      enabled: true,
      frequency: 'days',
      every: 1,
      weekday: 1,
      day: 1,
      time: '06:30',
      timezone: 'America/Los_Angeles',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('button', { name: 'Use the default' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Scheduled sync' }));
    expect(screen.getByLabelText('Time of day')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body.enabled).toBe(false);
  });

  it('offers hours, days, weeks and months, each with its own choices', async () => {
    history.replaceState(null, '', '/settings/sync');
    render(<App />);
    const user = userEvent.setup();
    const how = await screen.findByLabelText('How often');
    await user.selectOptions(how, 'weekly');
    await user.selectOptions(screen.getByLabelText('Day of the week'), 'Friday');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toMatchObject({
      frequency: 'weekly',
      weekday: 5,
    });
    await user.selectOptions(screen.getByLabelText('How often'), 'monthly');
    await user.selectOptions(screen.getByLabelText('Day of the month'), '15');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toMatchObject({
      frequency: 'monthly',
      day: 15,
    });
    await user.selectOptions(screen.getByLabelText('How often'), 'hours');
    expect(screen.queryByLabelText('Time of day')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Hours between syncs'), '6');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toMatchObject({
      frequency: 'hours',
      every: 6,
    });
    await user.selectOptions(screen.getByLabelText('How often'), 'days');
    await user.selectOptions(screen.getByLabelText('Days between syncs'), '3');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toMatchObject({
      frequency: 'days',
      every: 3,
    });
  });

  it("shows the time zone as text and can switch to this device's", async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Europe/Berlin',
    } as any);
    history.replaceState(null, '', '/settings/sync');
    render(<App />);
    const user = userEvent.setup();
    expect(await screen.findByText(/Times are in America\/Los_Angeles/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Time zone')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Use this device's \(Europe\/Berlin\)/ }));
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(calls.find((c) => c.method === 'PUT')?.body.timezone).toBe('Europe/Berlin');
  });

  it('goes back to the default', async () => {
    history.replaceState(null, '', '/settings/sync');
    render(<App />);
    const user = userEvent.setup();
    await user.clear(await screen.findByLabelText('Time of day'));
    await user.type(screen.getByLabelText('Time of day'), '07:00');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    await user.click(await screen.findByRole('button', { name: 'Use the default' }));
    expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ reset: true });
  });
});
