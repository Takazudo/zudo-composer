import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('identifies the standalone composer shell', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /build structures/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Composer' })).toHaveAttribute('href', '/composer');
  });
});
