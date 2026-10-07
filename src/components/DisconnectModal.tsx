import { api } from '../api.ts';
import { useApp } from '../state/AppContext.tsx';
import { Button } from './ui/button.tsx';
import { Dialog } from './ui/dialog.tsx';

export function DisconnectModal() {
  const { action, busy, disconnecting, setDisconnecting } = useApp();
  return (
    <>
      {disconnecting && (
        <Dialog
          title={`Disconnect ${disconnecting.institution}?`}
          closeLabel="Cancel disconnect"
          dismissable={false}
          onClose={() => setDisconnecting(null)}
        >
          <p className="mb-6 mt-0 text-xs text-muted-foreground">
            This removes the Plaid connection and stops future syncs. Saved balances and history
            remain. Connecting again later can create a new Item.
          </p>
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={() => setDisconnecting(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                action(async () => {
                  const result = await api(
                    '/connections/' + encodeURIComponent(disconnecting.id) + '/disconnect',
                    {},
                  );
                  setDisconnecting(null);
                  return result;
                }, 'Disconnected')
              }
            >
              Disconnect institution
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
