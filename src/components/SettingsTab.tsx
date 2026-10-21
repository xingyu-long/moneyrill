import {
  ArrowLeft,
  ChevronRight,
  Database,
  KeyRound,
  Landmark,
  LayoutList,
  ListFilter,
  RefreshCw,
  Shapes,
  ShieldCheck,
} from 'lucide-react';
import { SETTINGS_PAGES, settingsPageOf, settingsPath, type SettingsSlug } from '../lib/routes.ts';
import { linkClick, useLocation } from '../state/router.ts';
import { cn } from '../lib/cn.ts';
import { useApp } from '../state/AppContext.tsx';
import { RulesPage } from './RulesPage.tsx';
import { Card } from './ui/card.tsx';
import {
  CategoriesPage,
  ConnectionsPage,
  DataPage,
  DisplayPage,
  SignInPage,
  SyncPage,
} from './SettingsPages.tsx';

const ICONS = {
  connections: Landmark,
  data: Database,
  categories: Shapes,
  rules: ListFilter,
  sync: RefreshCw,
  display: LayoutList,
  'sign-in': KeyRound,
};
const PAGES: Record<SettingsSlug, () => React.JSX.Element> = {
  connections: ConnectionsPage,
  data: DataPage,
  categories: CategoriesPage,
  rules: RulesPage,
  sync: SyncPage,
  display: DisplayPage,
  'sign-in': SignInPage,
};

/** What the app promises, and where it is running: it used to sit at the foot of the sidebar. */
function Keepsake() {
  const { environmentName } = useApp();
  return (
    <Card className="gap-3 p-5">
      <ShieldCheck size={20} className="text-sage" />
      <strong className="block font-serif text-2xl font-normal leading-tight">
        Yours to keep.
      </strong>
      <p className="m-0 text-xs leading-[1.8] text-muted-foreground">
        Local storage.
        <br />
        Private database.
        <br />
        Your financial picture.
      </p>
      <span className="flex items-center gap-[7px] text-[10px] text-muted-foreground">
        <span className="inline-block size-1.5 shrink-0 rounded-full bg-positive" />{' '}
        {environmentName}
      </span>
      <div className="flex items-center gap-[11px] border-t border-border pt-3.5 text-xs">
        <span className="grid size-[33px] place-items-center rounded-full bg-accent font-serif text-lg text-positive">
          Y
        </span>
        <div>
          Your workspace
          <small className="mt-1 block text-[10px] text-muted-foreground">Personal · local</small>
        </div>
      </div>
    </Card>
  );
}

/**
 * Settings has a list of pages and one page at a time. On a computer the list sits beside the page (Connections
 * when none is chosen); on a phone `/settings` is the list alone and each page opens full screen with a way back.
 */
export function SettingsTab() {
  const { path } = useLocation();
  const chosen = settingsPageOf(path);
  const current = SETTINGS_PAGES.find((p) => p.slug === (chosen ?? 'connections'))!;
  const Page = PAGES[current.slug];
  return (
    <div className="my-6 grid items-start gap-6 min-[761px]:grid-cols-[250px_minmax(0,1fr)] max-[760px]:my-[18px] max-[760px]:block">
      <div
        className={cn(
          'grid gap-4 min-[761px]:sticky min-[761px]:top-[92px]',
          chosen && 'max-[760px]:hidden',
        )}
      >
        <nav
          className="grid gap-1 rounded-[22px] bg-card p-2.5 shadow-card max-[760px]:gap-2.5 max-[760px]:bg-transparent max-[760px]:p-0 max-[760px]:shadow-none"
          aria-label="Settings pages"
        >
          {SETTINGS_PAGES.map((p) => {
            const Icon = ICONS[p.slug];
            const href = settingsPath(p.slug);
            const on = p.slug === current.slug;
            return (
              <a
                key={p.slug}
                href={href}
                className={cn(
                  'flex items-center gap-[11px] rounded-full px-3 py-[11px] text-[13px] transition-colors hover:bg-accent max-[760px]:rounded-[13px] max-[760px]:border max-[760px]:border-border max-[760px]:bg-card max-[760px]:p-3.5 max-[760px]:text-[15px]',
                  on && 'bg-accent text-positive max-[760px]:bg-card max-[760px]:text-foreground',
                )}
                aria-current={on ? 'page' : undefined}
                onClick={(e) => linkClick(e, href)}
              >
                <span className="grid size-[30px] place-items-center rounded-lg bg-muted max-[760px]:size-[38px] max-[760px]:rounded-[10px]">
                  <Icon size={17} />
                </span>
                {p.label}
                <ChevronRight
                  size={16}
                  className="ml-auto hidden text-muted-foreground max-[760px]:block"
                />
              </a>
            );
          })}
        </nav>
        <Keepsake />
      </div>
      <div className={cn('grid min-w-0 gap-6', !chosen && 'max-[760px]:hidden')}>
        <div className="mb-4 hidden items-center gap-3 max-[760px]:flex">
          <a
            href={settingsPath()}
            className="grid size-[38px] place-items-center"
            aria-label="Back to settings"
            onClick={(e) => linkClick(e, settingsPath())}
          >
            <ArrowLeft size={20} />
          </a>
          <span className="text-lg font-medium">{current.label}</span>
        </div>
        <Page />
      </div>
    </div>
  );
}
