export type Close = { date: string; close: number };

/** The symbol Yahoo expects for a held ticker (BRK.B is BRK-B); null for anything that is not a plain ticker. */
export function yahooSymbol(symbol: string | null | undefined): string | null {
  const s = (symbol || '').trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(s) ? s.replace('.', '-') : null;
}

/**
 * Daily closes from a Yahoo Finance chart response, on the exchange's local trading day. Days without a close
 * are skipped. (The plain close, not the dividend-adjusted one: this is what a holding was worth that day.)
 */
export function parseYahooCloses(body: any, symbol: string): Close[] {
  const result = body?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);
  const timestamps: unknown = result.timestamp;
  const closes: unknown = result.indicators?.quote?.[0]?.close;
  const offset = Number(result.meta?.gmtoffset ?? 0);
  if (!Array.isArray(timestamps) || !Array.isArray(closes))
    throw new Error(`Unexpected chart format for ${symbol}`);
  const byDate = new Map<string, number>();
  timestamps.forEach((t, i) => {
    const close = closes[i];
    if (typeof t !== 'number' || typeof close !== 'number' || !(close > 0)) return;
    byDate.set(new Date((t + offset) * 1000).toISOString().slice(0, 10), close);
  });
  return [...byDate]
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
