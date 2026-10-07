import { cn } from '../lib/cn.ts';
import type { Sentence } from '../lib/summary.ts';

/** A sentence with its figures styled: amounts plain, highlighted numbers in italic sage, a problem in clay. */
export function Words({ sentence }: { sentence: Sentence }) {
  return (
    <>
      {sentence.map((p, i) => (
        <span
          key={i}
          className={cn(
            p.style === 'money' && 'text-foreground',
            p.style === 'figure' && 'italic text-sage',
            p.style === 'warn' && 'text-warning',
          )}
        >
          {p.text}
        </span>
      ))}
    </>
  );
}
