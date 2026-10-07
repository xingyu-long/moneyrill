import { useState } from 'react';
import { EMOJI_TABS, searchEmojis } from '../lib/emojis.ts';
import { cn } from '../lib/cn.ts';
import { Input } from './ui/input.tsx';
import { Fineprint } from './settings/SettingsCard.tsx';

const EMOJI_BUTTON = 'rounded-md p-1.5 text-xl leading-none transition-colors hover:bg-accent';

/** A small popover grid; the text box accepts any emoji typed or pasted from the system picker. */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [tab, setTab] = useState(EMOJI_TABS[0].id);
  const [query, setQuery] = useState('');
  const shown = query.trim()
    ? searchEmojis(query)
    : (EMOJI_TABS.find((t) => t.id === tab) ?? EMOJI_TABS[0]).emojis;
  return (
    <div
      className="grid gap-2 rounded-[10px] border border-border bg-background p-2.5"
      role="group"
      aria-label="Choose an icon"
    >
      <Input
        type="search"
        placeholder="Search icons, or paste any emoji"
        aria-label="Search icons"
        value={query}
        onChange={(e) => {
          const value = e.target.value;
          setQuery(value);
          // Pasting or typing an emoji itself uses it directly.
          if (/\p{Extended_Pictographic}/u.test(value)) {
            onPick(value.trim());
            setQuery('');
          }
        }}
      />
      {!query.trim() && (
        <div className="flex gap-0.5 border-b border-border pb-1.5" role="tablist">
          {EMOJI_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              aria-label={t.label}
              title={t.label}
              className={cn(EMOJI_BUTTON, t.id === tab && 'bg-accent')}
              onClick={() => setTab(t.id)}
            >
              {t.icon}
            </button>
          ))}
        </div>
      )}
      <div className="grid max-h-[190px] grid-cols-8 gap-0.5 overflow-auto">
        {shown.map(([emoji, words]) => (
          <button
            key={emoji}
            className={EMOJI_BUTTON}
            type="button"
            title={words}
            aria-label={words || emoji}
            onClick={() => onPick(emoji)}
          >
            {emoji}
          </button>
        ))}
        {!shown.length && (
          <Fineprint className="col-span-full">No icons match. Paste any emoji instead.</Fineprint>
        )}
      </div>
    </div>
  );
}
