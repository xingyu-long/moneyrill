import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import {
  dayLabel,
  monthGrid,
  monthTitle,
  parseIso,
  shiftMonth,
  todayIso,
} from '../lib/calendar.ts';
import { cn } from '../lib/cn.ts';

type Props = {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  /** Latest date that can be chosen. */
  max?: string;
};

const NAV_BUTTON = 'rounded-md p-1.5 leading-[0] transition-colors hover:bg-accent';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A date field that opens a calendar: pick a day instead of typing one. */
export function DatePicker({ id, value, onChange, max }: Props) {
  const [open, setOpen] = useState(false);
  const start = parseIso(value) ?? parseIso(todayIso())!;
  const [view, setView] = useState({ y: start.y, m: start.m });
  const box = useRef<HTMLDivElement>(null);
  const today = todayIso();

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      const p = parseIso(value) ?? parseIso(todayIso())!;
      setView({ y: p.y, m: p.m }); // always open on the chosen date's month
    }
    setOpen(!open);
  };
  const go = (by: number) => setView(shiftMonth(view.y, view.m, by));

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        id={id}
        className="flex w-full items-center justify-between rounded-[7px] border border-border bg-background px-3 py-[11px] text-left text-[13px]"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
      >
        {parseIso(value) ? dayLabel(value) : 'Choose a date'}
        <Calendar size={16} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-[calc(100%+6px)] z-[60] w-[308px] max-w-full rounded-xl border border-border bg-card p-3.5 shadow-2xl"
          role="group"
          aria-label="Choose a date"
        >
          <div className="mb-2.5 flex items-center justify-between">
            <button
              type="button"
              className={NAV_BUTTON}
              aria-label="Previous month"
              onClick={() => go(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <strong className="text-sm" aria-live="polite">
              {monthTitle(view.y, view.m)}
            </strong>
            <button
              type="button"
              className={NAV_BUTTON}
              aria-label="Next month"
              onClick={() => go(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((d) => (
              <span key={d} className="py-1.5 text-[10px] font-semibold text-muted-foreground">
                {d}
              </span>
            ))}
            {monthGrid(view.y, view.m)
              .flat()
              .map((cell) => {
                const disabled = !!max && cell.iso > max;
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    disabled={disabled}
                    aria-label={dayLabel(cell.iso)}
                    aria-pressed={cell.iso === value}
                    className={cn(
                      'h-9 rounded-lg text-[13px] tabular-nums transition-colors enabled:hover:bg-accent disabled:cursor-default disabled:opacity-30',
                      !cell.inMonth && 'text-muted-foreground/60',
                      cell.iso === today && 'font-bold text-positive',
                      cell.iso === value &&
                        'bg-primary font-bold text-primary-foreground enabled:hover:bg-primary',
                    )}
                    onClick={() => {
                      setOpen(false);
                      if (cell.iso !== value) onChange(cell.iso);
                    }}
                  >
                    {cell.day}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
