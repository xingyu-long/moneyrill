import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn.ts';

/** An on/off toggle (shadcn's switch). The label comes from `aria-label` or an enclosing label. */
export function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'onChange'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-[26px] w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-sage',
        checked ? 'bg-sage' : 'bg-accent',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'block size-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[21px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}
