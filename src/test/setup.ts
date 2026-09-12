import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/preact';
import { afterAll } from 'vitest';

// Use Preact's export so configuration reaches the same DOM instance as its queries;
// the root @testing-library/dom dependency can resolve to a separate instance.
// `findBy*` waits on Testing Library's own `asyncUtilTimeout`, which vitest's `testTimeout`
// does not govern — a 1s default gives up long before a slow assertion actually fails.
// Provider-backed views now read through real filesystem stores (fsync per commit) rather
// than in-memory IndexedDB, and under full-suite parallel load a first paint can take
// several seconds. Without this, those specs fail as "element never appeared" while the
// component is still legitimately mid-load.
configure({ asyncUtilTimeout: 15_000 });

// Preact hooks schedule a 100ms `afterPaint` fallback timer that calls `cancelAnimationFrame`.
// Under full-suite load the file's jsdom environment can be torn down before it fires, which
// surfaces as an unhandled "cancelAnimationFrame is not defined". Let it fire while jsdom lives.
afterAll(() => new Promise<void>((resolve) => setTimeout(resolve, 120)));
