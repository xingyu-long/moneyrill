import { useState } from 'react';
import { Tags } from 'lucide-react';
import { api } from '../api.ts';
import { useApp } from '../state/AppContext.tsx';
import { useCategories } from '../state/useCategories.ts';
import type { Category, CategoryGroup, CategoryType } from '../types.ts';
import { EmojiPicker } from './EmojiPicker.tsx';
import { Fineprint, SettingsCard } from './settings/SettingsCard.tsx';
import { Button, linkButton, mutedLinkButton } from './ui/button.tsx';
import { Dialog } from './ui/dialog.tsx';
import { Input } from './ui/input.tsx';
import { Select } from './ui/select.tsx';
import { cn } from '../lib/cn.ts';

const TYPES: { type: CategoryType; label: string }[] = [
  { type: 'income', label: 'Income' },
  { type: 'expense', label: 'Expenses' },
  { type: 'transfer', label: 'Transfers' },
];

type Editing =
  | { kind: 'category'; category: Category | null; group: CategoryGroup }
  | { kind: 'group'; group: CategoryGroup | null; type: CategoryType }
  | null;

function CategoryModal({
  category,
  group,
  groups,
  onDone,
  onClose,
}: {
  category: Category | null;
  group: CategoryGroup;
  groups: CategoryGroup[];
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const { setError } = useApp();
  const [name, setName] = useState(category?.name ?? '');
  const [emoji, setEmoji] = useState(category?.emoji ?? '');
  const [groupId, setGroupId] = useState(category?.group_id ?? group.id);
  const [picking, setPicking] = useState(false);
  const isFallback = category?.key === 'uncategorized';
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError('');
      await onDone();
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <Dialog title={category ? 'Edit Category' : 'Create Category'} onClose={onClose}>
      <form
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            category
              ? api('/categories/' + category.id, { name, emoji, group_id: groupId }, 'PATCH')
              : api('/categories', { name, emoji, group_id: groupId }),
          );
        }}
      >
        <div className="flex">
          <button
            type="button"
            className="w-[52px] rounded-l-[7px] border border-r-0 border-border bg-background text-[22px]"
            aria-label="Choose icon"
            aria-expanded={picking}
            onClick={() => setPicking(!picking)}
          >
            {emoji || '🙂'}
          </button>
          <Input
            className="h-[52px] flex-1 rounded-l-none text-sm"
            aria-label="Category name"
            placeholder="Category name"
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {picking && (
          <EmojiPicker
            onPick={(picked) => {
              setEmoji(picked);
              setPicking(false);
            }}
          />
        )}
        <label className="grid gap-2 text-xs">
          Group
          <Select
            className="h-9"
            value={groupId}
            onChange={(e) => setGroupId(Number(e.target.value))}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex justify-end gap-2.5">
          {category && (
            <Button
              type="button"
              variant="outline"
              disabled={isFallback}
              title={isFallback ? 'The fallback category cannot be deleted' : undefined}
              onClick={() => {
                const ok = window.confirm(
                  `Delete "${category.name}"? ${category.transaction_count} transactions will go back to their automatic category.`,
                );
                if (ok) void run(() => api('/categories/' + category.id, undefined, 'DELETE'));
              }}
            >
              Delete
            </Button>
          )}
          <Button disabled={!name.trim()}>Save</Button>
        </div>
      </form>
    </Dialog>
  );
}

function GroupModal({
  group,
  type,
  empty,
  onDone,
  onClose,
}: {
  group: CategoryGroup | null;
  type: CategoryType;
  empty: boolean;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const { setError } = useApp();
  const [name, setName] = useState(group?.name ?? '');
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError('');
      await onDone();
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <Dialog title={group ? 'Edit Group' : 'Create Group'} onClose={onClose}>
      <form
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            group
              ? api('/category-groups/' + group.id, { name }, 'PATCH')
              : api('/category-groups', { name, type }),
          );
        }}
      >
        <label className="grid gap-2 text-xs">
          Group name
          <Input
            className="h-9"
            aria-label="Group name"
            value={name}
            maxLength={40}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2.5">
          {group && (
            <Button
              type="button"
              variant="outline"
              disabled={!empty}
              title={empty ? undefined : 'Move or delete its categories first'}
              onClick={() => {
                if (window.confirm(`Delete the group "${group.name}"?`))
                  void run(() => api('/category-groups/' + group.id, undefined, 'DELETE'));
              }}
            >
              Delete group
            </Button>
          )}
          <Button disabled={!name.trim()}>Save</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function CategoriesCard() {
  const { categories, groups, error, reload } = useCategories();
  const [editing, setEditing] = useState<Editing>(null);
  return (
    <SettingsCard
      icon={<Tags />}
      title="Categories"
      description="Changes here apply everywhere in Moneyrill. Deleting a category sends its transactions back to their automatic category."
    >
      {error && <Fineprint>{error}</Fineprint>}
      {TYPES.map(({ type, label }) => (
        <div key={type} className="category-type mt-[26px]">
          <div className="mb-2.5 flex items-baseline justify-between">
            <h3 className="m-0 text-[17px] font-semibold">{label}</h3>
            <button
              className={linkButton}
              onClick={() => setEditing({ kind: 'group', group: null, type })}
            >
              Create group
            </button>
          </div>
          {groups
            .filter((g) => g.type === type)
            .map((g) => {
              const items = categories.filter((c) => c.group_id === g.id);
              return (
                <div
                  key={g.id}
                  className="mb-3.5 rounded-[10px] border border-border bg-muted/40 px-2.5 pb-2.5 pt-1.5"
                  role="group"
                  aria-label={g.name}
                >
                  <div className="mb-2 flex items-baseline gap-2.5 border-b border-border px-1.5 pb-3 pt-2.5">
                    <strong>{g.name}</strong>
                    <button
                      className={mutedLinkButton}
                      aria-label={`Edit group ${g.name}`}
                      onClick={() => setEditing({ kind: 'group', group: g, type })}
                    >
                      Edit
                    </button>
                  </div>
                  {items.map((c) => (
                    <button
                      key={c.id}
                      className="mb-1.5 flex w-full items-center gap-3 rounded-lg bg-card px-3.5 py-[13px] text-left text-[13px] transition-colors hover:bg-accent"
                      onClick={() => setEditing({ kind: 'category', category: c, group: g })}
                    >
                      <span className="w-[22px] text-center">{c.emoji || '·'}</span>
                      <span>{c.name}</span>
                      <small className="ml-auto text-[10px] text-muted-foreground">
                        {c.key === null && (
                          <em className="mr-3 not-italic tracking-wide">Custom</em>
                        )}
                        {c.transaction_count} used
                      </small>
                    </button>
                  ))}
                  <button
                    className={cn(mutedLinkButton, 'mt-1 px-1.5')}
                    onClick={() => setEditing({ kind: 'category', category: null, group: g })}
                  >
                    Create Category
                  </button>
                </div>
              );
            })}
        </div>
      ))}
      {editing?.kind === 'category' && (
        <CategoryModal
          category={editing.category}
          group={editing.group}
          groups={groups.filter((g) => g.type === editing.group.type)}
          onDone={reload}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === 'group' && (
        <GroupModal
          group={editing.group}
          type={editing.type}
          empty={!editing.group || !categories.some((c) => c.group_id === editing.group!.id)}
          onDone={reload}
          onClose={() => setEditing(null)}
        />
      )}
    </SettingsCard>
  );
}
