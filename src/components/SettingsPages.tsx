import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Download, Landmark, Plus, RefreshCw } from 'lucide-react';
import { useApp } from '../state/AppContext.tsx';
import { CategoriesCard } from './CategoriesCard.tsx';
import { MonarchImportCard } from './MonarchImportCard.tsx';
import { Badge } from './ui/badge.tsx';
import { Button, buttonVariants } from './ui/button.tsx';
import { Input } from './ui/input.tsx';
import { Select } from './ui/select.tsx';
import { Switch } from './ui/switch.tsx';
import { ButtonRow, Fineprint, SettingsCard } from './settings/SettingsCard.tsx';
import { cn } from '../lib/cn.ts';
import { COLORS } from '../lib/format.ts';
import { scheduleSentence } from '../lib/summary.ts';
import { Words } from './Words.tsx';
export { DisplayPage } from './DisplayPage.tsx';

const SMALL = { size: 'sm' as const, variant: 'outline' as const };
const small = 'h-7 px-2.5 text-[11px]';

/** One of the palette colours per institution, the same every time (as on the Accounts page). */
const connectionColor = (name: string) => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
};

export function ConnectionsPage() {
  const { action, busy, data, production, setDisconnecting, setLink } = useApp();
  return (
    <SettingsCard
      icon={<Landmark />}
      title={production ? 'Connections' : 'Sandbox connections'}
      description={
        production
          ? 'Connect your bank or brokerage. Your balances and holdings stay available locally between syncs.'
          : 'Test bank and brokerage connections with fake data, separately from production.'
      }
    >
      <div className="grid gap-3.5 min-[1101px]:grid-cols-2">
        {data.connections.length ? (
          data.connections.map((c) => {
            const failing = !c.disconnected_at && !!c.last_error;
            const color = connectionColor(c.institution);
            return (
              <div
                key={c.id}
                className={cn(
                  'grid gap-3 rounded-[22px] bg-muted p-5 text-xs',
                  failing && 'bg-card ring-[1.5px] ring-clay',
                )}
              >
                <div className="flex items-center gap-3.5">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-full font-serif text-xl"
                    style={{
                      background: `color-mix(in srgb, ${color} 18%, transparent)`,
                      color,
                    }}
                  >
                    {(c.institution || '•').trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-[13px] font-normal">{c.institution}</strong>
                    <small className="mt-1 block whitespace-normal text-[11px] text-muted-foreground">
                      {c.products.includes('investments') ? 'Investments' : 'Bank'} ·{' '}
                      {c.disconnected_at ? 'Disconnected' : c.last_error || 'Connected'}
                    </small>
                  </span>
                  {failing && (
                    <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-[11px] text-warning">
                      Needs attention
                    </span>
                  )}
                </div>
                <div className="grid gap-1 text-[11px] text-muted-foreground">
                  <small className="block whitespace-normal">
                    {c.last_synced
                      ? 'Last sync: ' + new Date(c.last_synced).toLocaleString()
                      : 'Not synced yet'}
                  </small>
                  {c.created_at && (
                    <small className="block whitespace-normal">
                      Added: {new Date(c.created_at).toLocaleDateString()}
                    </small>
                  )}
                  {c.consent_expires_at && (
                    <small className="block whitespace-normal">
                      Consent expires: {new Date(c.consent_expires_at).toLocaleDateString()}
                    </small>
                  )}
                </div>
                {!c.disconnected_at && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      {...SMALL}
                      className={cn(
                        small,
                        failing && 'bg-clay text-white hover:bg-clay hover:opacity-90',
                      )}
                      disabled={busy}
                      onClick={() =>
                        action(async () => {
                          setLink(await api('/link', { connectionId: c.id }));
                        }, 'Reconnect ready')
                      }
                    >
                      Reconnect
                    </Button>
                    <Button
                      {...SMALL}
                      className={small}
                      disabled={busy}
                      onClick={() => setDisconnecting(c)}
                    >
                      Disconnect
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <p className="m-0 text-xs text-muted-foreground">
            No connections yet. Add a bank or brokerage below.
          </p>
        )}
      </div>
      <ButtonRow>
        {!production && (
          <Button
            disabled={busy || !data.hasPlaidKeys}
            onClick={() => action(() => api('/sandbox-samples', {}), 'Sandbox samples loaded')}
          >
            <Plus size={16} />
            Load sandbox samples
          </Button>
        )}
        <Button
          disabled={busy || !data.hasPlaidKeys}
          onClick={() =>
            action(async () => {
              setLink(await api('/link', {}));
            }, 'Account connection ready')
          }
        >
          <Plus size={16} />
          Add an account
        </Button>
        <Button
          variant="outline"
          disabled={busy || !data.connections.some((c) => !c.disconnected_at)}
          onClick={() => action(() => api('/sync', {}), 'Accounts synced')}
        >
          <RefreshCw size={15} />
          Sync connected accounts
        </Button>
      </ButtonRow>
      {!data.hasPlaidKeys && (
        <Fineprint>
          Plaid credentials are not configured for this environment. Manual accounts remain
          available.
        </Fineprint>
      )}
    </SettingsCard>
  );
}

export function DataPage() {
  const { setError, setImportFile, setManual } = useApp();
  const outline = buttonVariants({ variant: 'outline' });
  return (
    <>
      <SettingsCard
        icon={<Download />}
        title="Your data travels with you"
        description="Download a portable archive of accounts, balances and holdings. Provider credentials are never included."
      >
        <ButtonRow>
          <a className={outline} href="/api/export">
            <Download size={16} />
            Download JSON archive
          </a>
          <a className={outline} href="/api/export.csv">
            Download accounts CSV
          </a>
          <label className={cn(outline, 'cursor-pointer')}>
            Import JSON archive
            <input
              className="hidden"
              type="file"
              accept=".json"
              onChange={async (e) => {
                try {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 12 * 1024 * 1024) throw new Error('File is too large');
                    const json = JSON.parse(await file.text());
                    if (json.version !== 1 || !Array.isArray(json.tables?.accounts))
                      throw new Error('Invalid Moneyrill archive');
                    setImportFile(json);
                  }
                } catch (err: any) {
                  setError(err.message);
                }
                e.target.value = '';
              }}
            />
          </label>
          <Button variant="outline" onClick={() => setManual(true)}>
            <Plus size={16} />
            Add manual account
          </Button>
        </ButtonRow>
        <Fineprint>
          Imports are merged into your accounts. Re-imports of the same archive are deduplicated.
          Back up the PostgreSQL volume and token key separately for full recovery.
        </Fineprint>
      </SettingsCard>
      <MonarchImportCard />
    </>
  );
}

export function CategoriesPage() {
  return <CategoriesCard />;
}

type Frequency = 'hours' | 'days' | 'weekly' | 'monthly';
type Form = {
  enabled: boolean;
  frequency: Frequency;
  every: number;
  weekday: number;
  day: number;
  time: string;
  timezone: string;
};
type Schedule = Omit<Form, 'frequency'> & {
  frequency: Frequency | null;
  source: 'settings' | 'default';
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12];
const FREQUENCY_LABELS: Record<Frequency, string> = {
  hours: 'Every few hours',
  days: 'Every day or every few days',
  weekly: 'Every week',
  monthly: 'Every month',
};

const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const toForm = (s: Schedule): Form => ({
  enabled: s.enabled,
  frequency: s.frequency ?? 'days',
  every: s.every,
  weekday: s.weekday,
  day: s.day,
  time: s.time,
  timezone: s.timezone,
});

function ScheduleCard() {
  const [saved, setSaved] = useState<Schedule | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [message, setMessage] = useState('');
  const show = (s: Schedule) => {
    setSaved(s);
    setForm(toForm(s));
  };
  useEffect(() => {
    api('/sync/schedule')
      .then(show)
      .catch((e) => setMessage(e.message));
  }, []);
  async function save(body: object) {
    try {
      show(await api('/sync/schedule', body, 'PUT'));
      setMessage('Saved. The worker applies it within a minute.');
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  const change = (patch: Partial<Form>) => setForm((f) => f && { ...f, ...patch });
  const num = (e: React.ChangeEvent<HTMLSelectElement>) => Number(e.target.value);
  const changed =
    !!saved &&
    !!form &&
    (saved.frequency === null || JSON.stringify(form) !== JSON.stringify(toForm(saved)));
  const off = !form?.enabled;
  return (
    <SettingsCard
      title="Sync schedule"
      description="The worker syncs saved connections on this schedule while Docker is running. Sync accounts runs one on demand. Failed syncs retain previous balances."
    >
      {saved && (
        <p className="m-0 mb-5 font-serif text-[26px] leading-[1.2] text-muted-foreground">
          <Words
            sentence={scheduleSentence({
              enabled: saved.enabled,
              frequency: saved.frequency,
              every: saved.every,
              weekday: saved.weekday,
              day: saved.day,
              time: saved.time,
            })}
          />
        </p>
      )}
      {saved && form && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 text-xs">
            <label className="flex items-center gap-2">
              <Switch
                checked={form.enabled}
                onCheckedChange={(enabled) => change({ enabled })}
                aria-label="Scheduled sync"
              />
              Sync automatically
            </label>
            <Select
              value={form.frequency}
              disabled={off}
              onChange={(e) => change({ frequency: e.target.value as Frequency, every: 1 })}
              aria-label="How often"
            >
              {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </option>
              ))}
            </Select>
            {form.frequency === 'hours' && (
              <label className="flex items-center gap-2">
                Every
                <Select
                  value={form.every}
                  disabled={off}
                  onChange={(e) => change({ every: num(e) })}
                  aria-label="Hours between syncs"
                >
                  {HOUR_STEPS.map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? 'hour' : 'hours'}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {form.frequency === 'days' && (
              <label className="flex items-center gap-2">
                Every
                <Select
                  value={form.every}
                  disabled={off}
                  onChange={(e) => change({ every: num(e) })}
                  aria-label="Days between syncs"
                >
                  {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? 'day' : `${n} days`}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {form.frequency === 'weekly' && (
              <label className="flex items-center gap-2">
                On
                <Select
                  value={form.weekday}
                  disabled={off}
                  onChange={(e) => change({ weekday: num(e) })}
                  aria-label="Day of the week"
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {form.frequency === 'monthly' && (
              <label className="flex items-center gap-2">
                On day
                <Select
                  value={form.day}
                  disabled={off}
                  onChange={(e) => change({ day: num(e) })}
                  aria-label="Day of the month"
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {form.frequency === 'hours' ? (
              <label className="flex items-center gap-2">
                At minute
                <Select
                  value={form.time.slice(3)}
                  disabled={off}
                  onChange={(e) => change({ time: `00:${e.target.value}` })}
                  aria-label="Minute past the hour"
                >
                  {['00', '15', '30', '45'].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
              </label>
            ) : (
              <label className="flex items-center gap-2">
                At
                <Input
                  type="time"
                  value={form.time}
                  disabled={off}
                  onChange={(e) => change({ time: e.target.value })}
                  aria-label="Time of day"
                  className="w-[110px]"
                />
              </label>
            )}
          </div>
          <ButtonRow>
            <Button size="sm" disabled={!changed || !form.time} onClick={() => save(form)}>
              Save schedule
            </Button>
            {saved.source === 'settings' && (
              <Button {...SMALL} onClick={() => save({ reset: true })}>
                Use the default
              </Button>
            )}
          </ButtonRow>
          <Fineprint className="mb-1">
            Times are in {form.timezone}.
            {form.timezone !== deviceZone() && (
              <>
                {' '}
                <button
                  type="button"
                  className="underline"
                  disabled={off}
                  onClick={() => change({ timezone: deviceZone() })}
                >
                  Use this device&apos;s ({deviceZone()})
                </button>
              </>
            )}
          </Fineprint>
          <Fineprint>
            {saved.frequency === null && saved.source === 'default'
              ? 'The deployment uses a custom SYNC_CRON; saving here replaces it. '
              : ''}
            {form.frequency === 'days' && form.every > 1
              ? 'Every few days counts from the 1st of each month, so the gap can be shorter when a month ends. '
              : ''}
            The default (1 PM Pacific every day, unless SYNC_CRON and SYNC_TIMEZONE say otherwise)
            applies until you save a schedule.
            {message && <span role="status"> {message}</span>}
          </Fineprint>
        </>
      )}
      {!saved && message && <Fineprint>{message}</Fineprint>}
    </SettingsCard>
  );
}

export function SyncPage() {
  const { data } = useApp();
  return (
    <>
      <ScheduleCard />
      <SettingsCard title="Sync activity" description="The latest syncs, scheduled and on demand.">
        {data.runs.length ? (
          <div>
            {data.runs.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-x-[15px] gap-y-1 border-t border-border py-[15px] text-xs first:border-t-0"
              >
                <Badge variant={r.status === 'partial' ? 'warning' : 'success'}>{r.status}</Badge>
                <span>{r.message || 'Sync in progress'}</span>
                <small className="ml-auto text-[10px] text-muted-foreground max-[760px]:ml-0">
                  {new Date(r.started_at).toLocaleString()}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 text-xs text-muted-foreground">
            No syncs yet. Demo data is already stored locally.
          </p>
        )}
      </SettingsCard>
    </>
  );
}
