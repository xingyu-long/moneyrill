import { tooltipStyle } from './chartStyle.ts';
import { Range } from './common.tsx';
import { cash, dateLabel, dateLabelYear, percent, price, shares } from '../lib/format.ts';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../state/AppContext.tsx';
import { cn } from '../lib/cn.ts';
import { Drawer } from './ui/dialog.tsx';
import { DetailList, EYEBROW } from './ui/form.tsx';
import { Fineprint } from './settings/SettingsCard.tsx';

export function SecurityDrawer() {
  const { investmentPeriod, securityDetail, setOpenSecurity, tab } = useApp();
  return (
    <>
      {securityDetail && tab === 'Investments' && (
        <Drawer
          title={securityDetail.name}
          closeLabel="Close security details"
          onClose={() => setOpenSecurity(null)}
        >
          <div className={EYEBROW}>{securityDetail.symbol || 'SECURITY'}</div>
          <h2 className="!mb-2">{securityDetail.name}</h2>
          <div className="mb-[18px] mt-2 flex flex-wrap items-baseline gap-3">
            <strong className="text-3xl font-medium">{price(securityDetail.price)}</strong>
            {securityDetail.change !== null && (
              <span
                className={cn(
                  'inline-flex items-center gap-[3px] text-[11px]',
                  securityDetail.change < 0 ? 'text-destructive' : 'text-positive',
                )}
              >
                {securityDetail.change < 0 ? (
                  <ArrowDownRight size={14} />
                ) : (
                  <ArrowUpRight size={14} />
                )}
                {price(Math.abs(securityDetail.amount || 0))} (
                {Math.abs(securityDetail.change).toFixed(1)}%)
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {investmentPeriod === 'ALL'
                ? 'All time'
                : investmentPeriod === 'YTD'
                  ? 'Year to date'
                  : 'Past ' + investmentPeriod}
            </span>
          </div>
          <Range />
          {securityDetail.points.length > 1 ? (
            <ResponsiveContainer width="100%" height={230}>
              <LineChart
                data={securityDetail.points}
                margin={{ top: 20, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeDasharray="3 5" />
                <XAxis
                  dataKey="date"
                  tickFormatter={dateLabel}
                  minTickGap={40}
                  tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `${v.toFixed(0)}%`}
                  width={45}
                  tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(v) => dateLabelYear(String(v))}
                  formatter={(v: any) => percent(Number(v))}
                />
                <Line
                  name="Price change"
                  type="monotone"
                  dataKey="change"
                  stroke="var(--chart-line)"
                  dot={false}
                  strokeWidth={2.5}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Fineprint>Price history needs at least two saved snapshots in this period.</Fineprint>
          )}
          <h3 className="mb-2 mt-7 text-[17px] font-semibold">Summary</h3>
          <DetailList
            rows={[
              ['Quantity', shares(securityDetail.quantity)],
              ['Value', cash(securityDetail.value)],
            ]}
          />
          <h3 className="mb-2 mt-7 text-[17px] font-semibold">Accounts</h3>
          {securityDetail.accounts.map((h) => (
            <div
              className="flex items-center justify-between gap-3 border-t border-border py-4"
              key={h.account_id}
            >
              <span>
                <strong className="block text-[13px] font-medium">{h.accountName}</strong>
                <small className="mt-[5px] block text-[11px] text-muted-foreground">
                  {shares(h.quantity)} shares
                </small>
              </span>
              <b className="text-sm font-medium">{cash(h.value)}</b>
            </div>
          ))}
        </Drawer>
      )}
    </>
  );
}
