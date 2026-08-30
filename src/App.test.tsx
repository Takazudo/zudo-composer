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
    vi.unstubAllGlobals();
  });

  it.each([
    ['/composer', 'Composition library'],
    ['/content', 'Content authoring'],
    ['/mapping', 'Mapping library'],
    ['/sitemapper', 'Sitemaps'],
    ['/media', 'Media library'],
  ])('mounts the real product on direct refresh at %s', async (route, heading) => {
    vi.stubGlobal('indexedDB', new FDBFactory());
    window.history.replaceState(null, '', route);
    render(<App />);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(nav.querySelectorAll('a')).toHaveLength(6);
    expect(screen.getByRole('link', { name: heading === 'Composition library' ? 'Composer' : heading === 'Content authoring' ? 'Content' : heading === 'Mapping library' ? 'Mapping' : heading === 'Media library' ? 'Media' : 'Sitemapper' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the shared route vocabulary with descriptions and icon support on Home', () => {
    render(<App />);

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(nav.querySelectorAll('a')).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Choose a tool' })).toBeInTheDocument();
    expect(screen.getByText('Build reusable page structures from components.')).toBeInTheDocument();
    expect(screen.getByText('Connect Content fields to Composition slots.')).toBeInTheDocument();
    expect(document.querySelectorAll('.app-route-link svg')).toHaveLength(6);
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
    expect(screen.getByRole('menu', { name: 'Theme preference' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /System/ })).toHaveAttribute('aria-checked', 'true');

    const system = screen.getByRole('menuitemradio', { name: /System/ });
    fireEvent.keyDown(system, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemradio', { name: /Light/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: /Light/ }), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: /Dark/ }), { key: 'Enter' });
    expect(document.documentElement.dataset.themePreference).toBe('dark');
    expect(screen.queryByRole('menu', { name: 'Theme preference' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Theme: Dark' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu', { name: 'Theme preference' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Theme: Dark' }));
    fireEvent.keyDown(document, { key: 'Escape' });
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
});
