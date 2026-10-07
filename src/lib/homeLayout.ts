// Which modules the Home page shows and in what order. Kept on this device only (like the phone's tab bar).
import {
  COMPARE_MODES,
  DEFAULT_COMPARE,
  isCompareMode,
  type CompareMode,
} from './spendingCompare.ts';

export const HOME_KEY = 'moneyrill.home';

/** Every module that can be hidden or moved, in the default order. Net worth is the hero above them and always there. */
export const HOME_WIDGETS = [
  { id: 'month', label: 'This month' },
  { id: 'assets', label: 'Assets and debt' },
  { id: 'investments', label: 'Investments' },
  { id: 'categories', label: 'Where it went this month' },
  { id: 'transactions', label: 'Recent transactions' },
  { id: 'spending', label: 'Spending trend' },
  { id: 'accounts', label: 'Accounts' },
] as const;

export type WidgetId = (typeof HOME_WIDGETS)[number]['id'];
const IDS = HOME_WIDGETS.map((w) => w.id) as WidgetId[];
const isWidget = (v: unknown): v is WidgetId => IDS.includes(v as WidgetId);

export type HomeLayout = {
  /** All modules, shown or not, in display order. */
  order: WidgetId[];
  hidden: WidgetId[];
  /** What the Spending trend compares. */
  compare: CompareMode;
  /** The layout design this was saved under; a saved layout from an older design is not used. */
  v: typeof LAYOUT_VERSION;
};

/** 2: Home follows the Zen mockup (Spending and Accounts are off until chosen). */
export const LAYOUT_VERSION = 2;

export const DEFAULT_LAYOUT: HomeLayout = {
  order: IDS,
  hidden: ['spending', 'accounts'],
  compare: DEFAULT_COMPARE,
  v: LAYOUT_VERSION,
};

/**
 * The saved layout, repaired: unknown or repeated modules are dropped and modules added by a later release are
 * appended (shown), so an old or damaged value never hides or loses a module.
 */
export function parseLayout(raw: string | null): HomeLayout {
  try {
    const v: any = raw === null ? null : JSON.parse(raw);
    if (v && typeof v === 'object' && v.v === LAYOUT_VERSION && Array.isArray(v.order)) {
      const order = [...new Set((v.order as unknown[]).filter(isWidget))];
      for (const id of IDS) if (!order.includes(id)) order.push(id);
      const hidden = Array.isArray(v.hidden)
        ? [...new Set((v.hidden as unknown[]).filter(isWidget))]
        : [];
      return {
        order,
        hidden,
        compare: isCompareMode(v.compare) ? v.compare : DEFAULT_COMPARE,
        v: LAYOUT_VERSION,
      };
    }
  } catch {
    /* damaged: use the default */
  }
  return DEFAULT_LAYOUT;
}

/** The modules to show, in order. */
export const visibleWidgets = (l: HomeLayout) => l.order.filter((id) => !l.hidden.includes(id));

export const toggleWidget = (l: HomeLayout, id: WidgetId): HomeLayout => ({
  ...l,
  hidden: l.hidden.includes(id) ? l.hidden.filter((h) => h !== id) : [...l.hidden, id],
});

/** Put `id` where `target` is (dragging a row onto another); anything unknown changes nothing. */
export function moveWidget(l: HomeLayout, id: WidgetId, target: WidgetId): HomeLayout {
  const from = l.order.indexOf(id);
  const to = l.order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return l;
  const order = [...l.order];
  order.splice(from, 1);
  order.splice(to, 0, id);
  return { ...l, order };
}

/**
 * Where a dragged module lands: the position among the other modules, given the middle of each of them (top to
 * bottom) and where the pointer is. Dragging past several rows skips them all.
 */
export function dropIndex(otherMiddles: number[], pointerY: number): number {
  return otherMiddles.filter((m) => m < pointerY).length;
}

/** Move a module to a position (0 = first) among the others. */
export function moveWidgetTo(l: HomeLayout, id: WidgetId, index: number): HomeLayout {
  const from = l.order.indexOf(id);
  if (from < 0) return l;
  const others = l.order.filter((x) => x !== id);
  const at = Math.max(0, Math.min(index, others.length));
  if (at === from) return l;
  others.splice(at, 0, id);
  return { ...l, order: others };
}

/** One step up or down (the keyboard way to reorder). */
export function nudgeWidget(l: HomeLayout, id: WidgetId, by: -1 | 1): HomeLayout {
  const target = l.order[l.order.indexOf(id) + by];
  return target ? moveWidget(l, id, target) : l;
}

export const COMPARE_LABEL = Object.fromEntries(COMPARE_MODES) as Record<CompareMode, string>;
