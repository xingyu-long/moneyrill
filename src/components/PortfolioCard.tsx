import { Chart, Empty, Range } from './common.tsx';
import { Card } from './ui/card.tsx';
import { MASK, cash, dateLabelYear, delta, isPrivate, pct } from '../lib/format.ts';
import { valueSeries } from '../lib/performance.ts';
import { periodName } from '../lib/summary.ts';
import { useApp } from '../state/AppContext.tsx';

const PERIODS = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as const;

/** A signed percent, "+14.2%" ("—" when it cannot be worked out). */
const signedPercent = (v: number | null) =>
  v === null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

/** A signed amount; masked in Private mode, which also hides which way it went. */
const signedCash = (v: number | null) =>
  v === null || !Number.isFinite(v)
    ? '—'
    : isPrivate()
      ? MASK
      : `${v >= 0 ? '+' : '−'}${cash(Math.abs(v))}`;

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <span className="text-xs text-muted-foreground">
      {label}
      <b
        className={
          'mt-1 block text-[17px] font-medium tabular-nums ' +
          (tone === 'up'
            ? 'text-positive'
            : tone === 'down'
              ? 'text-destructive'
              : 'text-foreground')
        }
      >
        {value}
      </b>
    </span>
  );
}

const WHY = {
  range: '',
  balance: ' (the first balance on record)',
  flows: ' (cash flows are known from the day after)',
} as const;

/** Where the return starts and what the portfolio was worth then, and what held the start back from the range. */
function CountedFrom({
  from,
  value,
  limit,
}: {
  from: string;
  value: number;
  limit: keyof typeof WHY;
}) {
  return (
    <p className="mb-2 text-xs text-muted-foreground" data-testid="counted-from">
      Counted from {dateLabelYear(from)} · opening balance {cash(value)}
      {WHY[limit]}
    </p>
  );
}

/** The portfolio's value, what it returned over the chosen range, and its history. */
export function PortfolioCard() {
  const { activePeriod, investmentHistory, portfolio, portfolioStart, returns } = useApp();
  // The return takes deposits and withdrawals out; when it cannot be worked out, the change in value stands in.
  const ret = returns
    ? returns.ret === null
      ? null
      : returns.ret * 100
    : pct(portfolio, portfolioStart);
  const gain = returns ? returns.gain : delta(portfolio, portfolioStart);
  const name = periodName(activePeriod);
  return (
    <Card className="gap-0 p-8 max-[760px]:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 text-xs text-muted-foreground">
        <span>Portfolio value · all investment accounts</span>
        <Range options={PERIODS} soft />
      </div>
      <div className="mb-3 mt-1 flex flex-wrap items-end gap-x-10 gap-y-3">
        <div className="font-serif text-[64px] leading-none tabular-nums max-[760px]:text-[44px]">
          {cash(portfolio)}
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-2 pb-1.5">
          <Stat
            label={returns ? `${name} return` : `${name} value change`}
            value={signedPercent(ret)}
            tone={ret === null ? undefined : ret < 0 ? 'down' : 'up'}
          />
          <Stat
            label="Gain"
            value={signedCash(gain)}
            tone={gain === null || isPrivate() ? undefined : gain < 0 ? 'down' : 'up'}
          />
          {returns && <Stat label="Contributed" value={cash(returns.flow)} />}
        </div>
      </div>
      {investmentHistory.length > 1 ? (
        <>
          {returns && (
            <CountedFrom from={returns.from} value={returns.startValue} limit={returns.limit} />
          )}
          <Chart points={returns ? valueSeries(returns) : investmentHistory} bare />
        </>
      ) : (
        <Empty text="A period comparison needs at least two dated snapshots." />
      )}
    </Card>
  );
}
