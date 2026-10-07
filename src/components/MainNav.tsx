import { useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { TABS, type Tab } from '../lib/routes.ts';
import { barTabs, moreTabs } from '../lib/navigation.ts';
import { useApp } from '../state/AppContext.tsx';
import { hrefFor, linkClick } from '../state/router.ts';
import { TAB_ICONS } from './navIcons.ts';
import { cn } from '../lib/cn.ts';

// One nav, three looks. Above 1000px: a pill of page names, with Settings as a round button at the far right of the
// top bar. 761-1000px: the same pill as icons. On a phone (760px and below): a floating bar of icons at the bottom
// where the chosen page widens to show its name, and the pages that are not in the bar sit under More.
const ITEM =
  'flex items-center justify-center whitespace-nowrap rounded-full font-medium text-muted-foreground transition-colors hover:text-foreground min-[761px]:px-4 min-[761px]:py-[7px] min-[761px]:text-sm min-[761px]:max-[1000px]:size-10 min-[761px]:max-[1000px]:p-0 max-[760px]:h-[46px] max-[760px]:min-w-0 max-[760px]:flex-1 max-[760px]:[order:var(--bar-order,0)]';
const SELECTED =
  'bg-primary text-primary-foreground hover:text-primary-foreground max-[760px]:flex-none max-[760px]:gap-1.5 max-[760px]:px-4 max-[760px]:text-[13px]';
// Settings is a round button on a computer, placed against the right edge of the top bar (the bar is its container).
const GEAR =
  'min-[761px]:absolute min-[761px]:right-[38px] min-[761px]:top-1/2 min-[761px]:size-[38px] min-[761px]:-translate-y-1/2 min-[761px]:p-0 max-[1150px]:min-[761px]:right-[25px]';
const GEAR_IDLE = 'min-[761px]:bg-card min-[761px]:shadow-card';
// The offset of the floating bar from the bottom edge, which clears the home indicator.
const BAR_BOTTOM = 'max(16px,env(safe-area-inset-bottom))';

export function MainNav() {
  const { setSearch, tab, tabBar } = useApp();
  const inBar = barTabs(tabBar);
  const more = moreTabs(tabBar);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreSelected = more.includes(tab);
  return (
    <>
      <nav
        aria-label="Main"
        className="flex items-center gap-1 rounded-full bg-card p-[5px] shadow-card max-[760px]:fixed max-[760px]:inset-x-[18px] max-[760px]:bottom-[max(16px,env(safe-area-inset-bottom))] max-[760px]:z-40 max-[760px]:justify-around max-[760px]:bg-card/90 max-[760px]:p-2 max-[760px]:shadow-lg max-[760px]:ring-1 max-[760px]:ring-border max-[760px]:backdrop-blur-xl"
      >
        {TABS.map((label: Tab) => {
          const href = hrefFor(label);
          const Icon = TAB_ICONS[label];
          const slot = inBar.indexOf(label);
          const selected = tab === label;
          const gear = label === 'Settings';
          return (
            <a
              key={label}
              href={href}
              aria-current={selected ? 'page' : undefined}
              className={cn(
                ITEM,
                gear && GEAR,
                gear && !selected && GEAR_IDLE,
                selected && SELECTED,
                slot < 0 && 'off-bar max-[760px]:hidden',
              )}
              style={{ '--bar-order': slot } as React.CSSProperties}
              onClick={(e) => {
                if (linkClick(e, href)) setSearch('');
              }}
            >
              <Icon
                size={gear ? 18 : 20}
                className={
                  gear
                    ? 'shrink-0'
                    : 'hidden shrink-0 max-[760px]:block min-[761px]:max-[1000px]:block'
                }
              />
              <span
                className={cn(
                  gear ? 'min-[761px]:sr-only' : 'min-[761px]:max-[1000px]:sr-only',
                  !selected && 'max-[760px]:sr-only',
                )}
              >
                {label}
              </span>
            </a>
          );
        })}
        {more.length > 0 && (
          <button
            className={cn(ITEM, 'hidden max-[760px]:flex', moreSelected && SELECTED)}
            style={{ '--bar-order': inBar.length } as React.CSSProperties}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            <Ellipsis size={20} className="shrink-0" />
            <span className={cn(!moreSelected && 'max-[760px]:sr-only')}>More</span>
          </button>
        )}
      </nav>
      {moreOpen && (
        <>
          <button
            className="fixed inset-0 z-[38] bg-transparent min-[761px]:hidden"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="fixed right-[18px] z-[41] grid min-w-[200px] rounded-[22px] bg-card p-2 shadow-lg ring-1 ring-border min-[761px]:hidden"
            style={{ bottom: `calc(${BAR_BOTTOM} + 74px)` }}
            role="menu"
          >
            {more.map((label) => {
              const Icon = TAB_ICONS[label];
              const href = hrefFor(label);
              return (
                <a
                  key={label}
                  href={href}
                  role="menuitem"
                  className={cn(
                    'flex items-center gap-3 rounded-full px-4 py-3 text-sm',
                    tab === label && 'bg-primary text-primary-foreground',
                  )}
                  onClick={(e) => {
                    if (linkClick(e, href)) setSearch('');
                    setMoreOpen(false);
                  }}
                >
                  <Icon size={19} />
                  {label}
                </a>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
