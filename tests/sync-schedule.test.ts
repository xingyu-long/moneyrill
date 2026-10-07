import test from 'node:test';
import assert from 'node:assert/strict';
import { cronSchedule, scheduleCron, syncScheduleBody } from '../server/lib/sync-schedule.ts';

const at = { every: 1, weekday: 1, day: 1, time: '13:00' };

test('every kind of schedule becomes a five-field cron expression', () => {
  assert.equal(scheduleCron({ ...at, frequency: 'days' }), '0 13 * * *');
  assert.equal(scheduleCron({ ...at, frequency: 'days', time: '06:30', every: 3 }), '30 6 */3 * *');
  assert.equal(scheduleCron({ ...at, frequency: 'weekly', weekday: 5 }), '0 13 * * 5');
  assert.equal(scheduleCron({ ...at, frequency: 'monthly', day: 15, time: '07:05' }), '5 7 15 * *');
  assert.equal(scheduleCron({ ...at, frequency: 'hours', time: '00:15' }), '15 * * * *');
  assert.equal(scheduleCron({ ...at, frequency: 'hours', every: 6, time: '00:00' }), '0 */6 * * *');
});

test('a cron expression reads back to the schedule that made it, and odd ones to null', () => {
  for (const s of [
    { ...at, frequency: 'days' as const },
    { ...at, frequency: 'days' as const, every: 7, time: '06:30' },
    { ...at, frequency: 'weekly' as const, weekday: 0 },
    { ...at, frequency: 'monthly' as const, day: 28 },
    { ...at, frequency: 'hours' as const, every: 4, time: '00:45' },
  ])
    assert.deepEqual(cronSchedule(scheduleCron(s)), s);
  for (const odd of [
    '0 9-17 * * *',
    '0 13 * * 1-5',
    '0 13 29 * *',
    '0 */5 * * *',
    '0 13 1 6 *',
    'daily',
  ])
    assert.equal(cronSchedule(odd), null, odd);
});

test('the saved schedule needs a real choice, time and time zone; the rest has defaults', () => {
  const ok = { enabled: true, time: '06:30', timezone: 'Europe/Berlin' };
  assert.deepEqual(syncScheduleBody.parse(ok), {
    ...ok,
    frequency: 'days',
    every: 1,
    weekday: 1,
    day: 1,
  });
  assert.ok(
    syncScheduleBody.safeParse({ ...ok, enabled: false, frequency: 'weekly', weekday: 6 }).success,
  );
  assert.ok(syncScheduleBody.safeParse({ ...ok, frequency: 'hours', every: 6 }).success);
  for (const bad of [
    { ...ok, time: '24:00' },
    { ...ok, time: '6:30' },
    { ...ok, timezone: 'Mars/Base' },
    { ...ok, enabled: 'yes' },
    { ...ok, frequency: 'yearly' },
    { ...ok, frequency: 'hours', every: 5 }, // does not divide the day
    { ...ok, every: 16 },
    { ...ok, frequency: 'monthly', day: 31 },
    { ...ok, frequency: 'weekly', weekday: 7 },
    { time: '06:30', timezone: 'Europe/Berlin' },
  ])
    assert.equal(syncScheduleBody.safeParse(bad).success, false, JSON.stringify(bad));
});
