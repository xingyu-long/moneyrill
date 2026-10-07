// Which pages sit in the bar at the bottom of a phone. Home is always first; you choose the rest, and
// everything else is reached from "More". The top bar on a computer always lists every page.
import { TABS, type Tab } from './routes.ts';

/** Home plus up to four others. */
export const BAR_MAX = 5;
export const DEFAULT_BAR: Tab[] = ['Accounts', 'Investments', 'Transactions', 'Reports'];
export const BAR_KEY = 'moneyrill.tabbar';

/** The chosen pages after Home, or the default when nothing valid was saved. */
export function parseBar(raw: string | null): Tab[] {
  try {
    const list: unknown = raw === null ? null : JSON.parse(raw);
    if (
      Array.isArray(list) &&
      list.length <= BAR_MAX - 1 &&
      list.every((t) => TABS.includes(t as Tab) && t !== 'Home') &&
      new Set(list).size === list.length
    )
      return list as Tab[];
  } catch {
    /* damaged: use the default */
  }
  return DEFAULT_BAR;
}

/** Every page in the bar, in order. */
export const barTabs = (chosen: Tab[]): Tab[] => ['Home', ...chosen];

/** The pages that are not in the bar, in the top bar's order. */
export const moreTabs = (chosen: Tab[]): Tab[] =>
  TABS.filter((t) => t !== 'Home' && !chosen.includes(t));

export function move(chosen: Tab[], tab: Tab, by: -1 | 1): Tab[] {
  const i = chosen.indexOf(tab);
  const j = i + by;
  if (i < 0 || j < 0 || j >= chosen.length) return chosen;
  const next = [...chosen];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Add a page to the end of the bar; nothing happens when it is full or already there. */
export const addToBar = (chosen: Tab[], tab: Tab): Tab[] =>
  tab === 'Home' || chosen.includes(tab) || chosen.length >= BAR_MAX - 1
    ? chosen
    : [...chosen, tab];

export const removeFromBar = (chosen: Tab[], tab: Tab): Tab[] => chosen.filter((t) => t !== tab);
