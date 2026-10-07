import { download } from '../api.ts';
import { SortHead } from './common.tsx';
import { cash, percent, price, shares } from '../lib/format.ts';
import { securityKey } from '../lib/holdings.ts';
import { cn } from '../lib/cn.ts';
import { useApp } from '../state/AppContext.tsx';
import { Card } from './ui/card.tsx';
import { Table, Td } from './ui/table.tsx';

// On a phone Price and Shares are left to the security drawer so Market value fits, the cells are tighter,
// and the Security column stays pinned while the table scrolls sideways.
const PHONE_HIDDEN = 'max-[760px]:hidden';
const PHONE_CELL = 'max-[760px]:px-3 max-[760px]:py-3.5';
const FIRST_CELL =
  'max-[760px]:sticky max-[760px]:left-0 max-[760px]:z-[1] max-[760px]:bg-card max-[760px]:px-3 max-[760px]:py-3.5 max-[760px]:shadow-[1px_0_0_var(--line)]';
const CLICKABLE = 'group-hover:bg-accent group-focus-visible:bg-accent';

export function HoldingsTable() {
  const { portfolio, positions, setOpenSecurity } = useApp();
  return (
    <Card className="holdings-card gap-0 pt-7">
      <div className="flex items-center justify-between gap-3 px-5 pb-3 text-xs text-muted-foreground">
        <h2 className="m-0 text-xs font-normal">Holdings</h2>
        <button
          className="text-positive hover:underline"
          onClick={() =>
            download(
              'holdings.csv',
              [
                'security,name,quantity,price,value,weight',
                ...positions.map((h) =>
                  [
                    h.symbol,
                    h.name,
                    h.quantity,
                    h.price,
                    h.value,
                    portfolio > 0 ? ((h.value ?? 0) / portfolio) * 100 : '',
                  ]
                    .map((v) => '"' + String(v ?? '').replaceAll('"', '""') + '"')
                    .join(','),
                ),
              ].join('\n'),
            )
          }
        >
          Export CSV
        </button>
      </div>
      <Table>
        <thead>
          <tr>
            <SortHead k="symbol" label="Security" className={FIRST_CELL} />
            <SortHead k="quantity" label="Shares" className={cn('col-shares', PHONE_HIDDEN)} />
            <SortHead k="price" label="Price" className={cn('col-price', PHONE_HIDDEN)} />
            <SortHead k="value" label="Value" className={PHONE_CELL} />
            <SortHead k="change" label="Change" className={PHONE_CELL} />
          </tr>
        </thead>
        <tbody>
          {positions.map((h) => {
            const clickable = h.asset_class !== 'Unreported';
            return (
              <tr
                key={h.security_id}
                className={cn('group', clickable && 'cursor-pointer')}
                tabIndex={clickable ? 0 : undefined}
                onClick={() => clickable && setOpenSecurity(securityKey(h))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && clickable) setOpenSecurity(securityKey(h));
                }}
              >
                <Td className={cn(FIRST_CELL, CLICKABLE)}>
                  <span className="flex items-baseline gap-2 text-[13px]">
                    <span className="security-symbol font-medium">{h.symbol || '—'}</span>
                    <span className="max-w-[170px] truncate text-xs font-normal text-muted-foreground max-[760px]:hidden">
                      {h.name}
                    </span>
                  </span>
                  {h.accountName && (
                    <span className="holding-account mt-0.5 block text-[10px] text-muted-foreground">
                      {h.accountName}
                    </span>
                  )}
                </Td>
                <Td className={cn('col-shares', PHONE_HIDDEN, CLICKABLE)}>{shares(h.quantity)}</Td>
                <Td className={cn('col-price', PHONE_HIDDEN, CLICKABLE)}>{price(h.price)}</Td>
                <Td className={cn('font-medium', PHONE_CELL, CLICKABLE)}>{cash(h.value)}</Td>
                <Td
                  className={cn(
                    PHONE_CELL,
                    CLICKABLE,
                    h.change !== null && h.change < 0 ? 'text-destructive' : 'text-positive',
                  )}
                >
                  {percent(h.change)}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
