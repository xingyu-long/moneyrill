import { useState } from 'react';
import { versionLabel } from './Footer.tsx';
import { useApp } from '../state/AppContext.tsx';
import { Button } from './ui/button.tsx';
import { Card } from './ui/card.tsx';
import { Field } from './ui/form.tsx';
import { Input } from './ui/input.tsx';

// Same minimum as the server (server/auth/passphrase.ts); the server checks it again.
const MIN_PASSPHRASE_LENGTH = 12;

export function LoginPage() {
  const { auth, signIn, setUp, version } = useApp();
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (auth.configured) await signIn(passphrase);
      else await setUp(passphrase, code);
      setPassphrase('');
      setRepeat('');
      setCode('');
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
                Welcome. Choose a passphrase to protect your money; you will use it to sign in from
                every device.
              </p>
              {auth.setupCode && (
                <div className="grid gap-1.5">
                  <Field className="text-xs">
                    Setup code
                    <Input
                      className="h-10"
                      autoComplete="off"
                      autoCapitalize="characters"
                      autoFocus
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </Field>
                  <p className="m-0 text-xs text-muted-foreground">
                    Shown on the computer running the app. To get a new one, run{' '}
                    <code className="rounded bg-muted px-1.5 py-0.5">./scripts/setup-code.sh</code>.
                  </p>
                </div>
              )}
              <div className="grid gap-1.5">
                <Field className="text-xs">
                  New passphrase
                  <Input
                    className="h-10"
                    type="password"
                    autoComplete="new-password"
                    autoFocus={!auth.setupCode}
                    required
                    minLength={MIN_PASSPHRASE_LENGTH}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                  />
                </Field>
                <p className="m-0 text-xs text-muted-foreground">
                  At least {MIN_PASSPHRASE_LENGTH} characters.
                </p>
              </div>
              <Field className="text-xs">
                Repeat the passphrase
                <Input
                  className="h-10"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                />
              </Field>
              {repeat && passphrase !== repeat && (
                <div className="text-xs text-destructive">The passphrases do not match.</div>
              )}
              {error && (
                <div
                  className="rounded-2xl bg-destructive/10 px-4 py-[13px] text-xs text-destructive"
                  role="alert"
                >
                  {error}
                </div>
              )}
              <Button
                disabled={
                  busy ||
                  passphrase.length < MIN_PASSPHRASE_LENGTH ||
                  passphrase !== repeat ||
                  (auth.setupCode && !code.trim())
                }
              >
                {busy ? 'Saving…' : 'Create passphrase'}
              </Button>
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
