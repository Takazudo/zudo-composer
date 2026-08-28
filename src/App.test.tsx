import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('identifies the standalone composer shell', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'zudo-composer' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/standalone foundation/i)).toBeInTheDocument();
  });
});
