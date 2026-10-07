import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../api.ts';
import { useApp } from '../state/AppContext.tsx';
import type { Account, Holding } from '../types.ts';
import { Button } from './ui/button.tsx';
import { Input } from './ui/input.tsx';
import { Select } from './ui/select.tsx';
import { Fineprint } from './settings/SettingsCard.tsx';

const CLASSES = ['Equities', 'Bonds', 'Cash', 'Other'];
type Line = { symbol: string; name: string; asset_class: string; quantity: string; price: string };
const blank = (): Line => ({
  symbol: '',
  name: '',
  asset_class: 'Equities',
  quantity: '',
  price: '',
});
const valid = (l: Line) =>
  l.name.trim() !== '' && Number(l.quantity) > 0 && l.price.trim() !== '' && Number(l.price) >= 0;

/** The holdings you type in for an account the provider gives none for. Saved as a whole list. */
export function HoldingsEditor({
  account,
  current,
  onDone,
}: {
  account: Account;
  current: Holding[];
  onDone: () => void;
}) {
  const { action, busy } = useApp();
  const [lines, setLines] = useState<Line[]>(
    current.length
      ? current.map((h) => ({
          symbol: h.symbol,
          name: h.name,
          asset_class: h.asset_class,
          quantity: String(Number(h.quantity)),
          price: String(Number(h.price)),
        }))
      : [blank()],
  );
  const set = (i: number, patch: Partial<Line>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <form
      className="grid gap-3 border-t border-border p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void action(async () => {
          await api(
            '/accounts/' + encodeURIComponent(account.id) + '/holdings',
            { holdings: lines },
            'PUT',
          );
          onDone();
        }, 'Holdings saved');
      }}
    >
      <Fineprint>
        Typed-in holdings explain the balance until your bank supplies holdings, then they are
        replaced. They never change the balance.
      </Fineprint>
      {lines.map((l, i) => (
        <div
          key={i}
          className="grid grid-cols-[90px_minmax(0,1.6fr)_110px_100px_110px_40px] items-center gap-2 max-[760px]:grid-cols-2"
        >
          <Input
            aria-label={`Symbol ${i + 1}`}
            placeholder="Symbol"
            value={l.symbol}
            onChange={(e) => set(i, { symbol: e.target.value })}
          />
          <Input
            aria-label={`Name ${i + 1}`}
            placeholder="Name"
            value={l.name}
            onChange={(e) => set(i, { name: e.target.value })}
          />
          <Select
            aria-label={`Type ${i + 1}`}
            value={l.asset_class}
            onChange={(e) => set(i, { asset_class: e.target.value })}
          >
            {CLASSES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Input
            aria-label={`Shares ${i + 1}`}
            placeholder="Shares"
            type="number"
            step="any"
            min="0"
            value={l.quantity}
            onChange={(e) => set(i, { quantity: e.target.value })}
          />
          <Input
            aria-label={`Price ${i + 1}`}
            placeholder="Price"
            type="number"
            step="any"
            min="0"
            value={l.price}
            onChange={(e) => set(i, { price: e.target.value })}
          />
          <Button
            type="button"
            variant="outline"
            aria-label={`Remove holding ${i + 1}`}
            onClick={() => setLines(lines.filter((_, j) => j !== i))}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setLines([...lines, blank()])}>
          <Plus size={14} />
          Add holding
        </Button>
        <Button className="ml-auto" type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={busy || !lines.every(valid)}>Save holdings</Button>
      </div>
    </form>
  );
}
