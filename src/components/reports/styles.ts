// Tailwind class sets shared by the reports and their popovers.

/** The panel a report popover opens: under its button on a computer, across the screen on a phone. */
export const PANEL =
  'absolute right-0 top-[calc(100%+6px)] z-50 grid max-w-[calc(100vw-32px)] rounded-[22px] bg-card shadow-2xl ring-1 ring-border max-[760px]:fixed max-[760px]:inset-x-3 max-[760px]:top-[70px] max-[760px]:w-auto';
export const PANEL_TITLE = 'px-4 pb-2 pt-3.5 font-semibold';
export const PANEL_BODY =
  'flex max-h-[60vh] min-h-[300px] max-[760px]:max-h-[68vh] max-[760px]:flex-col max-[760px]:overflow-y-auto';
export const PANEL_NAV =
  'flex w-[190px] flex-none flex-col gap-0.5 overflow-y-auto border-r border-border px-2 pb-2 max-[760px]:w-auto max-[760px]:flex-row max-[760px]:flex-wrap max-[760px]:border-b max-[760px]:border-r-0';
export const PANEL_PANE = 'grid min-w-0 flex-1 content-start gap-3.5 px-4 py-3.5 text-xs';
export const PANEL_FOOT = 'flex items-center gap-2 border-t border-border px-4 py-3';
export const HINT = 'm-0 text-xs text-muted-foreground';
export const FIELD = 'grid gap-1.5 text-xs font-semibold';

export const navButton = (on: boolean) =>
  `rounded-full px-3.5 py-2 text-left text-xs transition-colors hover:bg-accent ${
    on ? 'bg-accent text-positive' : 'text-foreground'
  }`;

/** A line of text inside a report card (an error, "Loading…", or "nothing here"). */
export const EMPTY = 'm-0 px-[18px] py-7 text-xs text-muted-foreground';

/** Two cards side by side on a computer (the list, then its summary), stacked on a phone. */
export const SPLIT =
  'grid items-start gap-3.5 min-[761px]:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)] [&>*]:mb-0';
