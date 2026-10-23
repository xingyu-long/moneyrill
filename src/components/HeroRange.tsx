import { useCallback, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { addDays, todayIso } from '../lib/calendar.ts';
import { cn } from '../lib/cn.ts';
import { CUSTOM } from '../lib/periods.ts';
import { rangeLabel, resolveSpec, type PresetId } from '../lib/reportDates.ts';
import { useApp } from '../state/AppContext.tsx';
import { DatePicker } from './DatePicker.tsx';
import { Range } from './common.tsx';
import { FIELD, HINT } from './reports/styles.ts';
import { useDismiss } from './reports/useDismiss.ts';
import { Button } from './ui/button.tsx';
import { PopoverPanel } from './ui/popover.tsx';

/** The periods the hero offers (the other pages keep the longer list). */
export const HERO_RANGES = ['1D', '1W', '1M', '3M', 'YTD', '1Y', 'ALL'] as const;

/** Shortcuts that fill in From and To; the change is still applied with Apply. */
const SHORTCUTS: { id: PresetId; label: string }[] = [
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'lastYear', label: 'Last year' },
];

/**
 * Home's range: the preset periods, then Custom, which opens a From and To picker. `onOpen` tells the hero the picker
 * is open, so it can lift itself above the cards that overlap its chart.
 */
export function HeroRange({ onOpen }: { onOpen: (open: boolean) => void }) {
  const { activePeriod, customRange, setCustomRange, setHomePeriod } = useApp();
  const today = todayIso();
  const [open, setOpenState] = useState(false);
  const [draft, setDraft] = useState({ from: addDays(today, -29), to: today });
  const box = useRef<HTMLDivElement>(null);
  const setOpen = useCallback(
    (v: boolean) => {
      setOpenState(v);
      onOpen(v);
    },
    [onOpen],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);
  useDismiss(box, open, close);
  const chosen = activePeriod === CUSTOM && customRange;
  const ready = draft.from < draft.to;
  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      <Range options={HERO_RANGES} soft />
      <div className="relative" ref={box}>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-pressed={!!chosen}
          onClick={() => {
            if (!open) setDraft(customRange ?? { from: addDays(today, -29), to: today });
            setOpen(!open);
          }}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors',
            chosen
              ? 'bg-card text-foreground shadow-card'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Calendar size={14} />
          {chosen ? rangeLabel(customRange.from, customRange.to) : 'Custom'}
        </button>
        {open && (
          <PopoverPanel
            role="dialog"
            aria-label="Custom range"
            className="left-1/2 right-auto w-[300px] -translate-x-1/2 text-left max-[760px]:w-[calc(100vw-32px)]"
          >
            <div className="grid grid-cols-2 gap-2.5">
              <label className={FIELD}>
                From
                <DatePicker
                  value={draft.from}
                  max={today}
                  onChange={(from) => setDraft({ ...draft, from })}
                />
              </label>
              <label className={FIELD}>
                To
                <DatePicker
                  value={draft.to}
                  max={today}
                  onChange={(to) => setDraft({ ...draft, to })}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SHORTCUTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="rounded-full px-2.5 py-1 ring-1 ring-border transition-colors hover:bg-accent"
                  onClick={() => {
                    const r = resolveSpec({ mode: 'preset', id: s.id }, today);
                    if (r.from && r.to) setDraft({ from: r.from, to: r.to });
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {!ready && <p className={HINT}>The start has to be before the end.</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!ready}
                onClick={() => {
                  setCustomRange(draft);
                  setHomePeriod(CUSTOM);
                  close();
                }}
              >
                Apply
              </Button>
            </div>
          </PopoverPanel>
        )}
      </div>
    </div>
  );
}
