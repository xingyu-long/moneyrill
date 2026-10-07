import { useEffect, useLayoutEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { AppContext, useApp } from './state/AppContext.tsx';
import { useAppModel } from './state/useAppModel.ts';
import { Topbar } from './components/Topbar.tsx';
import { PageHeading } from './components/PageHeading.tsx';
import { ErrorAlert } from './components/ErrorAlert.tsx';
import { HomeTab } from './components/HomeTab.tsx';
import { AccountsTab } from './components/AccountsTab.tsx';
import { InvestmentsTab } from './components/InvestmentsTab.tsx';
import { TransactionsTab } from './components/TransactionsTab.tsx';
import { ReportsTab } from './components/ReportsTab.tsx';
import { SettingsTab } from './components/SettingsTab.tsx';
import { LoginPage } from './components/LoginPage.tsx';
import { Footer } from './components/Footer.tsx';
import { Toast } from './components/Toast.tsx';
import { SecurityDrawer } from './components/SecurityDrawer.tsx';
import { AccountPage } from './components/AccountPage.tsx';
import { CustomizeHome } from './components/CustomizeHome.tsx';
import { ManualAccountModal } from './components/ManualAccountModal.tsx';
import { ImportModal } from './components/ImportModal.tsx';
import { DisconnectModal } from './components/DisconnectModal.tsx';
import { LinkSection } from './components/LinkSection.tsx';
import { createScrollMemory } from './lib/scroll.ts';
import { useLocation } from './state/router.ts';

const scrollMemory = createScrollMemory();

function Loading() {
  return (
    <div className="flex items-center justify-center gap-3 p-20 text-muted-foreground">
      <RefreshCw className="animate-spin" />
      Loading your workspace…
    </div>
  );
}

function Shell() {
  const { accountId, loading, tab, auth, production } = useApp();
  // Tab titles tell the two environments apart when both are open.
  useEffect(() => {
    document.title = production ? 'Moneyrill' : 'Moneyrill · STAGING';
  }, [production]);
  // Each page keeps its own scroll position: record it while scrolling, restore it when the path changes.
  const { path } = useLocation();
  useEffect(() => {
    const onScroll = () => scrollMemory.save(location.pathname, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    window.scrollTo(0, scrollMemory.restoreFor(path));
  }, [path]);
  if (!auth.checked) return <Loading />;
  if (auth.required && !auth.authenticated) return <LoginPage />;
  return (
    <div className="flex min-h-screen flex-col max-[760px]:pb-[calc(110px+env(safe-area-inset-bottom))]">
      {/* Staging only: production shows no strip, so the real data is not marked with a colour bar. */}
      {!production && (
        <div
          className="env-strip staging fixed inset-x-0 top-0 z-[100] h-1 bg-clay"
          aria-hidden="true"
        />
      )}
      <Topbar />
      <main className="w-full">
        <div className="mx-auto max-w-[1700px] px-[38px] pb-5 pt-3.5 max-[1150px]:p-[25px] max-[760px]:px-4 max-[760px]:py-[22px] min-[1600px]:px-[55px]">
          {!accountId && <PageHeading />}
          <ErrorAlert />
          {loading ? (
            <Loading />
          ) : tab === 'Home' ? (
            <HomeTab />
          ) : tab === 'Accounts' ? (
            accountId ? (
              <AccountPage id={accountId} />
            ) : (
              <AccountsTab />
            )
          ) : tab === 'Investments' ? (
            <InvestmentsTab />
          ) : tab === 'Transactions' ? (
            <TransactionsTab />
          ) : tab === 'Reports' ? (
            <ReportsTab />
          ) : (
            <SettingsTab />
          )}
          <Footer />
        </div>
      </main>
      <Toast />
      <SecurityDrawer />
      <ManualAccountModal />
      <CustomizeHome />
      <ImportModal />
      <DisconnectModal />
      <LinkSection />
    </div>
  );
}

export default function App() {
  const model = useAppModel();
  return (
    <AppContext.Provider value={model}>
      <Shell />
    </AppContext.Provider>
  );
}
