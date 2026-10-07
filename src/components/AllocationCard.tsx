import { useState } from 'react';
import { COLORS, cash, share } from '../lib/format.ts';
import { allocationSentence } from '../lib/summary.ts';
import { cn } from '../lib/cn.ts';
import { useApp } from '../state/AppContext.tsx';
import { Card } from './ui/card.tsx';
import { Segmented } from './ui/segmented.tsx';
import { Words } from './Words.tsx';

const GROUPINGS = ['asset', 'account', 'security'] as const;
const LABELS = { asset: 'Asset class', account: 'Account', security: 'Security' };

/** What the portfolio is made of: one bar split by weight, and the table behind it. */
export function AllocationCard() {
  const {
    allocation,
    allocations,
    allocationTotal,
    negativeAllocation,
    positiveAllocation,
    setAllocation,
  } = useApp();
  const [hovered, setHovered] = useState<string | null>(null);
  const top = positiveAllocation.length
    ? [...positiveAllocation].sort((a, b) => b.value - a.value)[0]
    : null;
  return (
    <Card className="gap-0 p-7 max-[760px]:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Allocation</span>
        <Segmented
          label="Allocation grouping"
          tone="plain"
          options={GROUPINGS}
          value={
            GROUPINGS.includes(allocation as never)
              ? (allocation as (typeof GROUPINGS)[number])
              : 'asset'
          }
          onChange={setAllocation}
          render={(g) => LABELS[g]}
        />
      </div>
      <p className="m-0 mb-4 mt-2 font-serif text-[26px] leading-[1.15] text-muted-foreground">
        <Words
          sentence={allocationSentence(
            top && allocationTotal > 0
              ? { name: top.name, share: (top.value / allocationTotal) * 100 }
              : null,
          )}
        />
      </p>
      {negativeAllocation ? (
        <p className="m-0 py-4 text-xs text-muted-foreground">
          A bar cannot represent negative positions. Review the weights below.
        </p>
      ) : (
        <div role="img" aria-label="Allocation" className="mb-3 flex h-4 gap-[3px]">
          {positiveAllocation.map((a, i) => (
            <i
              key={a.name}
              title={`${a.name}: ${cash(a.value)} (${share(a.value, allocationTotal)})`}
              className="block h-full min-w-1 transition-opacity first:rounded-l-full last:rounded-r-full"
              style={{
                flex: a.value,
                background: COLORS[i % COLORS.length],
                opacity: hovered && hovered !== a.name ? 0.35 : 1,
              }}
              onMouseEnter={() => setHovered(a.name)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </div>
      )}
      <div>
        {allocations.map((a, i) => (
          <div
            key={a.name}
            data-active={hovered === a.name || undefined}
            className={cn(
              'grid grid-cols-[1fr_55px_105px] items-center gap-3 rounded-xl border-b border-border px-2 py-3 text-[13px] transition-colors last:border-b-0',
              hovered === a.name && 'bg-accent',
            )}
            onMouseEnter={() => setHovered(a.name)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <i
                className="inline-block size-2.5 shrink-0 rounded-full"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              <span className="truncate">{a.name}</span>
            </span>
            <span className="text-right text-muted-foreground">
              {share(a.value, allocationTotal)}
            </span>
            <b className="text-right font-normal tabular-nums">{cash(a.value)}</b>
          </div>
        ))}
      </div>
    </Card>
  );
}
