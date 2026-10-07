import type { Account, Balance, Data } from '../types.ts';
import {
  aggregatePositions,
  allocate,
  buildHoldingRows,
  buildSecurityDetail,
  nextSort,
  sortPositions,
} from '../lib/holdings.ts';
import { api, ApiError } from '../api.ts';
import { balanceHistory } from '../lib/history.ts';
import {
  appearanceFlows,
  availableBenchmarks,
  performanceSeries,
  withBenchmarks,
  portfolioReturn,
  returnChart,
  returnStatus,
  type Flow,
} from '../lib/performance.ts';
import { delta, number, pct, setPrivateMode } from '../lib/format.ts';
import {
  lastBalanceDate,
  searchAccounts,
  summarizeNetWorth,
  visibleAccounts,
} from '../lib/accounts.ts';
import { startDate } from '../lib/periods.ts';
import { accountIdOf, isKnownPath, tabOf, tabPath, type Tab } from '../lib/routes.ts';
import { HOME_KEY, parseLayout, type HomeLayout } from '../lib/homeLayout.ts';
import { BAR_KEY, parseBar } from '../lib/navigation.ts';
import { hrefFor, navigate, useLocation } from './router.ts';
import { applyTheme, readThemePref, saveThemePref, type ThemePref } from './theme.ts';
import { useCallback, useEffect, useMemo, useState } from 'react';

const empty: Data = {
  accounts: [],
  balances: [],
  holdings: [],
  benchmarks: [],
  connections: [],
  runs: [],
  hasSandboxKeys: false,
  hasPlaidKeys: false,
  mode: 'sandbox',
};

export function useAppModel() {
  // The tab comes from the address bar, so Back, Forward, reload and bookmarks all work.
  const loc = useLocation();
  const tab: Tab = tabOf(loc.path);
  const accountId = tab === 'Accounts' ? accountIdOf(loc.path) : null;
  const setTab = useCallback((t: Tab) => navigate(hrefFor(t)), []);
  useEffect(() => {
    // An address that is not a page here (a typo, an old link) is replaced by Home.
    if (!isKnownPath(loc.path)) navigate(tabPath('Home'), true);
  }, [loc.path]);
  const [disconnecting, setDisconnecting] = useState<any>(null);
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [flowsFrom, setFlowsFrom] = useState<{
    from: string | null;
    auto: string | null;
    override: string | null;
  }>({ from: null, auto: null, override: null });
  const [data, setData] = useState<Data>(empty),
    [dataset, setDataset] = useState('simulated'),
    [period, setPeriod] = useState('1M'),
    [investmentPeriod, setInvestmentPeriod] = useState('YTD');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [search, setSearch] = useState(''),
    [collapsed, setCollapsed] = useState<Record<string, boolean>>({}),
    [sort, setSort] = useState('balance');
  const [openSecurity, setOpenSecurity] = useState<string | null>(null),
    [holdingSort, setHoldingSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({
      key: 'value',
      dir: 'desc',
    }),
    [view, setView] = useState('Market'),
    [allocation, setAllocation] = useState('asset'),
    [hiddenBenchmarks, setHiddenBenchmarks] = useState<string[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [picker, setPicker] = useState(false),
    [manual, setManual] = useState(false),
    [link, setLink] = useState<any>(null),
    [importFile, setImportFile] = useState<any>(null);
  // Private mode hides amounts (percentages stay). Remembered on this device only.
  const [privacy, setPrivacy] = useState(() => {
    let on = false;
    try {
      // 'stillwater.private' is the app's earlier name for this setting; still read so it survives
      on =
        (localStorage.getItem('moneyrill.private') ??
          localStorage.getItem('stillwater.private')) === '1';
    } catch {
      /* storage unavailable: start with amounts visible */
    }
    setPrivateMode(on);
    return on;
  });
  const togglePrivacy = () => {
    const next = !privacy;
    setPrivateMode(next); // before the re-render so every formatter sees it
    setPrivacy(next);
    try {
      localStorage.removeItem('stillwater.private');
      localStorage.setItem('moneyrill.private', next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  // The pages in the phone's bottom bar (after Home), kept on this device only.
  const [tabBar, setTabBarState] = useState<Tab[]>(() => {
    try {
      return parseBar(localStorage.getItem(BAR_KEY));
    } catch {
      return parseBar(null);
    }
  });
  const setTabBar = (next: Tab[]) => {
    setTabBarState(next);
    try {
      localStorage.setItem(BAR_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  // The Home page's modules, their order and the spending comparison, kept on this device only.
  const [homeLayout, setHomeLayoutState] = useState<HomeLayout>(() => {
    try {
      return parseLayout(localStorage.getItem(HOME_KEY));
    } catch {
      return parseLayout(null);
    }
  });
  const [customizing, setCustomizing] = useState(false);
  const setHomeLayout = (next: HomeLayout) => {
    setHomeLayoutState(next);
    try {
      localStorage.setItem(HOME_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const [themePref, setThemePref] = useState<ThemePref>(readThemePref);
  useEffect(() => {
    applyTheme(themePref);
    if (themePref !== 'system') return;
    const query = window.matchMedia?.('(prefers-color-scheme: light)');
    const follow = () => applyTheme('system');
    query?.addEventListener('change', follow);
    return () => query?.removeEventListener('change', follow);
  }, [themePref]);
  const cycleTheme = () => {
    const next: ThemePref =
      themePref === 'system' ? 'light' : themePref === 'light' ? 'dark' : 'system';
    saveThemePref(next);
    setThemePref(next);
  };
  const [version, setVersion] = useState<{ commit: string; builtAt: string | null } | null>(null);
  const [auth, setAuth] = useState({
    checked: false,
    required: false,
    configured: false,
    authenticated: false,
  });
  const production = data.mode === 'production';
  const environmentName = production ? 'Production' : 'Staging';
  const signedOut = () => setAuth((a) => ({ ...a, checked: true, authenticated: false }));
  async function loadFlows() {
    try {
      const r = await api('/investments/cash-flows');
      setFlows(
        Array.isArray(r.flows)
          ? r.flows.map((f: { date: string; amount: string }) => ({
              date: f.date,
              amount: Number(f.amount),
            }))
          : null,
      );
      setFlowsFrom({
        from: r.from ?? null,
        auto: r.auto_from ?? null,
        override: r.override ?? null,
      });
    } catch {
      // Without cash flows the chart falls back to plain value change.
      setFlows(null);
    }
  }
  /** Choose the first day cash flows are counted from, or null for the automatic one. */
  async function saveFlowsFrom(date: string | null) {
    try {
      await api('/investments/cash-flows-from', { date }, 'PUT');
      await loadFlows();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }
  async function load() {
    try {
      const d = await api('/overview');
      setData(d);
      setError('');
      await loadFlows();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) signedOut();
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  /** Ask whether sign-in is needed and whether we already have a session, then load the data. */
  async function checkAuth() {
    // Which build is running; also available before signing in.
    api('/health')
      .then((h) => setVersion(h?.version ?? null))
      .catch(() => {});
    try {
      const s = await api('/auth/status');
      setAuth({
        checked: true,
        required: !!s.required,
        configured: !!s.configured,
        authenticated: !!s.authenticated,
      });
      if (!s.required || s.authenticated) await load();
      else setLoading(false);
    } catch (e: any) {
      setError(e.message);
      setAuth((a) => ({ ...a, checked: true }));
      setLoading(false);
    }
  }
  async function signIn(passphrase: string) {
    await api('/auth/login', { passphrase });
    setLoading(true);
    await checkAuth();
  }
  async function signOut() {
    await api('/auth/logout', {});
    setData(empty);
    setAuth((a) => ({ ...a, authenticated: false }));
  }
  useEffect(() => {
    void checkAuth();
    if (new URLSearchParams(location.search).has('oauth_state_id')) {
      try {
        const saved = sessionStorage.getItem('plaid-link');
        if (saved) setLink({ ...JSON.parse(saved), receivedRedirectUri: location.href });
      } catch {
        setError('Unable to resume bank authorization. Please start Link again.');
      }
    }
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (link) sessionStorage.setItem('plaid-link', JSON.stringify(link));
  }, [link]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 6000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  async function action(fn: () => Promise<any>, success: string) {
    setBusy(true);
    try {
      const r = await fn();
      setToast(r?.message || success);
      await load();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) signedOut();
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const base = useMemo(
    () => visibleAccounts(data.accounts, production, dataset),
    [data.accounts, production, dataset],
  );
  const accounts = searchAccounts(base, search);
  const investments = useMemo(
    () => base.filter((a) => a.kind === 'investment' && a.included && a.currency === 'USD'),
    [base],
  );
  // No account picked means all of them; a pick that no longer exists is ignored.
  const picked = useMemo(
    () => selected.filter((id) => investments.some((a) => a.id === id)),
    [investments, selected],
  );
  const investmentAccounts = useMemo(
    () => (picked.length ? investments.filter((a) => picked.includes(a.id)) : investments),
    [investments, picked],
  );
  const included = accounts.filter((a) => a.included && a.currency === 'USD');
  const lastDate = lastBalanceDate(data.balances);
  const activePeriod = tab === 'Investments' ? investmentPeriod : period,
    start = startDate(lastDate, activePeriod);
  const byAccount = useMemo(() => {
    const m = new Map<string, Balance[]>();
    for (const b of data.balances) {
      if (!m.has(b.account_id)) m.set(b.account_id, []);
      m.get(b.account_id)!.push(b);
    }
    return m;
  }, [data.balances]);
  function history(list: Account[], from: string, signed: boolean) {
    return balanceHistory(list, data.balances, from, signed);
  }
  const importedSeries = data.netWorth ?? [];
  // Imported totals cover accounts this app cannot see, so they apply only to the unfiltered view.
  const chart =
      importedSeries.length > 0 && !search.trim() && accounts.length === base.length
        ? importedSeries
            .filter((d) => d.date >= start)
            .map((d) => ({ date: d.date, value: Number(d.net_worth), missing: 0 }))
        : history(included, start, true),
    investmentHistory = history(investmentAccounts, start, false);
  const { assets, liabilities, net } = summarizeNetWorth(included);
  const beginning = chart.length > 1 ? (chart[0]?.value ?? null) : null,
    netChange = delta(net, beginning),
    netPercent = pct(net, beginning);
  const portfolio = investmentAccounts.reduce((s, a) => s + (number(a.balance) || 0), 0),
    portfolioStart = investmentHistory.length > 1 ? (investmentHistory[0]?.value ?? null) : null;
  const unknown = included.filter((a) => a.balance === null).length;
  const holdings = useMemo(
    () =>
      // The investments tab lists what is held; a balance the holdings do not explain is left out (the account page shows it).
      buildHoldingRows(investmentAccounts, data.holdings, start, data.prices).filter(
        (h) => h.asset_class !== 'Unreported',
      ),
    [investmentAccounts, data.holdings, data.prices, start],
  );
  const positions = useMemo(
    () => sortPositions(aggregatePositions(holdings), holdingSort),
    [holdings, holdingSort],
  );
  function sortBy(key: string) {
    setHoldingSort((c) => nextSort(c, key));
  }
  const securityDetail = useMemo(
    () =>
      buildSecurityDetail(
        openSecurity,
        holdings,
        data.holdings,
        new Set(investmentAccounts.map((a) => a.id)),
        start,
        data.prices,
      ),
    [openSecurity, holdings, data.holdings, data.prices, start, investmentAccounts],
  );
  const allocations = useMemo(() => allocate(holdings, allocation), [holdings, allocation]);
  const negativeAllocation = allocations.some((a) => a.value < 0);
  const positiveAllocation = allocations.filter((a) => a.value > 0),
    allocationTotal = allocations.reduce((s, a) => s + a.value, 0);
  const benchmarkOptions = useMemo(
    () => availableBenchmarks(data.benchmarks, !production && dataset === 'simulated'),
    [data.benchmarks, production, dataset],
  );
  // Every benchmark with data is drawn; a click on its card hides it, another brings it back.
  const shownBenchmarks = benchmarkOptions.filter((o) => !hiddenBenchmarks.includes(o.symbol));
  const toggleBenchmark = (symbol: string) =>
    setHiddenBenchmarks((h) =>
      h.includes(symbol) ? h.filter((x) => x !== symbol) : [...h, symbol],
    );
  // The return needs the whole portfolio: a bank transfer to a brokerage cannot be assigned to one of its accounts.
  const wholePortfolio = investments.length > 0 && investmentAccounts.length === investments.length;
  const fullHistory = useMemo(
    () => balanceHistory(investmentAccounts, data.balances, '1900-01-01', false),
    [investmentAccounts, data.balances],
  );
  const returns = useMemo(
    () =>
      wholePortfolio && flows
        ? portfolioReturn(
            fullHistory,
            [...flows, ...appearanceFlows(investmentAccounts, data.balances)],
            start,
            flowsFrom.from,
          )
        : null,
    [wholePortfolio, flows, flowsFrom.from, fullHistory, investmentAccounts, data.balances, start],
  );
  const lastInvestmentDate = [...fullHistory].reverse().find((h) => h.value !== null)?.date ?? null;
  const returnReason = returnStatus({
    wholePortfolio,
    flowsLoaded: flows !== null,
    flowsFrom: flowsFrom.from,
    lastBalanceDate: lastInvestmentDate,
    result: returns,
  });
  const performance = returns
    ? withBenchmarks(
        returnChart(returns.points, []),
        data.benchmarks,
        benchmarkOptions.map((o) => o.symbol),
        returns.from,
      )
    : withBenchmarks(
        performanceSeries(investmentHistory, [], portfolioStart),
        data.benchmarks,
        benchmarkOptions.map((o) => o.symbol),
        investmentHistory[0]?.date || start,
      );
  return {
    data,
    setData,
    tab,
    setTab,
    dataset,
    setDataset,
    period,
    setPeriod,
    investmentPeriod,
    setInvestmentPeriod,
    loading,
    busy,
    error,
    setError,
    toast,
    search,
    setSearch,
    collapsed,
    setCollapsed,
    sort,
    setSort,
    openSecurity,
    setOpenSecurity,
    holdingSort,
    view,
    setView,
    allocation,
    setAllocation,
    benchmarkOptions,
    shownBenchmarks,
    toggleBenchmark,
    selected: picked,
    setSelected,
    picker,
    setPicker,
    accountId,
    manual,
    setManual,
    homeLayout,
    setHomeLayout,
    customizing,
    setCustomizing,
    link,
    setLink,
    importFile,
    setImportFile,
    disconnecting,
    setDisconnecting,
    production,
    privacy,
    togglePrivacy,
    themePref,
    setThemePref: (next: ThemePref) => {
      saveThemePref(next);
      setThemePref(next);
    },
    cycleTheme,
    tabBar,
    setTabBar,
    version,
    auth,
    signIn,
    signOut,
    environmentName,
    load,
    action,
    base,
    accounts,
    investments,
    investmentAccounts,
    included,
    lastDate,
    activePeriod,
    start,
    byAccount,
    history,
    chart,
    investmentHistory,
    assets,
    liabilities,
    net,
    beginning,
    netChange,
    netPercent,
    portfolio,
    portfolioStart,
    unknown,
    holdings,
    positions,
    sortBy,
    securityDetail,
    allocations,
    negativeAllocation,
    positiveAllocation,
    allocationTotal,
    performance,
    returns,
    returnReason,
    lastInvestmentDate,
    flowsFrom,
    saveFlowsFrom,
  };
}
