import { useState } from 'react';
import { versionLabel } from './Footer.tsx';
import { useApp } from '../state/AppContext.tsx';
import { Button } from './ui/button.tsx';
import { Card } from './ui/card.tsx';
import { Field } from './ui/form.tsx';
import { Input } from './ui/input.tsx';

export function LoginPage() {
  const { auth, signIn, version } = useApp();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(passphrase);
      setPassphrase('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <Card className="w-[min(420px,100%)] gap-4 p-9 text-left">
        <form className="grid gap-4" onSubmit={submit}>
          <img className="rounded-full" src="/icon-192.png" alt="" width="56" height="56" />
          <h1 className="m-0 font-serif text-[44px] font-normal leading-none tracking-[-0.01em]">
            money<span className="italic text-sage">rill</span>
          </h1>
          {auth.configured ? (
            <>
              <p className="m-0 text-sm text-muted-foreground">
                Enter your passphrase to continue.
              </p>
              <Field className="text-xs">
                Passphrase
                <Input
                  className="h-10"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  required
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </Field>
              {error && (
                <div
                  className="rounded-2xl bg-destructive/10 px-4 py-[13px] text-xs text-destructive"
                  role="alert"
                >
                  {error}
                </div>
              )}
              <Button disabled={busy || !passphrase}>{busy ? 'Checking…' : 'Sign in'}</Button>
            </>
          ) : (
            <>
              <p className="m-0 text-sm text-muted-foreground">
                No passphrase is set yet, so access from other devices is blocked.
              </p>
              <p className="m-0 text-sm text-muted-foreground">
                On the computer running the app, run{' '}
                <code className="rounded bg-muted px-1.5 py-0.5">
                  ./scripts/set-passphrase.sh production
                </code>
                , then reload this page.
              </p>
            </>
          )}
        </form>
      </Card>
      {version && (
        <p className="m-0 mt-3 text-center text-[11px] text-muted-foreground">
          {versionLabel(version)}
        </p>
      )}
    </div>
  );
}
