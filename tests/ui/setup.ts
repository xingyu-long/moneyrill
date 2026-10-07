import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Recharts measures its container with ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverStub;

// jsdom does not implement window scrolling; the app scrolls when the page changes.
window.scrollTo = () => {};

// Every test starts on the Accounts page: the address bar now decides which page is shown.
beforeEach(() => history.replaceState(null, '', '/accounts'));
afterEach(() => cleanup());
