import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.tsx';
import { cn } from '../lib/cn.ts';
import { tabPath, type Tab } from '../lib/routes.ts';
import { linkClick } from '../state/router.ts';

// The building blocks of the Home modules.

/** One module on the Home page. A tile with a destination ends in a link to the full page. */
export function Tile({
  title,
  to,
  href,
  label,
  className,
  extra,
  children,
}: {
  title: string;
  to?: Tab;
  /** Where the link goes when that is not the tab's own page (for example a report for this month). */
  href?: string;
  /** The link's text when it is not the tab's name: say where the link goes ("Cash flow" for a report). */
  label?: string;
  className?: string;
  /** Controls shown at the right of the heading, before the link. */
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className={cn('relative z-10', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <div className="flex items-center gap-3">
          {extra}
          {to && (
            <a
              href={href ?? tabPath(to)}
              onClick={(e) => linkClick(e, href ?? tabPath(to))}
              className="inline-flex items-center gap-1 text-[11px] text-positive hover:underline"
            >
              {label ?? to} <ArrowRight size={13} />
            </a>
          )}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export const Stat = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down';
}) => (
  <div className="flex items-baseline justify-between gap-3 text-[13px]">
    <span className="text-muted-foreground">{label}</span>
    <strong
      className={cn(
        'font-medium tabular-nums',
        tone === 'up' && 'text-positive',
        tone === 'down' && 'text-destructive',
      )}
    >
      {value}
    </strong>
  </div>
);

export const Note = ({ children }: { children: ReactNode }) => (
  <p className="m-0 text-[11px] text-muted-foreground">{children}</p>
);

/** A few small labelled figures in a row, under a card's sentence. */
export const Figures = ({ items }: { items: [label: string, value: string][] }) => (
  <div className="flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-muted-foreground">
    {items.map(([label, value]) => (
      <span key={label}>
        {label}
        <b className="block text-[15px] font-medium tabular-nums text-foreground">{value}</b>
      </span>
    ))}
  </div>
);

/** A thin bar showing `fraction` (0 to 1) of its track; the track can be tinted (clay for debt). */
export const Meter = ({ fraction, track }: { fraction: number; track?: 'debt' }) => (
  <div
    className="h-2 overflow-hidden rounded-full bg-accent"
    style={
      track === 'debt'
        ? { background: 'color-mix(in srgb, var(--clay) 28%, transparent)' }
        : undefined
    }
  >
    <i
      className="block h-full rounded-full bg-sage"
      style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
    />
  </div>
);

/** The sentence at the top of a Home card, in the serif. */
export const SaySentence = ({ children }: { children: ReactNode }) => (
  <p className="m-0 font-serif text-[26px] leading-[1.15] text-muted-foreground">{children}</p>
);
