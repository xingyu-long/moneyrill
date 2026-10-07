export const PERIODS = ['1M', '2M', '3M', '6M', 'YTD', '1Y', 'ALL'];

export function startDate(end: string, period: string) {
  const d = new Date(end + 'T12:00:00Z');
  if (period === 'ALL') return '1900-01-01';
  if (period === 'YTD') return `${d.getUTCFullYear()}-01-01`;
  d.setUTCMonth(
    d.getUTCMonth() -
      ({ '1M': 1, '2M': 2, '3M': 3, '6M': 6, '1Y': 12 } as Record<string, number>)[period] || 1,
  );
  return d.toISOString().slice(0, 10);
}
