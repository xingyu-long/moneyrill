import { api } from '../api.ts';
import { ArrowRight } from 'lucide-react';
import { useApp } from '../state/AppContext.tsx';
import { Button } from './ui/button.tsx';
import { Dialog } from './ui/dialog.tsx';
import { FORM, Field } from './ui/form.tsx';
import { Input } from './ui/input.tsx';
import { Select } from './ui/select.tsx';
import { Fineprint } from './settings/SettingsCard.tsx';

export function ManualAccountModal() {
  const { action, busy, manual, setDataset, setManual } = useApp();
  return (
    <>
      {manual && (
        <Dialog
          title="Add an account"
          eyebrow="OFFLINE ACCOUNT"
          closeLabel="Close add account"
          dismissable={false}
          onClose={() => setManual(false)}
        >
          <p className="mb-6 mt-0 text-xs text-muted-foreground">
            Track a balance yourself. No bank connection required.
          </p>
          <form
            className={FORM}
            onSubmit={(e) => {
              e.preventDefault();
              const b = Object.fromEntries(new FormData(e.currentTarget));
              void action(async () => {
                await api('/accounts', b);
                setManual(false);
                setDataset('connected');
              }, 'Account saved');
            }}
          >
            <Field>
              Account name
              <Input className="h-10" name="name" placeholder="e.g. Emergency savings" required />
            </Field>
            <Field>
              Institution
              <Input className="h-10" name="institution" placeholder="Bank or personal account" />
            </Field>
            <Field>
              Account type
              <Select className="h-10" name="kind">
                <option value="cash">Cash</option>
                <option value="investment">Investment</option>
                <option value="credit">Credit card</option>
                <option value="loan">Other debt</option>
              </Select>
            </Field>
            <Field>
              Current balance (USD)
              <Input
                className="h-10"
                name="balance"
                type="number"
                step="0.01"
                required
                placeholder="0.00"
              />
            </Field>
            <Fineprint>For cards and loans, enter a positive amount for money owed.</Fineprint>
            <Button disabled={busy}>
              Save account
              <ArrowRight size={16} />
            </Button>
          </form>
        </Dialog>
      )}
    </>
  );
}
