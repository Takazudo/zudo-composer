import { cleanup, render, screen } from '@testing-library/preact';
import { IDBFactory as FDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
  });

  it.each([
    ['/composer', 'Composition library'],
    ['/content', 'Content authoring'],
    ['/mapping', 'Mapping library'],
    ['/sitemapper', 'Sitemaps'],
  ])('mounts the real product on direct refresh at %s', async (route, heading) => {
    vi.stubGlobal('indexedDB', new FDBFactory());
    window.history.replaceState(null, '', route);
    render(<App />);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(nav.querySelectorAll('a')).toHaveLength(4);
    expect(screen.getByRole('link', { name: heading === 'Composition library' ? 'Composer' : heading === 'Content authoring' ? 'Content' : heading === 'Mapping library' ? 'Mapping' : 'Sitemapper' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the same-origin preview on its isolated entry graph', () => {
    const main = readFileSync(resolve('src/main.tsx'), 'utf8');
    const previewBranch = main.indexOf('window.location.pathname === "/composer/preview"');
    const bootstrap = main.indexOf('bootstrapTheme()');
    const previewImport = main.indexOf('import("./features/composer/preview/preview-entry")');
    const hostStyle = main.indexOf('import("./style.css")');
    const hostApp = main.indexOf('import("./App")');
    expect(bootstrap).toBeGreaterThan(-1);
    expect(bootstrap).toBeLessThan(previewBranch);
    expect(previewBranch).toBeLessThan(previewImport);
    expect(previewImport).toBeLessThan(hostStyle);
    expect(hostStyle).toBeLessThan(hostApp);
    expect(main).not.toMatch(/^import .*\.\/App/m);
  });

  it('identifies the standalone composer shell', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /build structures/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Composer' })).toHaveAttribute('href', '/composer');
  });

  it('mounts the real Sitemapper with its host-injected Composer catalog', async () => {
    window.history.replaceState(null, '', '/sitemapper');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sitemaps' })).toBeInTheDocument();
    expect(screen.queryByText(/being connected/i)).not.toBeInTheDocument();
  });
});
