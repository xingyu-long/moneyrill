import { useApp } from '../state/AppContext.tsx';

/** e.g. "v c4ad6c8 · built Oct 3, 5:34 PM" */
export function versionLabel(v: { commit: string; builtAt: string | null }) {
  const built = v.builtAt
    ? new Date(v.builtAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
  return `v ${v.commit}${built ? ` · built ${built}` : ''}`;
}

export function Footer() {
  const { environmentName, version } = useApp();
  return (
    <>
      <footer className="mt-10 flex justify-between gap-[15px] border-t border-border pt-5 text-[10px] text-muted-foreground max-[760px]:leading-normal">
        <span className="font-medium">
          moneyrill<span className="text-positive">.</span>{' '}
          <span className="ml-[15px] font-normal">Your money. Your data.</span>
        </span>
        <span>
          Stored locally · USD · {environmentName}
          {version && <> · {versionLabel(version)}</>}
        </span>
      </footer>
    </>
  );
}
