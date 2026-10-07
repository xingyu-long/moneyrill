import { z } from 'zod';

export const ACCOUNT_KINDS = ['cash', 'credit', 'investment', 'loan'] as const;

/** A number, or a numeric string such as "12.50". Used for balances, prices and quantities. */
const finiteLike = z.union([z.number(), z.string()]).refine((v) => Number.isFinite(Number(v)));
/** Same, but an empty string is not an amount (form fields). */
const requiredAmount = finiteLike.refine((v) => v !== '');
const optionalAmount = z.union([z.null(), finiteLike]).optional();

export const createAccountBody = z.object({
  name: z.string().refine((s) => s.trim().length > 0),
  institution: z.string().nullish(),
  kind: z.enum(ACCOUNT_KINDS),
  balance: requiredAmount,
});

export const manualBalance = requiredAmount;

export const HOLDING_CLASSES = ['Equities', 'Bonds', 'Cash', 'Other'] as const;
const holdingNumber = (min: 'positive' | 'zero') =>
  z
    .union([z.number(), z.string()])
    .refine(
      (v) => /^\d{1,14}(\.\d{1,8})?$/.test(String(v).trim()) && (min === 'zero' || Number(v) > 0),
    );

/** PUT /api/accounts/:id/holdings: the whole list of holdings typed in by hand for one account. */
export const manualHoldingsBody = z
  .object({
    holdings: z
      .array(
        z
          .object({
            symbol: z
              .string()
              .transform((v) => v.trim().toUpperCase())
              .pipe(z.string().max(12)),
            name: z
              .string()
              .transform((v) => v.trim())
              .pipe(z.string().min(1).max(80)),
            asset_class: z.enum(HOLDING_CLASSES),
            quantity: holdingNumber('positive'),
            price: holdingNumber('zero'),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const linkBody = z.object({ connectionId: z.string().optional() }).nullish();

// --- JSON archive (Settings → Download / Import) ---
export const archiveShape = z
  .object({
    version: z.literal(1),
    tables: z.object({ accounts: z.array(z.unknown()) }).passthrough(),
  })
  .passthrough();

export const archiveAccount = z
  .object({ id: z.string(), name: z.string().min(1), kind: z.enum(ACCOUNT_KINDS) })
  .passthrough();

export const archiveSecurity = z
  .object({
    id: z.string(),
    symbol: z.string().nullish(),
    name: z.string(),
    asset_class: z.string(),
  })
  .passthrough();

export const archiveBalance = z
  .object({
    account_id: z.string(),
    date: z.string().min(1),
    current_balance: z.union([z.null(), finiteLike]),
  })
  .passthrough();

export const archiveHolding = z
  .object({
    account_id: z.string(),
    security_id: z.string(),
    date: z.string().min(1),
    quantity: optionalAmount,
    price: optionalAmount,
    value: optionalAmount,
    cost_basis: optionalAmount,
  })
  .passthrough();

export const archiveBenchmark = z
  .object({
    symbol: z.string(),
    date: z.string().min(1),
    level: finiteLike,
    provenance: z.string(),
  })
  .passthrough();

// --- Transactions and categories ---
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
const tooFar = (v: string) => v > new Date(Date.now() + 366 * 86400000).toISOString().slice(0, 10);

/** PATCH /api/transactions/:id; only these three fields are editable. */
const moneyAmount = z
  .union([z.number(), z.string()])
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(String(v).trim()) && Number(v) > 0);
const shortText = (max: number) =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1).max(max));

/**
 * PATCH /api/transactions/:id. Everyone can change date, category and notes; a transaction you added
 * yourself can also change its name, amount (a positive amount with a direction) and account.
 */
export const updateTransactionBody = z
  .object({
    date: z.union([z.null(), isoDate.refine((v) => !tooFar(v))]).optional(),
    category_id: z.union([z.null(), z.number().int().positive()]).optional(),
    notes: z.string().max(2000).optional(),
    name: shortText(200).optional(),
    amount: moneyAmount.optional(),
    direction: z.enum(['in', 'out']).optional(),
    account_id: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined));

/** POST /api/transactions: a transaction you record by hand (RSU vest, 401(k) contribution, cash...). */
export const createTransactionBody = z
  .object({
    account_id: z.string().min(1).max(200),
    date: isoDate.refine((v) => !tooFar(v)),
    amount: moneyAmount,
    direction: z.enum(['in', 'out']),
    name: shortText(200),
    category_id: z.union([z.null(), z.number().int().positive()]).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const splitPart = z
  .object({
    amount: requiredAmount,
    category_id: z.union([z.null(), z.number().int().positive()]),
    notes: z.string().max(2000).default(''),
    // null or missing: the same date as the transaction
    date: z.union([z.null(), isoDate.refine((v) => !tooFar(v))]).optional(),
  })
  .strict();
/** PUT /api/transactions/:id/splits replaces all the parts at once. */
export const splitsBody = z.object({ splits: z.array(splitPart).min(2).max(20) }).strict();

/** POST /api/transactions/import-monarch: the CSV text, and whether to write (false = dry run). */
export const monarchImportBody = z
  .object({ csv: z.string().min(1).max(11_000_000), commit: z.boolean() })
  .strict();

/** "1,2,3" in a query string. */
const idList = z
  .string()
  .max(4000)
  .transform((s) => s.split(',').filter(Boolean).map(Number))
  .pipe(z.array(z.number().int().positive()).max(500));
const textList = z
  .string()
  .max(8000)
  .transform((s) => s.split(',').filter(Boolean))
  .pipe(z.array(z.string().min(1).max(200)).max(200));

export const transactionQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  account: z.string().min(1).max(200).optional(),
  accounts: textList.optional(),
  /** One merchant (the merchant name, else the statement text), compared ignoring case. */
  merchant: z.string().min(1).max(200).optional(),
  category: z.coerce.number().int().positive().optional(),
  categories: idList.optional(),
  /** Only transactions with a part that counts as income or as spending (Uncategorized by direction). */
  type: z.enum(['income', 'expense']).optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().max(300).optional(),
});

/** GET /api/reports/*: the same filters everywhere; dates are calendar days chosen by the browser. */
export const reportQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    accounts: textList.optional(),
    categories: idList.optional(),
    merchant: z.string().min(1).max(200).optional(),
    interval: z.enum(['day', 'month', 'quarter', 'year']).default('month'),
    type: z.enum(['income', 'expense']).default('expense'),
    breakdownFrom: isoDate.optional(),
    breakdownTo: isoDate.optional(),
    /** The browser's date: with no `to`, the chart runs to the current period instead of the last transaction. */
    today: isoDate.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to)
  .refine((q) => !q.breakdownFrom || !q.breakdownTo || q.breakdownFrom <= q.breakdownTo);

/** PUT /api/investments/cash-flows-from: the first day cash flows are counted from, or null for the automatic one. */
export const cashFlowsFromBody = z.object({
  // A day after the latest balance leaves no span to calculate, so a day more than tomorrow (a margin for time
  // zones) is refused.
  date: z.union([
    z.null(),
    isoDate.refine((v) => v <= new Date(Date.now() + 86400000).toISOString().slice(0, 10)),
  ]),
});

export const CATEGORY_TYPES = ['income', 'expense', 'transfer'] as const;
const trimmed = (max: number) =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1).max(max));
const emoji = z.string().max(16); // some emoji are several code points joined together
const id = z.number().int().positive();

export const createCategoryBody = z
  .object({ name: trimmed(60), group_id: id, emoji: emoji.optional() })
  .strict();
export const updateCategoryBody = z
  .object({ name: trimmed(60), group_id: id, emoji })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0);
export const createGroupBody = z
  .object({ name: trimmed(40), type: z.enum(CATEGORY_TYPES) })
  .strict();
export const updateGroupBody = z.object({ name: trimmed(40) }).strict();

/** Validate a value, or throw an Error carrying a user-facing message (the API returns it as a 400). */
export function ensure<T extends z.ZodType>(
  schema: T,
  value: unknown,
  message: string,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(message);
  return result.data;
}
