import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

/** A row of options of which one is chosen (shadcn's "tabs" look), for things like the chart range. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  tone = 'default',
  render = (o) => o,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** `soft`: no track, the chosen option a white pill (the chart range); `plain`: no track, the chosen option ink. */
  tone?: 'default' | 'soft' | 'plain';
  render?: (option: T) => ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex h-9 items-center rounded-full p-1 text-xs',
        tone === 'default' && 'bg-muted',
      )}
    >
      {options.map((o) => (
        <button
          key={o}
          aria-pressed={o === value}
          onClick={() => onChange(o)}
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-3 py-1 font-medium transition-colors',
            o === value
              ? tone === 'soft'
                ? 'bg-card text-foreground shadow-card'
                : 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}
