import { useCallback, useMemo, useRef, useState } from 'react';
import { Filter, Search, X } from 'lucide-react';
import type { Category } from '../../types.ts';
import { useDismiss } from './useDismiss.ts';
import { Button } from '../ui/button.tsx';
import { cn } from '../../lib/cn.ts';
import {
  PANEL,
  PANEL_BODY,
  PANEL_FOOT,
  PANEL_NAV,
  PANEL_PANE,
  PANEL_TITLE,
  navButton,
} from './styles.ts';

export type ReportFilters = { categories: number[]; accounts: string[] };
export const NO_FILTERS: ReportFilters = { categories: [], accounts: [] };
export type AccountChoice = { id: string; label: string };

function Check({
  checked,
  indeterminate,
  label,
  onChange,
  indent = 0,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (on: boolean) => void;
  indent?: number;
}) {
  return (
    <label
      className="flex items-center gap-2 px-2 py-1.5 text-xs"
      style={{ paddingLeft: 8 + indent * 18 }}
    >
      <input
        type="checkbox"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate && !checked;
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

const TYPES = [
  { type: 'income', label: 'Income' },
  { type: 'expense', label: 'Expenses' },
] as const;

/** Pick categories and accounts. An empty choice means "everything"; picking everything is stored as that. */
export function FiltersPopover({
  filters,
  categories,
  accounts,
  onChange,
}: {
  filters: ReportFilters;
  categories: Category[];
  accounts: AccountChoice[];
  onChange: (f: ReportFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const [section, setSection] = useState<'categories' | 'accounts'>('categories');
  const [search, setSearch] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(box, open, close);
  // Transfers never count as income or spending, so filtering on them would show nothing.
  const usable = useMemo(() => categories.filter((c) => c.type !== 'transfer'), [categories]);
  const picked = new Set(draft.categories);
  const pickedAccounts = new Set(draft.accounts);
  const count = filters.categories.length + filters.accounts.length;
  const total = draft.categories.length + draft.accounts.length;
  const setCategories = (ids: number[], on: boolean) => {
    const next = new Set(draft.categories);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setDraft({ ...draft, categories: [...next] });
  };
  const needle = search.trim().toLowerCase();
  const groupsOf = (type: string) => {
    const map = new Map<string, Category[]>();
    for (const c of usable.filter((x) => x.type === type)) {
      if (needle && !c.name.toLowerCase().includes(needle)) continue;
      map.set(c.group_name, [...(map.get(c.group_name) ?? []), c]);
    }
    return [...map];
  };
  const visibleAccounts = accounts.filter((a) => !needle || a.label.toLowerCase().includes(needle));
  const byId = new Map(usable.map((c) => [c.id, c]));
  const apply = () => {
    onChange({
      categories: draft.categories.length === usable.length ? [] : draft.categories,
      accounts: draft.accounts.length === accounts.length ? [] : draft.accounts,
    });
    setOpen(false);
  };
  return (
    <div className="relative" ref={box}>
      <Button
        variant="outline"
        className={cn(count > 0 && 'border-positive text-positive')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            setDraft(filters);
            setSearch('');
          }
          setOpen(!open);
        }}
      >
        <Filter size={14} />
        Filters{count ? ` · ${count}` : ''}
      </Button>
      {open && (
        <div className={cn(PANEL, 'w-[860px]')} role="dialog" aria-label="Filters">
          <div className={PANEL_BODY}>
            <nav className={PANEL_NAV} aria-label="Filter type">
              <div className={PANEL_TITLE}>Filters</div>
              <button
                className={navButton(section === 'categories')}
                onClick={() => setSection('categories')}
              >
                Categories
              </button>
              <button
                className={navButton(section === 'accounts')}
                onClick={() => setSection('accounts')}
              >
                Accounts
              </button>
            </nav>
            <div
              className={cn(
                PANEL_PANE,
                'grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-r border-border max-[760px]:border-r-0',
              )}
            >
              <label className="flex items-center gap-2 text-muted-foreground">
                <Search size={14} />
                <input
                  className="w-full border-0 bg-transparent p-0 text-xs text-foreground outline-0"
                  type="search"
                  placeholder="Search…"
                  aria-label="Search filters"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="min-h-0 overflow-y-auto">
                {section === 'categories' ? (
                  <>
                    <Check
                      label="Select all"
                      checked={picked.size === usable.length && usable.length > 0}
                      indeterminate={picked.size > 0}
                      onChange={(on) =>
                        setDraft({ ...draft, categories: on ? usable.map((c) => c.id) : [] })
                      }
                    />
                    {TYPES.map(({ type, label }) => {
                      const groups = groupsOf(type);
                      if (!groups.length) return null;
                      return (
                        <div key={type}>
                          <div className="mx-2 mb-0.5 mt-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                            {label}
                          </div>
                          {groups.map(([group, list]) => {
                            const ids = list.map((c) => c.id);
                            const on = ids.filter((id) => picked.has(id)).length;
                            return (
                              <div key={group}>
                                <Check
                                  label={group}
                                  indent={1}
                                  checked={on === ids.length}
                                  indeterminate={on > 0}
                                  onChange={(v) => setCategories(ids, v)}
                                />
                                {list.map((c) => (
                                  <Check
                                    key={c.id}
                                    label={`${c.emoji} ${c.name}`}
                                    indent={2}
                                    checked={picked.has(c.id)}
                                    onChange={(v) => setCategories([c.id], v)}
                                  />
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <>
                    <Check
                      label="Select all"
                      checked={pickedAccounts.size === accounts.length && accounts.length > 0}
                      indeterminate={pickedAccounts.size > 0}
                      onChange={(on) =>
                        setDraft({ ...draft, accounts: on ? accounts.map((a) => a.id) : [] })
                      }
                    />
                    {visibleAccounts.map((a) => (
                      <Check
                        key={a.id}
                        label={a.label}
                        indent={1}
                        checked={pickedAccounts.has(a.id)}
                        onChange={(on) =>
                          setDraft({
                            ...draft,
                            accounts: on
                              ? [...draft.accounts, a.id]
                              : draft.accounts.filter((x) => x !== a.id),
                          })
                        }
                      />
                    ))}
                  </>
                )}
              </div>
            </div>
            <div className={PANEL_PANE}>
              <div className="text-[13px] font-semibold">
                {total} filter{total === 1 ? '' : 's'} selected
              </div>
              <div className="flex flex-wrap gap-1.5 overflow-y-auto">
                {draft.categories.map((id) => (
                  <button
                    key={'c' + id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px]"
                    aria-label={`Remove ${byId.get(id)?.name ?? 'category'}`}
                    onClick={() => setCategories([id], false)}
                  >
                    {byId.get(id)?.emoji} {byId.get(id)?.name} <X size={12} />
                  </button>
                ))}
                {draft.accounts.map((id) => (
                  <button
                    key={'a' + id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px]"
                    aria-label={`Remove ${accounts.find((a) => a.id === id)?.label ?? 'account'}`}
                    onClick={() =>
                      setDraft({ ...draft, accounts: draft.accounts.filter((x) => x !== id) })
                    }
                  >
                    {accounts.find((a) => a.id === id)?.label ?? id} <X size={12} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className={PANEL_FOOT}>
            <Button
              variant="outline"
              onClick={() => {
                onChange(NO_FILTERS);
                setOpen(false);
              }}
            >
              Clear
            </Button>
            <span className="flex-1" />
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button onClick={apply}>Apply</Button>
          </div>
        </div>
      )}
    </div>
  );
}
