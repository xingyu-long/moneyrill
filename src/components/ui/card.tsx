import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn.ts';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col rounded-[26px] bg-card shadow-card max-[760px]:rounded-[22px]',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center justify-between gap-3 px-6 pt-6', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <h2
      className={cn('m-0 text-xs font-normal tracking-[0.04em] text-muted-foreground', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('flex flex-1 flex-col gap-2.5 px-6 pb-6 pt-3', className)} {...props} />
  );
}
