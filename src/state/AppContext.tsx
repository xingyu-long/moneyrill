import { createContext, useContext } from 'react';
import type { useAppModel } from './useAppModel.ts';

export type AppModel = ReturnType<typeof useAppModel>;

export const AppContext = createContext<AppModel | null>(null);

export function useApp(): AppModel {
  const model = useContext(AppContext);
  if (!model) throw new Error('useApp must be used inside <AppContext.Provider>');
  return model;
}
