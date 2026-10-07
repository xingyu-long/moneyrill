import { X } from 'lucide-react';
import { useApp } from '../state/AppContext.tsx';

export function ErrorAlert() {
  const { error, setError } = useApp();
  return (
    <>
      {error && (
        <div
          className="my-[15px] flex items-center justify-between gap-[15px] rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-[13px] text-xs text-destructive"
          role="alert"
        >
          {error}
          <button
            className="flex items-center"
            onClick={() => setError('')}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
