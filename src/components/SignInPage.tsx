import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useApp } from '../state/AppContext.tsx';
import { NewPassphraseFields, passphraseReady } from './PassphraseFields.tsx';
import { SettingsCard } from './settings/SettingsCard.tsx';
import { Button } from './ui/button.tsx';
import { Field } from './ui/form.tsx';
import { Input } from './ui/input.tsx';

/**
 * The passphrase: change it while signed in, or, when the app is still open on this computer with none set,
 * choose the first one (the app then asks for it).
 */
export function SignInPage() {
  const { auth, setUp, changePassphrase } = useApp();
  const [current, setCurrent] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setDone(false);
    try {
      if (auth.configured) {
        await changePassphrase(current, passphrase);
        setDone(true);
      } else {
        await setUp(passphrase);
      }
      setCurrent('');
      setPassphrase('');
      setRepeat('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard
      icon={<KeyRound size={21} />}
      title={auth.configured ? 'Change passphrase' : 'Set a passphrase'}
      description={
        auth.configured
          ? 'Changing it signs every other device out. You stay signed in here.'
          : 'No passphrase is set, so anyone who can open the app sees your data. Choose one to require it on every device.'
      }
    >
      <form className="grid max-w-[420px] gap-4" onSubmit={submit}>
        {auth.configured && (
          <Field className="text-xs">
            Current passphrase
            <Input
              className="h-10"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
        )}
        <NewPassphraseFields
          passphrase={passphrase}
          repeat={repeat}
          onPassphrase={setPassphrase}
          onRepeat={setRepeat}
        />
        {error && (
          <div
            className="rounded-2xl bg-destructive/10 px-4 py-[13px] text-xs text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}
        {done && (
          <div className="rounded-2xl bg-accent px-4 py-[13px] text-xs text-positive" role="status">
            Passphrase changed. Other devices were signed out.
          </div>
        )}
        <Button
          className="justify-self-start"
          disabled={busy || !passphraseReady(passphrase, repeat) || (auth.configured && !current)}
        >
          {busy ? 'Saving…' : auth.configured ? 'Change passphrase' : 'Set passphrase'}
        </Button>
      </form>
    </SettingsCard>
  );
}
