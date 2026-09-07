import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';

// `findBy*` waits on Testing Library's own `asyncUtilTimeout`, which vitest's `testTimeout`
// does not govern — a 1s default gives up long before a slow assertion actually fails.
// Provider-backed views now read through real filesystem stores (fsync per commit) rather
// than in-memory IndexedDB, and under full-suite parallel load a first paint can take
// several seconds. Without this, those specs fail as "element never appeared" while the
// component is still legitimately mid-load.
configure({ asyncUtilTimeout: 15_000 });
