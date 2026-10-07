## What and why

<!-- One or two sentences. Link the TODO item or the question this answers. -->

## Behaviour change

<!-- Before -> after for anything a user or the API can observe, or "none (refactor / docs)". -->

## How it was verified

- [ ] `npm run check` passes locally
- [ ] Passed the local gate and tried on staging (`./scripts/ship.sh --stage-only`): <what you clicked / saw>
- [ ] New or changed behaviour has tests
- [ ] README / TODO / docs updated if behaviour or commands changed; for a new feature or big change, the feature's spec in `docs/specs/` too (all docs in sync)

## Risk

- [ ] No database change, **or** additive numbered migration (rehearsed against a production copy by `deploy.sh`)
- [ ] No secrets, tokens or real financial data in the diff
- [ ] Nothing here changes what is exposed on the network or who can sign in (**or** it is called out below)

## Release notes

<!-- Anything the owner should know before promoting this to production. -->
