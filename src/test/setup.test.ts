import { getConfig } from '@testing-library/dom';
import { expect, it } from 'vitest';

it('applies the intended async query timeout to the query instance render.ts re-exports', () => {
  // Vitest has already run the real setup file; do not configure the instance here.
  expect(getConfig().asyncUtilTimeout).toBe(15_000);
});
