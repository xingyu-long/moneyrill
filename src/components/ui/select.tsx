import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn.ts';

/** A native select with the shadcn look (so it keeps the platform's own menu and keyboard behaviour). */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-8 rounded-full bg-muted px-3 py-0 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-sage',
        className,
      )}
      {...props}
    />
  );
}
