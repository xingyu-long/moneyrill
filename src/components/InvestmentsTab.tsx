import { AllocationCard } from './AllocationCard.tsx';
import { HoldingsTable } from './HoldingsTable.tsx';
import { PortfolioCard } from './PortfolioCard.tsx';
import { Empty } from './common.tsx';
import { Card } from './ui/card.tsx';
import { useApp } from '../state/AppContext.tsx';

export function InvestmentsTab() {
  const { investmentAccounts } = useApp();
  if (!investmentAccounts.length)
    return (
      <Card>
        <Empty text="Add an investment account or choose a different dataset." />
      </Card>
    );
  return (
    <>
      <PortfolioCard />
      <div className="mt-6 grid items-start gap-6 min-[1101px]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <AllocationCard />
        <HoldingsTable />
      </div>
    </>
  );
}
