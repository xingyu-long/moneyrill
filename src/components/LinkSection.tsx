import { LinkDialog } from './LinkDialog.tsx';
import { useApp } from '../state/AppContext.tsx';

export function LinkSection() {
  const { link, load, production, setDataset, setError, setLink } = useApp();
  return (
    <>
      {link && (
        <LinkDialog
          production={production}
          config={link}
          close={() => {
            sessionStorage.removeItem('plaid-link');
            setLink(null);
          }}
          done={() => {
            sessionStorage.removeItem('plaid-link');
            window.history.replaceState(null, '', location.pathname);
            setLink(null);
            setDataset('connected');
            void load();
          }}
          fail={setError}
        />
      )}
    </>
  );
}
