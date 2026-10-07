import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn.ts';

/** A dimmed layer over the page; clicking it (or pressing Escape) closes what is on it. */
export function Overlay({
  onClose,
  className,
  children,
}: {
  /** Without it the layer stays until the content closes itself (a dialog that must be answered). */
  onClose?: () => void;
  className?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm',
        className,
      )}
      onClick={onClose}
    >
      {children}
    </div>
  );
}

// The panel itself does not scroll: its content does, so the close button stays in view however far you scroll.
const PANEL =
  'relative flex flex-col overflow-hidden bg-card shadow-2xl [&_h2]:mb-3 [&_h2]:font-serif [&_h2]:text-[28px] [&_h2]:font-normal';
const SCROLL = 'min-h-0 flex-1 overflow-auto';

function CloseButton({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-card/90 text-muted-foreground hover:text-foreground"
      onClick={onClose}
    >
      <X size={19} />
    </button>
  );
}

/** A centred dialog with a serif title and a close button. */
export function Dialog({
  title,
  eyebrow,
  closeLabel,
  onClose,
  dismissable = true,
  className,
  contentClassName,
  children,
}: {
  title: string;
  /** A small line above the title. */
  eyebrow?: ReactNode;
  /** What the close button is called (default: Close, then the title). */
  closeLabel?: string;
  onClose: () => void;
  /** False: only the close button (or the dialog's own buttons) end it, not Escape or a click outside. */
  dismissable?: boolean;
  className?: string;
  /** Layout classes for what scrolls inside the panel. */
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <Overlay onClose={dismissable ? onClose : undefined}>
      <section
        role="dialog"
        aria-label={title}
        className={cn(PANEL, 'max-h-[95dvh] w-[460px] max-w-[95vw] rounded-[26px]', className)}
        onClick={(e) => e.stopPropagation()}
      >
        <CloseButton label={closeLabel ?? `Close ${title}`} onClose={onClose} />
        <div className={cn(SCROLL, 'p-9 max-[760px]:p-7', contentClassName)}>
          {eyebrow && (
            <div className="mb-[11px] text-[9px] font-semibold tracking-[2px] text-muted-foreground">
              {eyebrow}
            </div>
          )}
          <h2>{title}</h2>
          {children}
        </div>
      </section>
    </Overlay>
  );
}

/**
 * A panel that slides in from the right edge. On a phone it is the full screen, or, with `sheet`, a sheet that
 * rises from the bottom edge and leaves the page visible above it.
 */
export function Drawer({
  title,
  closeLabel,
  onClose,
  className,
  contentClassName,
  sheet = false,
  children,
}: {
  title: string;
  closeLabel?: string;
  onClose: () => void;
  className?: string;
  /** Layout classes for what scrolls inside the panel. */
  contentClassName?: string;
  sheet?: boolean;
  children: ReactNode;
}) {
  return (
    <Overlay onClose={onClose} className={cn('justify-end', sheet && 'max-[760px]:items-end')}>
      <aside
        role="dialog"
        aria-label={title}
        className={cn(
          PANEL,
          'h-dvh w-[500px] max-w-full rounded-l-[26px] max-[760px]:w-full max-[760px]:rounded-none',
          sheet &&
            'max-[760px]:h-auto max-[760px]:max-h-[92dvh] max-[760px]:rounded-b-none max-[760px]:rounded-t-[26px]',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <CloseButton label={closeLabel ?? `Close ${title}`} onClose={onClose} />
        {sheet && (
          <div
            aria-hidden="true"
            className="mx-auto mt-2.5 hidden h-1 w-10 shrink-0 rounded-full bg-border max-[760px]:block"
          />
        )}
        <div className={cn(SCROLL, 'p-9 pt-14', sheet && 'max-[760px]:pt-8', contentClassName)}>
          {children}
        </div>
      </aside>
    </Overlay>
  );
}
