import { useLayoutEffect, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { useApp } from '../state/AppContext.tsx';
import {
  HOME_WIDGETS,
  moveWidgetTo,
  dropIndex,
  nudgeWidget,
  toggleWidget,
  type WidgetId,
} from '../lib/homeLayout.ts';
import { Button } from './ui/button.tsx';
import { Dialog } from './ui/dialog.tsx';
import { Switch } from './ui/switch.tsx';
import { cn } from '../lib/cn.ts';

const LABEL = Object.fromEntries(HOME_WIDGETS.map((w) => [w.id, w.label])) as Record<
  WidgetId,
  string
>;

const calm = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The nearest ancestor that scrolls (the dialog body), so a drag near its edge can scroll it. */
function scroller(el: HTMLElement | null) {
  for (let n = el?.parentElement; n; n = n.parentElement)
    if (/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight)
      return n;
  return null;
}

/**
 * Dragging a row: it follows the pointer, the others glide out of the way, and the row lands wherever the pointer
 * is, however many rows that skips. Near the top or bottom edge the dialog scrolls.
 */
function useReorder(order: WidgetId[], open: boolean, move: (id: WidgetId, index: number) => void) {
  const list = useRef<HTMLUListElement>(null);
  const tops = useRef(new Map<string, number>());
  const held = useRef<{ id: WidgetId; grab: number; y: number } | null>(null);
  const raf = useRef(0);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const rows = () => [...(list.current?.children ?? [])] as HTMLElement[];

  // The held row sits under the pointer whatever slot it is in; offsetTop ignores transforms.
  const follow = () => {
    const h = held.current;
    const row = rows().find((r) => r.dataset.widget === h?.id);
    if (!h || !row || !list.current) return;
    const y = h.y - list.current.getBoundingClientRect().top - h.grab;
    row.style.transform = `translateY(${y - row.offsetTop}px) scale(1.02)`;
  };
  const place = () => {
    const h = held.current;
    if (!h || !list.current) return;
    const top = list.current.getBoundingClientRect().top;
    const middles = rows()
      .filter((r) => r.dataset.widget !== h.id)
      .map((r) => top + r.offsetTop + r.offsetHeight / 2);
    move(h.id, dropIndex(middles, h.y - h.grab + (rows()[0]?.offsetHeight ?? 0) / 2));
    follow();
  };

  useLayoutEffect(() => {
    for (const row of rows()) {
      const id = row.dataset.widget!;
      const top = row.offsetTop;
      const before = tops.current.get(id);
      if (
        id !== held.current?.id &&
        !calm() &&
        before !== undefined &&
        before !== top &&
        row.animate
      )
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], {
          duration: 180,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
        });
      tops.current.set(id, top);
    }
    follow();
    // follow only reads refs, so it is not a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, open]);

  const edge = () => {
    const h = held.current;
    const box = scroller(list.current)?.getBoundingClientRect();
    const s = scroller(list.current);
    if (h && s && box) {
      const dy = h.y < box.top + 40 ? -10 : h.y > box.bottom - 40 ? 10 : 0;
      if (dy) {
        s.scrollTop += dy;
        place();
      }
    }
    if (held.current) raf.current = requestAnimationFrame(edge);
  };

  const stop = () => {
    cancelAnimationFrame(raf.current);
    const row = rows().find((r) => r.dataset.widget === held.current?.id);
    if (row) {
      if (!calm() && row.animate)
        row.animate([{ transform: row.style.transform }, { transform: 'none' }], {
          duration: 150,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
        });
      row.style.transform = '';
    }
    held.current = null;
    setDragging(null);
  };

  return {
    list,
    dragging,
    grip: (id: WidgetId) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // dragging still works without capture while the pointer stays over the handle
        }
        const row = e.currentTarget.closest<HTMLElement>('[data-widget]')!;
        held.current = { id, grab: e.clientY - row.getBoundingClientRect().top, y: e.clientY };
        setDragging(id);
        raf.current = requestAnimationFrame(edge);
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        if (held.current?.id !== id) return;
        held.current.y = e.clientY;
        place();
      },
      onPointerUp: stop,
      onPointerCancel: stop,
    }),
  };
}

/** Choose which modules the Home page shows and drag them into the order you want (arrow keys work too). */
export function CustomizeHome() {
  const { customizing, homeLayout, setCustomizing, setHomeLayout } = useApp();
  const { list, dragging, grip } = useReorder(homeLayout.order, customizing, (id, index) =>
    setHomeLayout(moveWidgetTo(homeLayout, id, index)),
  );
  if (!customizing) return null;
  return (
    <Dialog
      title="Customize Home"
      closeLabel="Close customize"
      className="w-[560px]"
      onClose={() => setCustomizing(false)}
    >
      <p className="mb-5 mt-0 text-xs text-muted-foreground">
        Choose the modules you want on Home and drag them into the order you like. This is kept on
        this device.
      </p>
      <ul ref={list} className="relative m-0 grid list-none gap-2 p-0">
        {homeLayout.order.map((id) => {
          const shown = !homeLayout.hidden.includes(id);
          return (
            <li
              key={id}
              data-widget={id}
              className={cn(
                'flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-[13px]',
                dragging === id && 'relative z-10 border-primary shadow-lg',
              )}
            >
              <button
                type="button"
                aria-label={`Move ${LABEL[id]}`}
                title="Drag to reorder (touch or mouse), or use the up and down arrow keys"
                className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
                {...grip(id)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                  e.preventDefault();
                  setHomeLayout(nudgeWidget(homeLayout, id, e.key === 'ArrowUp' ? -1 : 1));
                }}
              >
                <GripVertical size={16} />
              </button>
              <span className="flex-1">{LABEL[id]}</span>
              <Switch
                aria-label={`Show ${LABEL[id]}`}
                checked={shown}
                onCheckedChange={() => setHomeLayout(toggleWidget(homeLayout, id))}
              />
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex justify-end">
        <Button onClick={() => setCustomizing(false)}>Done</Button>
      </div>
    </Dialog>
  );
}
