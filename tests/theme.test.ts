import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Light and dark each get their own shades from src/theme.css. A colour written anywhere else shows up the same in
// both themes (and is the one that looks wrong), so colours live in the theme and nowhere else.
const SRC = path.resolve('src');
const sources = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? sources(path.join(dir, e.name))
        : /\.(ts|tsx)$/.test(e.name)
          ? [path.join(dir, e.name)]
          : [],
    );

const COLOUR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|\b(?:rgba?|hsla?)\(/;

test('no colour is written in a component, only in theme.css', () => {
  const found = sources(SRC).flatMap((file) =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ file: path.relative('.', file), line: i + 1, text: line.trim() }))
      .filter((l) => COLOUR.test(l.text)),
  );
  assert.deepEqual(found, [], 'use a variable from src/theme.css (or add one) instead of a colour');
});

const blocks = () => {
  const css = fs.readFileSync(path.join(SRC, 'theme.css'), 'utf8');
  const names = (selector: string) => {
    const start = css.indexOf(selector);
    assert.ok(start >= 0, `${selector} block is missing`);
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
    return [...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]).sort();
  };
  return { dark: names(':root {'), light: names(":root[data-theme='light']") };
};

test('light and dark define the same variables, so neither theme is left half done', () => {
  const { dark, light } = blocks();
  assert.ok(dark.length > 30);
  assert.deepEqual(light, dark);
});

test('every variable a component reads exists in the theme', () => {
  const { dark } = blocks();
  const defined = new Set([...dark, '--bar-cols', '--bar-order']); // the last two are set inline by the nav
  const css = ['app.css', 'theme.css'].map((f) => fs.readFileSync(path.join(SRC, f), 'utf8'));
  const all = [...sources(SRC).map((f) => fs.readFileSync(f, 'utf8')), ...css].join('\n');
  // variables Tailwind or the app.css @theme blocks define themselves (--color-*, --font-*, --shadow-*)
  const own = new Set(
    [...all.matchAll(/^\s*(--(?:color|font|shadow)-[\w-]+)\s*:/gm)].map((m) => m[1]),
  );
  // `var(--cat-${n})` is built at run time: its twelve names are checked on their own below
  const used = [...all.matchAll(/var\((--[\w-]*[\w])[,)]/g)].map((m) => m[1]);
  const missing = [...new Set(used)].filter((v) => !defined.has(v) && !own.has(v));
  assert.deepEqual(missing, []);
  for (let n = 1; n <= 12; n++) assert.ok(defined.has(`--cat-${n}`), `--cat-${n} is missing`);
});
