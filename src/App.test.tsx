import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
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
