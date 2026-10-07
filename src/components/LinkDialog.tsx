import { api } from '../api.ts';
import { useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { Button } from './ui/button.tsx';
import { Dialog } from './ui/dialog.tsx';

export function LinkDialog({
  config,
  production,
  close,
  done,
  fail,
}: {
  config: any;
  production: boolean;
  close: () => void;
  done: () => void;
  fail: (s: string) => void;
}) {
  const [saving, setSaving] = useState(false),
    [resumed, setResumed] = useState(false);
  const { open, ready } = usePlaidLink({
    token: config.link_token,
    ...(config.receivedRedirectUri ? { receivedRedirectUri: config.receivedRedirectUri } : {}),
    onSuccess: async (public_token) => {
      setSaving(true);
      try {
        if (config.connectionId) await api('/sync', {});
        else await api('/exchange', { public_token, products: config.products });
        done();
      } catch (e: any) {
        fail('Connection could not be completed: ' + e.message);
      } finally {
        setSaving(false);
      }
    },
    onExit: (error) => {
      if (error) fail(error.error_message);
    },
  });
  useEffect(() => {
    if (ready && config.receivedRedirectUri && !resumed) {
      setResumed(true);
      open();
    }
  }, [ready, config.receivedRedirectUri, resumed, open]);
  return (
    <Dialog
      title={
        config.connectionId
          ? 'Reconnect institution'
          : production
            ? 'Connect an account'
            : 'Connect a sandbox account'
      }
      closeLabel="Close bank connection"
      dismissable={false}
      onClose={close}
    >
      <p className="mb-6 mt-0 text-xs text-muted-foreground">
        {config.connectionId ? (
          'Renew authorization for your existing connection.'
        ) : production ? (
          'Plaid will securely connect to your institution. Your bank credentials are not stored by this app.'
        ) : (
          <>
            Use fake credentials only. Usually{' '}
            <code className="rounded bg-muted px-1.5 py-0.5">user_good</code> /{' '}
            <code className="rounded bg-muted px-1.5 py-0.5">pass_good</code>. This will not create
            a Production Item.
          </>
        )}
      </p>
      <Button disabled={!ready || saving} onClick={() => open()}>
        {saving
          ? 'Saving connection…'
          : config.connectionId
            ? 'Continue reconnect'
            : production
              ? 'Open Plaid'
              : 'Open Plaid Sandbox'}
      </Button>
    </Dialog>
  );
}
