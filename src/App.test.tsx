import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { createTemporaryWorkspaceProviders, type TemporaryWorkspaceProviders } from './test/workspace-providers';
import { webcrypto } from 'node:crypto';
import { createEmptySiteProject, computeSiteProjectRevision } from './app/empty-site-project';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { createProductionProviderIntegration } from './app/provider-integration';

const hosts: TemporaryWorkspaceProviders[] = [];

/** One temporary host project per render, torn down with the test. */
async function renderApp() {
  const project = await createTemporaryWorkspaceProviders();
  hosts.push(project);
  const integration = createProductionProviderIntegration({ createProviders: project.createProviders, assetProvider: null });
  // Seeding writes real files, which is slower than the queries below wait for.
  // The workspace being ready is a precondition of these assertions, not one of
  // the things they are testing.
  await integration.initialization.initialize();
  return render(<App integration={integration} />);
}

/** The Dashboard heading follows the local clock, so match all three. */
const GREETING = /^Good (morning|afternoon|evening)\.$/;

describe('App', () => {
  afterEach(async () => {
    cleanup();
    await Promise.all(hosts.splice(0).map((value) => value.dispose()));
    window.history.replaceState(null, '', '/');
    document.documentElement.removeAttribute('data-theme-preference');
    document.documentElement.removeAttribute('data-theme');
    window.localStorage.removeItem('zudo-composer-theme');
    window.localStorage.removeItem('zudo-composer-rail');
    vi.unstubAllGlobals();
  });

  async function emptyHost() {
    const host = await createTemporaryWorkspaceProviders();
    hosts.push(host);
    vi.stubGlobal('crypto', webcrypto);
    const integration = createProductionProviderIntegration({ project: null, createProviders: host.createProviders, assetProvider: null });
    return { host, integration };
  }

  it('creates the first named workspace on an empty host and persists a writable sitemap', async () => {
    const { host, integration } = await emptyHost();
    window.history.replaceState(null, '', '/sitemapper');
    render(<App integration={integration} />);
    await screen.findByText(/No SiteProject is activated/);
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    const dialog = screen.getByRole('dialog', { name: 'Create project' });
    fireEvent.input(within(dialog).getByLabelText('Project name'), { target: { value: '  First site  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await screen.findByRole('heading', { name: 'Sitemaps' });
    const reopened = createProductionProviderIntegration({ project: null, createProviders: host.createProviders, assetProvider: null });
    const snapshot = await reopened.getCurrentSiteProject();
    expect(snapshot).toMatchObject({ status: 'ready', project: { name: 'First site' } });
    if (snapshot.status !== 'ready') throw snapshot.error;
    const sitemap = snapshot.project.providers.sitemaps[0]!.records[0]!;
    sitemap.document.name = 'Edited sitemap';
    await reopened.sitemapProvider.store.put(sitemap);
    expect(await reopened.getCurrentSiteProject()).toMatchObject({ status: 'ready', project: { providers: { sitemaps: [{ records: [{ document: { name: 'Edited sitemap' } }] }] } } });
  });

  it('validates the name and cancels without creating or mutating a workspace', async () => {
    const { host, integration } = await emptyHost();
    const create = vi.fn(integration.workspace.create);
    render(<App integration={{ ...integration, workspace: { ...integration.workspace, create } }} />);
    await screen.findByText(/No SiteProject is activated/);
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.input(within(dialog).getByLabelText('Project name'), { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    expect(within(dialog).getByText('Enter a project name.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    expect(await host.storage.list()).toEqual([]);
  });

  it('keeps failed creation in the dialog with its real message and blocks concurrent submits', async () => {
    const { integration } = await emptyHost();
    let reject!: (error: Error) => void;
    const create = vi.fn(() => new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise; }));
    render(<App integration={{ ...integration, workspace: { ...integration.workspace, create } }} />);
    await screen.findByText(/No SiteProject is activated/);
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.input(within(dialog).getByLabelText('Project name'), { target: { value: 'First site' } });
    const submit = within(dialog).getByRole('button', { name: 'Create project' });
    fireEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(submit);
    fireEvent.keyDown(within(dialog).getByLabelText('Project name'), { key: 'Enter' });
    expect(create).toHaveBeenCalledTimes(1);
    reject(new Error('Disk quota exhausted'));
    await within(dialog).findByText('Disk quota exhausted');
    expect(within(dialog).getByLabelText('Project name')).toHaveValue('First site');
    expect(submit).not.toBeDisabled();
  });

  it('distinguishes invalid source from storage failures and offers creation only for absent source', async () => {
    const { host } = await emptyHost();
    const invalid = createEmptySiteProject('Invalid');
    invalid.activeSitemap.recordId = 'missing';
    render(<App integration={createProductionProviderIntegration({ project: invalid, sourceRevision: '0'.repeat(64), createProviders: host.createProviders, assetProvider: null })} />);
    await screen.findByText('The activated SiteProject is invalid. Fix the configured source, then retry opening.');
    expect(screen.queryByRole('button', { name: 'Create project' })).not.toBeInTheDocument();
    cleanup();
    const { integration } = await emptyHost();
    const retry = vi.fn(integration.initialization.retry);
    render(<App integration={{ ...integration, initialization: { ...integration.initialization, initialize: async () => { throw new Error('Disk read denied'); }, retry } }} />);
    await screen.findByText(/The workspace could not be read or opened/);
    expect(screen.queryByRole('button', { name: 'Create project' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry opening' }));
    await screen.findByText(/No SiteProject is activated/);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps an explicitly activated source on the existing workspace path', async () => {
    const { host } = await emptyHost();
    const project = createEmptySiteProject('Activated');
    const integration = createProductionProviderIntegration({ project, sourceRevision: await computeSiteProjectRevision(project), createProviders: host.createProviders, assetProvider: null });
    render(<App integration={integration} />);
    await screen.findByRole('heading', { name: GREETING });
    expect(screen.queryByRole('button', { name: 'Create project' })).not.toBeInTheDocument();
    expect(await integration.getCurrentSiteProject()).toMatchObject({ status: 'ready', project: { name: 'Activated' } });
  });

  // Content is an editor rather than a library page since issue #169, so each
  // route names the landmark that proves the real product mounted rather than
  // assuming every one of them opens on a heading.
  it.each([
    ['/composer', 'heading', 'Compositions', 'Compositions'],
    ['/content', 'tree', 'Content', 'Content'],
    ['/mapping', 'heading', 'Mappings', 'Mappings'],
    ['/sitemapper', 'heading', 'Sitemaps', 'Sitemaps'],
    ['/media', 'heading', 'Media', 'Media'],
  ])('mounts the real product on direct refresh at %s', async (route, role, name, railLabel) => {
    window.history.replaceState(null, '', route);
    await renderApp();
    expect(await screen.findByRole(role, { name })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(nav.querySelectorAll('a[data-route]')).toHaveLength(8);
    const current = nav.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(railLabel);
  });

  it('renders the workspace Overview on Home after initialization', async () => {
    await renderApp();

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(nav.querySelectorAll('a[data-route]')).toHaveLength(8);
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { name: GREETING })).toBeInTheDocument();
    // The explainer stays available after the real workspace finishes opening.
    expect(screen.getByRole('region', { name: 'How the pieces connect' })).toBeInTheDocument();
    expect(document.querySelectorAll('.cms-rail__item svg')).toHaveLength(8);
  });

  it('keeps the production Media state truthful without probing a provider', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    window.history.replaceState(null, '', '/media');
    await renderApp();

    expect(await screen.findByRole('heading', { name: 'Media' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /new folder/i })).toBeDisabled();
    expect(request).not.toHaveBeenCalled();
  });

  it('supports theme selection, keyboard movement, Escape, outside close, and focus return', async () => {
    await renderApp();

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

  it('discloses truthful planned email notifications without collecting data or simulating delivery', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: GREETING });

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
    fireEvent.click(screen.getByRole('heading', { name: GREETING }));
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

  it('opens the standalone routes from the Overview quick actions', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: GREETING });

    // Built through `route-intents`, never a hand-rolled query string.
    expect(screen.getByRole('link', { name: 'New composition' })).toHaveAttribute('href', '/composer?new=1');
    expect(screen.getByRole('link', { name: 'New entry' })).toHaveAttribute('href', '/content');
  });

  it('mounts the real Sitemapper with its host-injected Composer catalog', async () => {
    window.history.replaceState(null, '', '/sitemapper');
    await renderApp();
    expect(await screen.findByRole('heading', { name: 'Sitemaps' })).toBeInTheDocument();
    expect(screen.queryByText(/being connected/i)).not.toBeInTheDocument();
  });

  it('dispatches Site outside the authoring Shell and never falls back to a draft without an active release', async () => {
    window.history.replaceState(null, '', '/site');
    const { container } = await renderApp();
    expect(await screen.findByRole('heading', { name: 'Site unavailable' })).toBeInTheDocument();
    expect(screen.getByText(/No activated local release/)).toBeInTheDocument();
    expect(container.querySelector('.app-shell')).not.toBeInTheDocument();
    expect(container.querySelector('.cms-rail')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).not.toBeInTheDocument();
  });
});
