import { api } from '../api.ts';
import { useApp } from '../state/AppContext.tsx';
import { Button } from './ui/button.tsx';
import { Dialog } from './ui/dialog.tsx';

export function ImportModal() {
  const { action, busy, importFile, setDataset, setImportFile } = useApp();
  return (
    <>
      {importFile && (
        <Dialog
          title="Import archive"
          closeLabel="Close import"
          dismissable={false}
          onClose={() => setImportFile(null)}
        >
          <p className="mb-4 mt-0 text-xs">
            {importFile.tables.accounts.length} accounts ·{' '}
            {importFile.tables.balance_snapshots?.length || 0} balance snapshots ·{' '}
            {importFile.tables.holding_snapshots?.length || 0} holdings snapshots
          </p>
          <p className="mb-6 mt-0 text-xs text-muted-foreground">
            These records will be merged with your accounts. Existing connections and data are
            preserved.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              action(async () => {
                const r = await api('/import', importFile);
                setImportFile(null);
                setDataset('connected');
                return r;
              }, 'Archive imported')
            }
          >
            Import these records
          </Button>
        </Dialog>
      )}
    </>
  );
}
