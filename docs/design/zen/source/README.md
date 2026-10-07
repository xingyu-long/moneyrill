# Zen mockup sources

The HTML that drew the mockups in `docs/design/zen/`. Fake data only. Each file is self-contained apart from the
Google Fonts it loads for the preview (the app itself must bundle its fonts; see `docs/plans/zen-theme.md`).

Open a file in a browser with a hash to pick the page and theme:

- `laptop.html#home`, `#transactions`, `#accounts`, `#investments`, `#reports`, `#settings`; add `,dark` for Zen night
  (for example `laptop.html#reports,dark`). Best at 1440px wide.
- `mobile.html#1` (Home, Transactions, Transaction detail, Accounts) or `#2` (Investments, Reports, Category report,
  Settings); add `,dark`. Best at 1830px wide.

To render a PNG with a headless Chromium (for example the one Playwright installs):

```sh
chrome --headless --hide-scrollbars --force-device-scale-factor=2 --window-size=1440,1100 \
  --virtual-time-budget=5000 --screenshot=out.png "file://$PWD/laptop.html#home"
```

The published images were converted with `cwebp -q 86 -resize 1440 0` (laptop) and `-resize 1830 0` (phones).
