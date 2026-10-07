import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn.ts';

/** A small panel that floats under its button; the button's wrapper must be `relative`. */
export function PopoverPanel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'absolute right-0 top-11 z-10 grid min-w-60 gap-3.5 rounded-[18px] bg-card p-4 text-xs shadow-lg ring-1 ring-border',
        className,
      )}
      {...props}
    />
  );
}
