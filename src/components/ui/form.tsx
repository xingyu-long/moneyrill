import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

/** A label above its control; the control goes inside so the label names it. */
export function Field({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label className={cn('grid gap-2 text-[11px] text-muted-foreground', className)} {...props} />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full resize-y rounded-[7px] border border-border bg-background px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-positive',
        className,
      )}
      {...props}
    />
  );
}

export const EYEBROW = 'mb-[11px] text-[9px] font-semibold tracking-[2px] text-muted-foreground';

/** A form's fields, one under another. */
export const FORM = 'grid gap-[17px]';

/** A box of related fields. */
export const FIELD_BOX = 'grid gap-3 rounded-[10px] border border-border bg-muted/40 p-3';

/** A short notice (a pending transaction, a bank change). */
export function Callout({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      className={cn(
        'm-0 rounded-lg bg-warning/15 px-[11px] py-[9px] text-[11px] text-warning',
        className,
      )}
      {...props}
    />
  );
}

/** A value shown as text where it cannot be edited. */
export function ReadonlyValue({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'whitespace-pre-wrap rounded-[7px] border border-border bg-muted/40 px-3 py-[11px] text-[13px]',
        className,
      )}
      {...props}
    />
  );
}

/** Label and value rows with a line between them. */
export function DetailList({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="my-[25px]">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex justify-between gap-3 border-b border-border py-3.5 text-[11px] text-muted-foreground"
        >
          <span>{label}</span>
          <strong className="font-normal text-foreground">{value}</strong>
        </div>
      ))}
    </div>
  );
}
