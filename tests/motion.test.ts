import test from 'node:test';
import assert from 'node:assert/strict';
import { motionAllowed } from '../src/lib/motion.ts';

const media = (matches: boolean) => ({ matchMedia: () => ({ matches }) });

test('charts animate only when the device allows motion', () => {
  assert.equal(motionAllowed(media(true)), true);
  assert.equal(motionAllowed(media(false)), false); // prefers reduced motion
});

test('without the setting there is no animation', () => {
  assert.equal(motionAllowed({}), false);
  assert.equal(motionAllowed(undefined), false);
});

test('it asks about the right preference', () => {
  let asked = '';
  motionAllowed({
    matchMedia: (q) => {
      asked = q;
      return { matches: true };
    },
  });
  assert.equal(asked, '(prefers-reduced-motion: no-preference)');
});
