import { useCallback, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { addDays, parseIso, todayIso } from '../../lib/calendar.ts';
import {
  ALL_TIME,
  MAX_N,
  PRESETS,
  UNITS,
  rangeLabel,
  resolveSpec,
  specLabel,
  type DateSpec,
  type Unit,
} from '../../lib/reportDates.ts';
import { DatePicker } from '../DatePicker.tsx';
import { useDismiss } from './useDismiss.ts';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import { cn } from '../../lib/cn.ts';
import {
  FIELD,
  HINT,
  PANEL,
  PANEL_BODY,
  PANEL_FOOT,
  PANEL_NAV,
  PANEL_PANE,
  PANEL_TITLE,
  navButton,
} from './styles.ts';

type Draft = {
  mode: 'all' | 'preset' | 'last' | 'range';
  preset: string;
  n: string;
  unit: Unit;
  from: string;
  to: string;
};

function draftOf(spec: DateSpec): Draft {
  const today = todayIso();
  return {
    mode: spec.mode,
    preset: spec.mode === 'preset' ? spec.id : 'thisYear',
    n: spec.mode === 'last' ? String(spec.n) : '',
    unit: spec.mode === 'last' ? spec.unit : 'month',
    from: spec.mode === 'range' ? spec.from : addDays(today, -29),
    to: spec.mode === 'range' ? spec.to : today,
  };
}

/** What the draft would apply, or null while it is incomplete or impossible. */
function specOf(d: Draft): DateSpec | null {
  if (d.mode === 'all') return ALL_TIME;
  if (d.mode === 'preset') return { mode: 'preset', id: d.preset as any };
  if (d.mode === 'last') {
    const n = Number(d.n);
    return Number.isInteger(n) && n >= 1 && n <= MAX_N[d.unit]
      ? { mode: 'last', n, unit: d.unit }
      : null;
  }
  return parseIso(d.from) && parseIso(d.to) && d.from <= d.to
    ? { mode: 'range', from: d.from, to: d.to }
    : null;
}

export function DateRangePopover({
  spec,
  onChange,
}: {
  spec: DateSpec;
  onChange: (s: DateSpec) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(spec));
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(box, open, close);
  const ready = specOf(draft);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const resolved = ready ? resolveSpec(ready, todayIso()) : null;
  return (
    <div className="relative" ref={box}>
      <Button
        variant="outline"
        className={cn(spec.mode !== 'all' && 'border-positive text-positive')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) setDraft(draftOf(spec));
          setOpen(!open);
        }}
      >
        <Calendar size={14} />
        {spec.mode === 'all' ? 'Date' : specLabel(spec)}
      </Button>
      {open && (
        <div className={cn(PANEL, 'w-[560px]')} role="dialog" aria-label="Date range">
          <div className={PANEL_TITLE}>Date Range</div>
          <div className={PANEL_BODY}>
            <nav className={PANEL_NAV} aria-label="Date range type">
              <button
                className={navButton(draft.mode === 'last')}
                onClick={() => set({ mode: 'last' })}
              >
                Last
              </button>
              <button
                className={navButton(draft.mode === 'range')}
                onClick={() => set({ mode: 'range' })}
              >
                Range
              </button>
              <hr className="my-1.5 w-full border-0 border-t border-border max-[760px]:hidden" />
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={navButton(draft.mode === 'preset' && draft.preset === p.id)}
                  onClick={() => set({ mode: 'preset', preset: p.id })}
                >
                  {p.label}
                </button>
              ))}
              <button
                className={navButton(draft.mode === 'all')}
                onClick={() => set({ mode: 'all' })}
              >
                All time
              </button>
            </nav>
            <div className={PANEL_PANE}>
              {draft.mode === 'last' && (
                <>
                  <label className={FIELD}>
                    Number
                    <Input
                      className="h-9"
                      inputMode="numeric"
                      placeholder="Enter number"
                      value={draft.n}
                      onChange={(e) => set({ n: e.target.value.replace(/\D/g, '') })}
                    />
                  </label>
                  <fieldset className="m-0 grid gap-2 border-0 p-0 text-xs">
                    <legend className="mb-2 p-0 font-semibold">Unit</legend>
                    {UNITS.map((u) => (
                      <label key={u} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="unit"
                          checked={draft.unit === u}
                          onChange={() => set({ unit: u })}
                        />
                        {u[0].toUpperCase() + u.slice(1)}
                      </label>
                    ))}
                  </fieldset>
                </>
              )}
              {draft.mode === 'range' && (
                <>
                  <label className={FIELD}>
                    From
                    <DatePicker value={draft.from} onChange={(from) => set({ from })} />
                  </label>
                  <label className={FIELD}>
                    To
                    <DatePicker value={draft.to} onChange={(to) => set({ to })} />
                  </label>
                  {!ready && <p className={HINT}>The start must not be after the end.</p>}
                </>
              )}
              {(draft.mode === 'preset' || draft.mode === 'all') && (
                <p className={HINT}>
                  {draft.mode === 'all' || !resolved
                    ? 'Every transaction.'
                    : rangeLabel(resolved.from ?? null, resolved.to ?? null)}
                </p>
              )}
              {draft.mode === 'last' && resolved && (
                <p className={HINT}>{rangeLabel(resolved.from ?? null, resolved.to ?? null)}</p>
              )}
            </div>
          </div>
          <div className={PANEL_FOOT}>
            <Button
              variant="outline"
              onClick={() => {
                onChange(ALL_TIME);
                setOpen(false);
              }}
            >
              Clear
            </Button>
            <span className="flex-1" />
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              disabled={!ready}
              onClick={() => {
                if (ready) onChange(ready);
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
