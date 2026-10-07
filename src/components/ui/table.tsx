import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn.ts';

/** A table that scrolls sideways inside its card instead of widening the page. */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="overflow-auto">
      <table className={cn('w-full border-collapse whitespace-nowrap', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'border-b border-border px-5 py-4 text-right text-[10px] font-medium text-muted-foreground tabular-nums first:text-left',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      className={cn(
        'border-b border-border px-5 py-[18px] text-right text-xs tabular-nums first:text-left',
        className,
      )}
      {...props}
    />
  );
}
