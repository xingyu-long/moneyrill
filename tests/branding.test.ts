import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('every icon the page and manifest point at exists in public/', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'));
  const hrefs = [...html.matchAll(/<link [^>]*href="\/([^"]+)"/g)].map((m) => m[1]);
  const icons = manifest.icons.map((i: { src: string }) => i.src.slice(1));
  assert.ok(hrefs.includes('favicon.ico') && hrefs.includes('apple-touch-icon.png'));
  for (const file of [...hrefs, ...icons, 'icon-192.png'])
    assert.ok(fs.existsSync(`public/${file}`), file);
});
