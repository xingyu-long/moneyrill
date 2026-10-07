type MediaWindow = { matchMedia?: (query: string) => { matches: boolean } };

/**
 * Whether charts may animate: only when the device says motion is fine. Without the setting (an old browser, the
 * test environment) or when the person asked for reduced motion, charts are drawn at once.
 */
export function motionAllowed(
  win: MediaWindow | undefined = typeof window === 'undefined' ? undefined : window,
) {
  return win?.matchMedia?.('(prefers-reduced-motion: no-preference)').matches === true;
}

/** How long the portfolio line takes to draw from the start of the range to its end. */
export const DRAW_MS = 1400;
