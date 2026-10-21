import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, ListFilter, Plus, X } from 'lucide-react';
import { api } from '../api.ts';
import { useApp } from '../state/AppContext.tsx';
import { useCategories } from '../state/useCategories.ts';
import {
  AMOUNT_OPS,
  TEXT_OPS,
  bodyOf,
  describeConditions,
  draftOf,
  emptyDraft,
  moved,
  type Draft,
  type Rule,
  type RulePreview,
} from '../lib/rules.ts';
import { groupCategories } from '../lib/transactions.ts';
import type { Category } from '../types.ts';
import { cn } from '../lib/cn.ts';
import { Fineprint, SettingsCard } from './settings/SettingsCard.tsx';
import { Amount } from './TransactionGroups.tsx';
import { Button } from './ui/button.tsx';
import { Dialog } from './ui/dialog.tsx';
import { Input } from './ui/input.tsx';
import { Select } from './ui/select.tsx';
import { Switch } from './ui/switch.tsx';

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

function CategorySelect({
  categories,
  value,
  onChange,
  label,
}: {
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
  label: string;
}) {
  return (
    <Select
      aria-label={label}
      className="h-9 w-full"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">Choose a category</option>
      {groupCategories(categories).map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** Chosen items as chips, with a select to add one more. */
function PickList<T extends string | number>({
  label,
  chosen,
  options,
  onChange,
}: {
  label: string;
  chosen: T[];
  options: { value: T; label: string; group?: string }[];
  onChange: (v: T[]) => void;
}) {
  const name = (v: T) => options.find((o) => o.value === v)?.label ?? String(v);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {chosen.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs"
          >
            {name(v)}
            <button
              type="button"
              aria-label={`Remove ${name(v)}`}
              onClick={() => onChange(chosen.filter((x) => x !== v))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <Select
        aria-label={label}
        className="h-9 w-full"
        value=""
        onChange={(e) => {
          const picked = options.find((o) => String(o.value) === e.target.value);
          if (picked && !chosen.includes(picked.value)) onChange([...chosen, picked.value]);
        }}
      >
        <option value="">Add…</option>
        {options
          .filter((o) => !chosen.includes(o.value))
          .map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
      </Select>
    </div>
  );
}

function Block({
  title,
  on,
  onToggle,
  children,
}: {
  title: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 rounded-[14px] bg-muted p-4">
      <div className="flex items-center justify-between text-xs font-medium">
        {title}
        <Switch aria-label={title} checked={on} onCheckedChange={onToggle} />
      </div>
      {on && children}
    </div>
  );
}

function TextBlock({
  title,
  on,
  op,
  values,
  set,
}: {
  title: string;
  on: boolean;
  op: string;
  values: string[];
  set: (patch: Partial<Draft>) => void;
} & { set: (patch: any) => void }) {
  const key = title === 'Merchant name' ? 'merchant' : 'statement';
  return (
    <Block title={title} on={on} onToggle={(v) => set({ [`${key}On`]: v })}>
      <Select
        aria-label={`${title} match`}
        className="h-9"
        value={op}
        onChange={(e) => set({ [`${key}Op`]: e.target.value })}
      >
        {TEXT_OPS.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </Select>
      {values.map((v, i) => (
        <div key={i} className="flex gap-2">
          <Input
            aria-label={`${title} text ${i + 1}`}
            value={v}
            maxLength={200}
            onChange={(e) =>
              set({ [`${key}Values`]: values.map((x, j) => (j === i ? e.target.value : x)) })
            }
          />
          {values.length > 1 && (
            <button
              type="button"
              aria-label="Remove text"
              onClick={() => set({ [`${key}Values`]: values.filter((_, j) => j !== i) })}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
      {values.length < 20 && (
        <button
          type="button"
          className="justify-self-start text-[11px] text-sage"
          onClick={() => set({ [`${key}Values`]: [...values, ''] })}
        >
          + Or another
        </button>
      )}
    </Block>
  );
}

function RuleEditor({
  rule,
  categories,
  onDone,
  onClose,
}: {
  rule: Rule | null;
  categories: Category[];
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const { data, setError } = useApp();
  const [draft, setDraft] = useState<Draft>(() => (rule ? draftOf(rule) : emptyDraft()));
  const [tab, setTab] = useState<'settings' | 'preview'>('settings');
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [apply, setApply] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const built = useMemo(() => bodyOf(draft), [draft]);
  const accounts = data.accounts.filter((a) => a.kind === 'cash' || a.kind === 'credit');

  const key = 'body' in built ? JSON.stringify(built.body) : null;
  useEffect(() => {
    if (!key) {
      setPreview(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api('/rules/preview', { ...JSON.parse(key), ...(rule ? { rule_id: rule.id } : {}) })
        .then((r) => live && setPreview(r))
        .catch(() => live && setPreview(null));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, rule]);

  async function save() {
    if (!('body' in built)) return;
    setSaving(true);
    try {
      const body = { ...built.body, apply };
      await (rule ? api('/rules/' + rule.id, body, 'PATCH') : api('/rules', body));
      setError('');
      await onDone();
      onClose();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }
  async function remove() {
    if (!rule) return;
    const revert = window.confirm(
      'Delete this rule. OK also puts the transactions it categorised back to their automatic category; Cancel keeps their categories.',
    );
    if (!window.confirm('Delete this rule?')) return;
    try {
      await api(`/rules/${rule.id}?revert=${revert}`, undefined, 'DELETE');
      setError('');
      await onDone();
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
  }
  const changes = preview?.total ?? 0;
  return (
    <Dialog title={rule ? 'Edit rule' : 'Create rule'} onClose={onClose} className="w-[780px]">
      <div role="tablist" className="mb-4 flex gap-5 border-b border-border text-xs">
        {(['settings', 'preview'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            className={cn(
              '-mb-px border-b-2 pb-2',
              tab === t ? 'border-sage text-sage' : 'border-transparent',
            )}
            onClick={() => setTab(t)}
          >
            {t === 'settings' ? 'Settings' : `Preview changes ${changes}`}
          </button>
        ))}
      </div>
      {tab === 'settings' ? (
        <div className="grid gap-5 min-[761px]:grid-cols-2">
          <div className="grid content-start gap-3">
            <strong className="text-xs">If transaction matches criteria…</strong>
            <TextBlock
              title="Merchant name"
              on={draft.merchantOn}
              op={draft.merchantOp}
              values={draft.merchantValues}
              set={set}
            />
            <TextBlock
              title="Original statement"
              on={draft.statementOn}
              op={draft.statementOp}
              values={draft.statementValues}
              set={set}
            />
            <Block title="Amount" on={draft.amountOn} onToggle={(v) => set({ amountOn: v })}>
              <div className="flex gap-2">
                <Select
                  aria-label="Debit or credit"
                  className="h-9 flex-1"
                  value={draft.direction}
                  onChange={(e) => set({ direction: e.target.value as Draft['direction'] })}
                >
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </Select>
                <Select
                  aria-label="Amount comparison"
                  className="h-9 flex-1"
                  value={draft.amountOp}
                  onChange={(e) => set({ amountOp: e.target.value as Draft['amountOp'] })}
                >
                  {AMOUNT_OPS.map((o) => (
                    <option key={o.op} value={o.op}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex gap-2">
                <Input
                  aria-label="Amount"
                  inputMode="decimal"
                  placeholder="$0.00"
                  value={draft.amount}
                  onChange={(e) => set({ amount: e.target.value })}
                />
                {draft.amountOp === 'between' && (
                  <Input
                    aria-label="Upper amount"
                    inputMode="decimal"
                    placeholder="$0.00"
                    value={draft.amount2}
                    onChange={(e) => set({ amount2: e.target.value })}
                  />
                )}
              </div>
            </Block>
            <Block
              title="Categories"
              on={draft.categoriesOn}
              onToggle={(v) => set({ categoriesOn: v })}
            >
              <PickList
                label="Add a category"
                chosen={draft.categories}
                options={categories.map((c) => ({ value: c.id, label: `${c.emoji} ${c.name}` }))}
                onChange={(categories) => set({ categories })}
              />
            </Block>
            <Block title="Accounts" on={draft.accountsOn} onToggle={(v) => set({ accountsOn: v })}>
              <PickList
                label="Add an account"
                chosen={draft.accounts}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: a.name + (a.mask ? ` ···${a.mask}` : ''),
                }))}
                onChange={(accounts) => set({ accounts })}
              />
            </Block>
          </div>
          <div className="grid content-start gap-3">
            <strong className="text-xs">Then apply these updates…</strong>
            <div className="grid gap-3 rounded-[14px] bg-muted p-4">
              <div className="text-xs font-medium">Update category</div>
              <CategorySelect
                label="Category to apply"
                categories={categories}
                value={draft.categoryId}
                onChange={(categoryId) => set({ categoryId })}
              />
            </div>
            <Fineprint>
              A rule never changes a transaction you categorised yourself, a split one or one you
              added. Rules run top to bottom; a later match wins.
            </Fineprint>
          </div>
        </div>
      ) : !preview ? (
        <p className="py-10 text-center text-xs text-muted-foreground">
          {'problem' in built ? built.problem : 'Loading…'}
        </p>
      ) : preview.total === 0 ? (
        <div className="py-10 text-center text-xs">
          <strong className="block text-sm">No changes</strong>
          This rule would not change any existing transaction.
        </div>
      ) : (
        <div className="grid gap-1 text-xs" aria-label="Changes">
          {preview.changes.map((c) => (
            <div
              key={c.id}
              className="grid grid-cols-[84px_1fr_auto_1.2fr] items-center gap-3 border-b border-border py-2"
            >
              <span className="text-muted-foreground">{c.date}</span>
              <span className="truncate">{c.merchant}</span>
              <Amount value={c.amount} />
              <span className="truncate">
                {c.from.emoji} {c.from.name} → {c.to.emoji} {c.to.name}
              </span>
            </div>
          ))}
          {preview.total > preview.changes.length && (
            <Fineprint>…and {preview.total - preview.changes.length} more.</Fineprint>
          )}
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />
          Update existing transactions
        </label>
        <span className="text-muted-foreground">
          {preview
            ? `${preview.matching} matching transaction${preview.matching === 1 ? '' : 's'}` +
              (preview.skipped.edited + preview.skipped.split
                ? ` · ${preview.skipped.edited + preview.skipped.split} skipped (yours or split)`
                : '')
            : 'problem' in built
              ? built.problem
              : ''}
        </span>
      </div>
      <div className="mt-4 flex justify-between">
        {rule ? (
          <Button type="button" variant="outline" onClick={() => void remove()}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" disabled={!('body' in built) || saving} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Dialog>
  );
}

export function RulesPage() {
  const { data, setError } = useApp();
  const { categories } = useCategories();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const reload = useCallback(async () => {
    try {
      setRules((await api('/rules')).rules);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
    setLoaded(true);
  }, [setError]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const names = {
    category: (id: number) => categories.find((c) => c.id === id)?.name ?? 'a deleted category',
    account: (id: string) => data.accounts.find((a) => a.id === id)?.name ?? 'an unknown account',
  };
  const lines = (r: Rule) => describeConditions(r.conditions, names);
  const shown = rules.filter(
    (r) =>
      !search.trim() ||
      [...lines(r), r.category.name].join(' ').toLowerCase().includes(search.trim().toLowerCase()),
  );
  async function move(from: number, to: number) {
    const next = moved(rules, from, to);
    if (next === rules) return;
    setRules(next);
    try {
      setRules((await api('/rules/order', { ids: next.map((r) => r.id) })).rules);
    } catch (e: any) {
      setError(e.message);
      await reload();
    }
  }
  return (
    <SettingsCard
      icon={<ListFilter />}
      title="Rules"
      description="Rules put transactions in the right category as they arrive. If several rules match, they apply in the order listed here (top to bottom) and the last match wins. Your own category choice always wins over a rule."
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <strong className="text-xs">
          {rules.length} rule{rules.length === 1 ? '' : 's'}
        </strong>
        <div className="flex gap-2">
          <Input
            aria-label="Search rules"
            placeholder="Search"
            className="w-44"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="button" onClick={() => setEditing('new')}>
            <Plus size={14} /> Create rule
          </Button>
        </div>
      </div>
      {loaded && !rules.length && (
        <Fineprint>
          No rules yet. Create one, or change a transaction&apos;s category and make a rule from it.
        </Fineprint>
      )}
      <ul className="m-0 grid list-none gap-3 p-0">
        {shown.map((r) => {
          const i = rules.indexOf(r);
          return (
            <li
              key={r.id}
              draggable={!search.trim()}
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragging !== null) void move(dragging, i);
                setDragging(null);
              }}
              className="grid gap-1"
            >
              <div className="flex items-stretch gap-2 rounded-[14px] bg-muted p-3 text-xs">
                <GripVertical
                  size={16}
                  className="mt-0.5 shrink-0 cursor-grab text-muted-foreground"
                  aria-hidden="true"
                />
                <button
                  type="button"
                  className="grid min-w-0 flex-1 gap-1 text-left"
                  aria-label={`Edit rule: ${lines(r).join(', ')}`}
                  onClick={() => setEditing(r)}
                >
                  {lines(r).map((l) => (
                    <span key={l}>
                      <span className="text-muted-foreground">If</span> {l}
                    </span>
                  ))}
                  <span>
                    <span className="text-muted-foreground">Recategorize to</span>{' '}
                    {r.category.emoji} {r.category.name}
                  </span>
                </button>
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={i === 0 || !!search.trim()}
                    onClick={() => void move(i, i - 1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={i === rules.length - 1 || !!search.trim()}
                    onClick={() => void move(i, i + 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
              </div>
              <Fineprint className="italic">
                {r.last_applied_at && r.last_applied_count !== null
                  ? `${r.last_applied_count} transaction${r.last_applied_count === 1 ? '' : 's'} updated · ${ago(r.last_applied_at)}`
                  : 'Not applied to existing transactions'}
              </Fineprint>
            </li>
          );
        })}
      </ul>
      {editing && (
        <RuleEditor
          rule={editing === 'new' ? null : editing}
          categories={categories}
          onDone={reload}
          onClose={() => setEditing(null)}
        />
      )}
    </SettingsCard>
  );
}
