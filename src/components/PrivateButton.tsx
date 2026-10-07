import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/cn.ts';
import { useApp } from '../state/AppContext.tsx';
import { Button } from './ui/button.tsx';

/** Hides amounts and share counts on this device. `compact` is the round icon in the top bar. */
export function PrivateButton({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { privacy, togglePrivacy } = useApp();
  const title = 'Hide amounts and share counts; growth percentages stay visible';
  const Icon = privacy ? EyeOff : Eye;
  if (compact)
    return (
      <button
        type="button"
        aria-pressed={privacy}
        aria-label={privacy ? 'Private mode on' : 'Private mode'}
        title={title}
        onClick={togglePrivacy}
        className={cn(
          'grid size-[38px] place-items-center rounded-full bg-card text-muted-foreground shadow-card transition-colors hover:text-foreground',
          privacy && 'text-positive',
          className,
        )}
      >
        <Icon size={16} />
      </button>
    );
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={privacy}
      title={title}
      onClick={togglePrivacy}
      className={cn(privacy && 'border-positive text-positive', className)}
    >
      <Icon size={14} />
      {privacy ? 'Private mode on' : 'Private mode'}
    </Button>
  );
}
