# Logo sources

The Moneyrill mark (Zen): the net-worth line as a small stream (a rill) in sage `#5b7a62` on a cream tile `#fbfcf8`,
with the wordmark `money` + italic sage `rill` in Instrument Serif.

| Source                    | Used for                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `icon.svg`                | `public/icon-512.png`, `public/icon-192.png`, `public/apple-touch-icon.png` (full square, iOS rounds it) |
| `icon-small.svg`          | `public/favicon.ico` (16, 32, 48px) and `public/favicon-32.png`: the same mark with a heavier line       |
| `icon.svg` + the wordmark | `docs/logo.png` (light) and `docs/logo-dark.png` (dark), shown in the README                             |

The PNGs were rendered with a headless Chromium at the exact pixel size (no scaling of a large image), and the ICO
holds the three favicon sizes. Change the SVG first, then re-render every file so they stay identical.
