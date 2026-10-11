import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReplayLink } from './ReplayLink';

describe('ReplayLink', () => {
  it('renders a filled teal button for a recorded game', () => {
    render(
      <ReplayLink
        availability={{ state: 'recorded', reason: null }}
        gameId="g1"
        returnHash="#/game/g1"
        variant="button"
      />,
    );
    const link = screen.getByRole('link', { name: 'Watch replay' });
    expect(link).toHaveTextContent('Watch replay');
    expect(link).toHaveAttribute('href', '#/replay/g1?return=%23%2Fgame%2Fg1');
    expect(link).toHaveAttribute('title', 'Watch replay');
    expect(link).toHaveClass('replay-link', 'replay-link-button', 'replay-link-recorded', 'replay-wide-only');
  });

  it('renders an outline variant with an explanatory tooltip for a reconstructed game', () => {
    render(
      <ReplayLink availability={{ state: 'reconstructed', reason: null }} gameId="g2" variant="icon" />,
    );
    const link = screen.getByRole('link', { name: 'Watch replay' });
    expect(link).toHaveAttribute('href', '#/replay/g2');
    expect(link).toHaveAttribute('title', 'Reconstructed from the event log (approximate board)');
    expect(link).toHaveClass('replay-link-icon', 'replay-link-reconstructed', 'replay-wide-only');
    expect(link).toHaveTextContent('');
  });

  it('treats a missing availability (older server) as reconstructed', () => {
    render(<ReplayLink gameId="g3" variant="icon" />);
    const link = screen.getByRole('link', { name: 'Watch replay' });
    expect(link).toHaveClass('replay-link-reconstructed', 'replay-wide-only');
    expect(link).toHaveAttribute('href', '#/replay/g3');
  });

  it('renders disabled with the reason as tooltip when unavailable', () => {
    render(
      <ReplayLink
        availability={{ state: 'unavailable', reason: 'no events' }}
        className="extra"
        gameId="g4"
        variant="icon"
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Watch replay' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'no events');
    expect(button).toHaveClass('replay-link-unavailable', 'replay-wide-only', 'extra');
  });
});
