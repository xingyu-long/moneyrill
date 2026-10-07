import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { Card } from '../ui/card.tsx';

/** One block on a Settings page: an icon, a serif title, a line of explanation, then its controls. */
export function SettingsCard({
  icon,
  title,
  description,
  className,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Card className={cn('p-7 max-[760px]:p-6', className)}>
      {icon && (
        <div className="mb-5 grid size-[45px] place-items-center rounded-full bg-accent text-sage">
          {icon}
        </div>
      )}
      <h2 className="m-0 mb-3 font-serif text-2xl font-normal text-foreground">{title}</h2>
      {description && (
        <p className="m-0 mb-5 max-w-[510px] text-xs text-muted-foreground">{description}</p>
      )}
      {children}
    </Card>
  );
}

export const Fineprint = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn('m-0 text-[10px] leading-[1.8] text-muted-foreground', className)}>{children}</p>
);

/** Buttons side by side, wrapping on a narrow screen. */
export const ButtonRow = ({ children }: { children: ReactNode }) => (
  <div className="my-[23px] flex flex-wrap gap-2.5">{children}</div>
);
