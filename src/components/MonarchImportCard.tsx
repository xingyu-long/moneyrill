import { useState } from 'react';
import { FileUp } from 'lucide-react';
import { api } from '../api.ts';
import { useApp } from '../state/AppContext.tsx';
import { Fineprint, SettingsCard } from './settings/SettingsCard.tsx';
import { Button, buttonVariants } from './ui/button.tsx';
import { Td, Th } from './ui/table.tsx';
import { cn } from '../lib/cn.ts';

type AccountLine = {
  label: string;
  rows: number;
  matched: string | null;
  skipped: string | null;
  toImport: number;
  toMerge: number;
  keptYours: number;
  leftOut: number;
  alreadyImported: number;
};
type Summary = {
  committed: boolean;
  applied?: { imported: number; merged: number; categoriesCreated: number };
  accounts: AccountLine[];
  newCategories: { name: string; rows: number; income: boolean }[];
  futureRows: number;
  unreadableRows: number;
  unreadableLines: number[];
  totals: {
    rows: number;
    notBankOrCard: number;
    toImport: number;
    toMerge: number;
    keptYours: number;
    leftOut: number;
    alreadyImported: number;
  };
};

const MAX_BYTES = 10 * 1024 * 1024;
const readText = (file: File): Promise<string> =>
  typeof file.text === 'function'
    ? file.text()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });

/** One-off import of a Monarch transactions export: bank and card accounts only, dry run first. */
export function MonarchImportCard() {
  const { setError } = useApp();
  const [csv, setCsv] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const reset = () => {
    setCsv(null);
    setSummary(null);
  };
  async function choose(file: File | undefined) {
    if (!file) return;
    setDone('');
    try {
      if (file.size > MAX_BYTES) throw new Error('The file is too large');
      const text = await readText(file);
      setBusy(true);
      setSummary(await api('/transactions/import-monarch', { csv: text, commit: false }));
      setCsv(text);
      setError('');
    } catch (e: any) {
      reset();
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!csv) return;
    setBusy(true);
    try {
      const r: Summary = await api('/transactions/import-monarch', { csv, commit: true });
      const a = r.applied!;
      setDone(
        `Added ${a.imported} transactions, filled in ${a.merged} from Monarch` +
          (a.categoriesCreated ? `, created ${a.categoriesCreated} categories` : '') +
          '.',
      );
      reset();
      setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const t = summary?.totals;
  const nothing = !!t && t.toImport + t.toMerge === 0;
  return (
    <SettingsCard
      icon={<FileUp />}
      title="Import from Monarch"
      description={
        <>
          Brings in older <strong>bank and card</strong> transactions from a Monarch export (Monarch
          → Settings → Data → Export transactions). Sync your accounts first: what Plaid already has
          is kept, and Monarch only adds older rows and fills in categories and notes you have not
          set yourself. You see a summary before anything is saved, and importing the same file
          again is safe.
        </>
      }
    >
      <label className={cn(buttonVariants({ variant: 'outline' }), 'cursor-pointer')}>
        Choose a Monarch CSV
        <input
          className="hidden"
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {done && <p className="m-0 mt-3.5 text-xs text-positive">{done}</p>}
      {summary && t && (
        <div className="mt-[22px] border-t border-border pt-[18px]" aria-label="Import summary">
          <h3 className="mb-2.5 mt-0 text-[15px]">This is what would happen</h3>
          <ul className="m-0 mb-3.5 pl-5 text-xs leading-[1.8]">
            <li>
              <strong>{t.toImport}</strong> older transactions would be added
            </li>
            <li>
              <strong>{t.toMerge}</strong> Plaid transactions would get Monarch's category or notes
            </li>
            {t.keptYours > 0 && (
              <li>
                {t.keptYours} match Plaid transactions that already have your own category and notes
                (left alone)
              </li>
            )}
            {t.alreadyImported > 0 && <li>{t.alreadyImported} were imported before</li>}
            {t.leftOut > 0 && (
              <li>
                {t.leftOut} fall inside Plaid's history without a match and are left out, to avoid
                duplicates
              </li>
            )}
            {t.notBankOrCard > 0 && (
              <li>
                {t.notBankOrCard} are for accounts that are not bank or card accounts here (skipped)
              </li>
            )}
            {summary.futureRows > 0 && (
              <li>{summary.futureRows} are dated in the future (skipped)</li>
            )}
            {summary.unreadableRows > 0 && (
              <li>
                {summary.unreadableRows} could not be read (lines{' '}
                {summary.unreadableLines.join(', ')}
                {summary.unreadableRows > summary.unreadableLines.length ? ', …' : ''})
              </li>
            )}
          </ul>
          {summary.newCategories.length > 0 && (
            <Fineprint>
              New categories, in the group "Imported from Monarch":{' '}
              {summary.newCategories.map((c) => `${c.name} (${c.rows})`).join(', ')}
            </Fineprint>
          )}
          <table className="mb-[18px] mt-3 w-full border-collapse text-[11px]">
            <thead>
              <tr>
                <Th className="text-left">Monarch account</Th>
                <Th className="text-left">Rows</Th>
                <Th className="text-left">Matched to</Th>
              </tr>
            </thead>
            <tbody>
              {summary.accounts.map((a) => (
                <tr key={a.label} className={a.skipped ? 'skipped text-muted-foreground' : ''}>
                  <Td className="px-2 py-[7px] text-left text-[11px]">{a.label}</Td>
                  <Td className="px-2 py-[7px] text-left text-[11px]">{a.rows}</Td>
                  <Td className="px-2 py-[7px] text-left text-[11px]">{a.matched ?? a.skipped}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end gap-2.5">
            <Button variant="outline" disabled={busy} onClick={reset}>
              Cancel
            </Button>
            <Button disabled={busy || nothing} onClick={() => void commit()}>
              Import {t.toImport + t.toMerge} changes
            </Button>
          </div>
          {nothing && <Fineprint>Nothing to import from this file.</Fineprint>}
        </div>
      )}
    </SettingsCard>
  );
}
