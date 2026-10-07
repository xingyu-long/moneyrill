// Light or dark follows the device unless you pick one; the choice is kept on this device only.
export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'moneyrill.theme';

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* storage unavailable: follow the device */
  }
  return 'system';
}

export const resolveTheme = (pref: ThemePref): 'light' | 'dark' =>
  pref !== 'system'
    ? pref
    : window.matchMedia?.('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';

export function applyTheme(pref: ThemePref) {
  const theme = resolveTheme(pref);
  document.documentElement.dataset.theme = theme;
  // The browser bar takes the page colour, read from the theme so the two cannot drift apart.
  const page = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
  if (page) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', page);
}

export function saveThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* ignore */
  }
}
