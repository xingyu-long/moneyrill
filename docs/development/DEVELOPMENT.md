# Developing Moneyrill

Code layout, checks and database migrations. How to contribute is in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Styling

Every page is styled with Tailwind CSS v4 and shadcn/ui-style components; there is no hand-written stylesheet. `src/app.css` loads Tailwind (its reset and utilities) and a few base rules; `src/theme.css` holds every colour as a CSS variable with a dark and a light value (add a colour there, in both). The shadcn colour names (`bg-card`, `text-muted-foreground`, `border-border`, `text-positive`, ...) point at those variables, so a colour is changed in one place. The building blocks are in `src/components/ui/` (card, button, badge, segmented, input, select, table, popover, dialog and drawer, form pieces); small phone-specific rules are `max-[760px]:` classes next to the markup. A few plain class names (`txn-day-head`, `holdings-card`, `env-strip`, ...) carry no styles; tests select on them.

## Development checks

```sh
npm run check      # format, lint, typecheck, server/unit tests and UI tests
npm run format     # fix formatting
npm run test:ui    # UI tests only (Vitest + React Testing Library)
```

`npm install` enables a pre-commit hook (`.githooks/pre-commit`) that runs `npm run check`; skip it only in an emergency with `git commit --no-verify`. GitHub Actions (`.github/workflows/ci.yml`) runs the same checks on every push, plus the migrations and API integration tests against a throwaway PostgreSQL service, and builds the Docker image. It never receives Plaid credentials.

## Database migrations

Schema changes are numbered SQL files in `server/db/migrations/` (`001_baseline.sql`, `002_add_thing.sql`, ...). On start-up each file that has not been applied runs once, inside a transaction, and is recorded in `schema_migrations` with a checksum. Rules:

- Never edit a migration that has been applied (the app refuses to start if its checksum changed); add a new numbered file instead.
- Keep migrations additive and backward compatible so `./scripts/rollback.sh` (image rollback) stays safe. Dropping or renaming a column needs a deliberate backup/restore plan.
- Test on staging first: `./scripts/deploy.sh staging`, then promote the same image.

## Source and checks

- `docs/specs/`: the specification of each feature, starting with `01-data-contract.md` (tested Plaid format notes)
- `server/index.ts` / `server/app.ts`: start-up and the Fastify app (security hook, error handler)
- `server/routes/`: HTTP endpoints, one file per area; `server/services/`: connections, sync, accounts, archive import/export, token encryption
- `server/db/`: pool, migrations (`migrations/NNN_name.sql`), queries, demo seed; `server/lib/`: config, math, logging
- `src/`: `App.tsx`, `state/` (model hook and context), `components/`, `lib/` (pure, unit-tested logic)

All saved views/manual updates work offline after installation. New syncs and Link need internet. Remote hosting, HTTPS and multi-user authentication are separate future features.

Plaid references: [update mode](https://plaid.com/docs/link/update-mode/), [Item removal](https://plaid.com/docs/api/items/#itemremove), [OAuth redirects](https://plaid.com/docs/link/oauth/).
