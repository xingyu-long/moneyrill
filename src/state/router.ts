// The address bar is the source of truth for which page is shown: links push a history entry, Back and
// Forward (popstate) move between them, and a reload opens the same page.
import { useEffect, useState } from 'react';
import { DEFAULT_REPORT, tabPath, type Tab } from '../lib/routes.ts';

const EVENT = 'moneyrill:navigate';
const LAST_REPORT = 'moneyrill.reports.url';
const OLD_LAST_REPORT = 'stillwater.reports.url'; // the app's earlier name; still read so a saved page survives

const current = () => ({ path: location.pathname, search: location.search });

/** Go to a URL in this app. `replace` changes the current entry instead of adding one (no extra Back step). */
export function navigate(url: string, replace = false) {
  if (url === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  window.dispatchEvent(new Event(EVENT));
}

/** The current path and query, updated on every navigation. */
export function useLocation() {
  const [loc, setLoc] = useState(current);
  useEffect(() => {
    const update = () => setLoc(current());
    window.addEventListener('popstate', update);
    window.addEventListener(EVENT, update);
    // A navigation between the first render and this effect is not missed.
    update();
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return loc;
}

/** The reports a person can be on; Reports reopens on the one left, always over its default range (this year). */
const REPORT_PAGES = ['/reports/cash-flow', '/reports/spending', '/reports/income'];

/** Reports reopens on the report left on this device (like Private mode); other tabs have one page. */
export function hrefFor(tab: Tab) {
  if (tab !== 'Reports') return tabPath(tab);
  try {
    const saved = localStorage.getItem(LAST_REPORT) ?? localStorage.getItem(OLD_LAST_REPORT);
    // only the page: an older release also kept its date range and filters, which are not carried over
    const page = (saved ?? '').split('?')[0];
    return REPORT_PAGES.includes(page) ? page : DEFAULT_REPORT;
  } catch {
    return DEFAULT_REPORT;
  }
}

export function rememberReport(page: string) {
  try {
    localStorage.setItem(LAST_REPORT, page);
    localStorage.removeItem(OLD_LAST_REPORT);
    localStorage.removeItem('stillwater.reports'); // the first release kept its choices here
  } catch {
    // private browsing: the page just is not remembered
  }
}

/** A plain click on an in-app link navigates without a reload; a modified click (new tab, window) is left to the browser. */
export function linkClick(e: React.MouseEvent<HTMLAnchorElement>, url: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return false;
  e.preventDefault();
  navigate(url);
  return true;
}
