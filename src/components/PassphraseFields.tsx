import { Field } from './ui/form.tsx';
import { Input } from './ui/input.tsx';

// Same minimum as the server (server/auth/passphrase.ts); the server checks it again.
export const MIN_PASSPHRASE_LENGTH = 12;

/** A new passphrase is good to send once it is long enough and typed twice the same. */
export const passphraseReady = (passphrase: string, repeat: string) =>
  passphrase.length >= MIN_PASSPHRASE_LENGTH && passphrase === repeat;

/** Choose a passphrase: the field, its length hint, and a repeat field. Used to create one and to change it. */
export function NewPassphraseFields({
  passphrase,
  repeat,
  onPassphrase,
  onRepeat,
  autoFocus,
}: {
  passphrase: string;
  repeat: string;
  onPassphrase: (value: string) => void;
  onRepeat: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <Field className="text-xs">
          New passphrase
          <Input
            className="h-10"
            type="password"
            autoComplete="new-password"
            autoFocus={autoFocus}
            required
            minLength={MIN_PASSPHRASE_LENGTH}
            value={passphrase}
            onChange={(e) => onPassphrase(e.target.value)}
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
          onChange={(e) => onRepeat(e.target.value)}
        />
      </Field>
      {repeat && passphrase !== repeat && (
        <div className="text-xs text-destructive">The passphrases do not match.</div>
      )}
    </>
  );
}
