import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn.ts';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-8 w-full rounded-full bg-muted px-3.5 py-0 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-sage',
        className,
      )}
      {...props}
    />
  );
}
