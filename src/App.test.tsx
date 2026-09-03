import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { IDBFactory as FDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
    document.documentElement.removeAttribute('data-theme-preference');
    document.documentElement.removeAttribute('data-theme');
    window.localStorage.removeItem('zudo-composer-theme');
    window.localStorage.removeItem('zudo-composer-rail');
    vi.unstubAllGlobals();
  });

  it.each([
    ['/composer', 'Composition library', 'Compositions'],
    ['/content', 'Content authoring', 'Content'],
    ['/mapping', 'Mapping library', 'Mappings'],
    ['/sitemapper', 'Sitemaps', 'Sitemaps'],
    ['/media', 'Media library', 'Media'],
  ])('mounts the real product on direct refresh at %s', async (route, heading, railLabel) => {
    vi.stubGlobal('indexedDB', new FDBFactory());
    window.history.replaceState(null, '', route);
    render(<App />);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(nav.querySelectorAll('a')).toHaveLength(7);
    const current = nav.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(railLabel);
  });

  it('shows the shared route vocabulary with descriptions and icon support on Home', () => {
    render(<App />);

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(nav.querySelectorAll('a')).toHaveLength(7);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Choose a tool' })).toBeInTheDocument();
    expect(screen.getByText('Build reusable page structures from components.')).toBeInTheDocument();
    expect(screen.getByText('Connect Content fields to Composition slots.')).toBeInTheDocument();
    expect(document.querySelectorAll('.cms-rail__item svg')).toHaveLength(8);
  });

  it('keeps the production Media state truthful without probing a provider', () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    window.history.replaceState(null, '', '/media');
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Media library' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Media service not connected' })).toBeInTheDocument();
    expect(screen.getByText(/no development media service is connected/i)).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it('supports theme selection, keyboard movement, Escape, outside close, and focus return', () => {
    render(<App />);

    const trigger = screen.getByRole('button', { name: 'Theme: System' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Theme preference' });
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveFocus();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement.dataset.themePreference).toBe('dark');
    expect(screen.queryByRole('menu', { name: 'Theme preference' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Theme: Dark' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu', { name: 'Theme preference' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Theme: Dark' }));
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Theme preference' }), { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Theme preference' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toHaveFocus();
  });

  it('discloses truthful planned email notifications without collecting data or simulating delivery', () => {
    render(<App />);

    const trigger = screen.getByRole('button', { name: 'Notifications' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText('Planned')).toBeInTheDocument();
    expect(screen.getByText(/local browser app cannot send email/i)).toBeInTheDocument();
    expect(screen.getByText(/no address is collected/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Send email alerts' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Configure email delivery' })).toBeDisabled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('heading', { name: 'Choose a tool' }));
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
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

  it('dispatches Site outside the authoring Shell while preserving author navigation isolation', async () => {
    vi.stubGlobal('indexedDB', new FDBFactory());
    window.history.replaceState(null, '', '/site');
    const { container } = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Clear ideas, carefully shaped' })).toBeInTheDocument();
    expect(container.querySelector('.app-shell')).not.toBeInTheDocument();
    expect(container.querySelector('.cms-rail')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
  });
});
