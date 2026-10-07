import { RefreshCw, Search } from 'lucide-react';
import { api } from '../api.ts';
import { MainNav } from './MainNav.tsx';
import { PrivateButton } from './PrivateButton.tsx';
import { Button } from './ui/button.tsx';
import { cn } from '../lib/cn.ts';
import { useApp } from '../state/AppContext.tsx';
import { hrefFor, linkClick } from '../state/router.ts';

// A round button on the bar: the card colour with a soft shadow, so it stands out from the page.
const ROUND = 'bg-card shadow-card hover:bg-accent';

/** Focus the transactions search box once the page has drawn it (it may still be loading). */
function focusSearchSoon() {
  let tries = 0;
  const timer = setInterval(() => {
    const box = document.querySelector<HTMLInputElement>(
      'input[type="search"][aria-label="Search transactions"]',
    );
    if (box) box.focus();
    if (box || ++tries > 30) clearInterval(timer);
  }, 50);
}

/**
 * The bar at the top: the wordmark, the pages (see MainNav) and the things that belong to the whole app. It sticks
 * to the top on a computer; on a phone it scrolls away and the pages float at the bottom instead.
 */
export function Topbar() {
  const { action, busy, data, environmentName, production, signOut } = useApp();
  const search = hrefFor('Transactions');
  return (
    <header className="z-30 min-[761px]:sticky min-[761px]:top-0 min-[761px]:bg-background/90 min-[761px]:backdrop-blur">
      <div className="relative mx-auto grid max-w-[1700px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-[38px] py-[18px] max-[1150px]:px-[25px] min-[1600px]:px-[55px] max-[760px]:flex max-[760px]:flex-wrap max-[760px]:gap-x-3 max-[760px]:gap-y-2.5 max-[760px]:px-4 max-[760px]:py-3.5">
        <a
          className="justify-self-start font-serif text-[29px] leading-none tracking-[-0.01em]"
          href="/home"
          onClick={(e) => linkClick(e, hrefFor('Home'))}
        >
          money<span className="italic text-sage">rill</span>
        </a>
        <MainNav />
        <div className="flex items-center justify-end gap-2.5 min-[761px]:pr-[50px] max-[760px]:flex-1">
          <Button variant="outline" size="sm" className={ROUND} onClick={() => void signOut()}>
            Sign out
          </Button>
          {production ? (
            // Production shows no environment badge: the round Sync button takes its place.
            <button
              type="button"
              aria-label="Sync accounts"
              title="Sync connected accounts"
              disabled={busy || !data.connections.some((c) => !c.disconnected_at)}
              className={cn(
                ROUND,
                'grid size-[38px] place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
              )}
              onClick={() => action(() => api('/sync', {}), 'Accounts synced')}
            >
              <RefreshCw size={16} className={cn(busy && 'animate-spin')} />
            </button>
          ) : (
            <span className="env-badge staging rounded-full bg-warning/15 px-3 py-1.5 text-[9px] tracking-[1.4px] text-warning">
              {environmentName.toUpperCase()}
            </span>
          )}
          <a
            href={search}
            aria-label="Search"
            title="Search transactions"
            className={cn(
              ROUND,
              'grid size-[38px] place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground max-[760px]:hidden',
            )}
            onClick={(e) => {
              if (linkClick(e, search)) focusSearchSoon();
            }}
          >
            <Search size={16} />
          </a>
          <PrivateButton compact />
        </div>
      </div>
    </header>
  );
}
