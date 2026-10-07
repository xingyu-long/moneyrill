import {
  ChartColumn,
  ChartNoAxesCombined,
  House,
  ReceiptText,
  Settings,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Tab } from '../lib/routes.ts';

export const TAB_ICONS: Record<Tab, LucideIcon> = {
  Home: House,
  Accounts: Wallet,
  Investments: ChartNoAxesCombined,
  Transactions: ReceiptText,
  Reports: ChartColumn,
  Settings,
};
