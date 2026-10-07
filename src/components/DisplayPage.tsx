import {
  ArrowDown,
  ArrowUp,
  LayoutGrid,
  Lock,
  Minus,
  Monitor,
  Moon,
  Plus,
  Sun,
} from 'lucide-react';
import { BAR_MAX, addToBar, barTabs, move, moreTabs, removeFromBar } from '../lib/navigation.ts';
import type { Tab } from '../lib/routes.ts';
import type { ThemePref } from '../state/theme.ts';
import { useApp } from '../state/AppContext.tsx';
import { TAB_ICONS } from './navIcons.ts';
import { SettingsCard } from './settings/SettingsCard.tsx';
import { Button } from './ui/button.tsx';
import { Segmented } from './ui/segmented.tsx';

const THEMES: [ThemePref, string, typeof Sun][] = [
  ['system', 'Match device', Monitor],
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
];

function Row({ tab, children }: { tab: Tab; children?: React.ReactNode }) {
  const Icon = TAB_ICONS[tab];
  return (
    <li className="flex items-center gap-3 rounded-[11px] border border-border px-3.5 py-[11px] text-[13px]">
      <Icon size={19} />
      <span>{tab}</span>
      <span className="ml-auto flex items-center gap-1">{children}</span>
    </li>
  );
}

const ICON_BUTTON =
  'grid size-[30px] place-items-center rounded-lg border border-border transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-35';
const HEAD = 'mb-2 mt-[18px] flex justify-between gap-3 text-[11px] text-muted-foreground';

export function DisplayPage() {
  const { setCustomizing, setTabBar, setThemePref, tabBar, themePref } = useApp();
  const inBar = barTabs(tabBar);
  const side = moreTabs(tabBar);
  const full = inBar.length >= BAR_MAX;
  return (
    <>
      <SettingsCard
        title="Appearance"
        description="Light or dark, or match your device. Remembered on this device only."
      >
        <Segmented
          label="Appearance"
          options={THEMES.map(([v]) => v)}
          value={themePref}
          onChange={setThemePref}
          render={(v) => {
            const [, label, Icon] = THEMES.find(([k]) => k === v)!;
            return (
              <>
                <Icon size={15} /> {label}
              </>
            );
          }}
        />
      </SettingsCard>
      <SettingsCard
        title="Home"
        description="Choose which cards Home shows and in what order. Saved on this device only."
      >
        <Button variant="outline" onClick={() => setCustomizing(true)}>
          <LayoutGrid size={15} />
          Customize Home
        </Button>
      </SettingsCard>
      <SettingsCard
        title="Edit navigation"
        description="Choose the pages in the bar at the bottom of your phone. Everything else is under More. The top bar on a computer always shows every page. Saved on this device only."
      >
        <div className={HEAD}>
          <span>Tab bar</span>
          <span>
            {inBar.length} of {BAR_MAX}
          </span>
        </div>
        <ul className="m-0 grid list-none gap-2 p-0">
          <Row tab="Home">
            <span
              className="grid size-[30px] place-items-center text-muted-foreground"
              title="Home is always in the bar"
            >
              <Lock size={14} />
            </span>
          </Row>
          {tabBar.map((t, i) => (
            <Row key={t} tab={t}>
              <button
                className={ICON_BUTTON}
                aria-label={`Move ${t} earlier`}
                disabled={i === 0}
                onClick={() => setTabBar(move(tabBar, t, -1))}
              >
                <ArrowUp size={15} />
              </button>
              <button
                className={ICON_BUTTON}
                aria-label={`Move ${t} later`}
                disabled={i === tabBar.length - 1}
                onClick={() => setTabBar(move(tabBar, t, 1))}
              >
                <ArrowDown size={15} />
              </button>
              <button
                className={ICON_BUTTON}
                aria-label={`Remove ${t} from the tab bar`}
                onClick={() => setTabBar(removeFromBar(tabBar, t))}
              >
                <Minus size={15} />
              </button>
            </Row>
          ))}
        </ul>
        <div className={HEAD}>
          <span>More</span>
          {full && <span>The bar is full. Remove a page to add another.</span>}
        </div>
        <ul className="m-0 grid list-none gap-2 p-0">
          {side.length === 0 && (
            <li className="rounded-[11px] border border-border px-3.5 py-[11px] text-[13px] text-muted-foreground">
              Every page is in the tab bar.
            </li>
          )}
          {side.map((t) => (
            <Row key={t} tab={t}>
              {!full && (
                <button
                  className={ICON_BUTTON}
                  aria-label={`Add ${t} to the tab bar`}
                  onClick={() => setTabBar(addToBar(tabBar, t))}
                >
                  <Plus size={15} />
                </button>
              )}
            </Row>
          ))}
        </ul>
      </SettingsCard>
    </>
  );
}
