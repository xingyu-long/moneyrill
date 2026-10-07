import { Check } from 'lucide-react';
import { useApp } from '../state/AppContext.tsx';

export function Toast() {
  const { toast } = useApp();
  return (
    <>
      {toast && (
        <div
          className="fixed bottom-[25px] left-1/2 z-[80] flex max-w-[80vw] -translate-x-1/2 items-center gap-2.5 rounded-lg bg-primary px-[22px] py-4 text-xs text-primary-foreground shadow-lg max-[760px]:bottom-[calc(80px+env(safe-area-inset-bottom))]"
          role="status"
        >
          <Check size={17} />
          {toast}
        </div>
      )}
    </>
  );
}
