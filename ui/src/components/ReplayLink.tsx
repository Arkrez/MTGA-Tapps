import { Play } from 'lucide-react';
import type { ReplayAvailability } from '../api';
import { replayRouteHash } from '../routes';
import { RECONSTRUCTED_TITLE, replayState } from '../replayAvailability';

/**
 * Teal "watch this game" affordance. Teal is reserved for replay controls
 * across the dashboard; every instance is hidden below tablet width
 * (`.replay-wide-only`) because the replay renderer is not a phone feature.
 */
export function ReplayLink({
  gameId,
  availability,
  returnHash,
  variant,
  className,
  label: accessibleLabel,
}: {
  gameId: string;
  availability?: ReplayAvailability | null;
  returnHash?: string | null;
  variant: 'button' | 'icon';
  className?: string;
  /** Accessible name for the icon variant (defaults to "Watch replay"). */
  label?: string;
}) {
  const state = replayState(availability);
  const classes = [
    'replay-link',
    `replay-link-${variant}`,
    `replay-link-${state}`,
    'replay-wide-only',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const label = 'Watch replay';
  const iconLabel = accessibleLabel ?? label;
  const content = (
    <>
      <Play aria-hidden="true" className="replay-link-glyph" />
      {variant === 'button' ? <span>{label}</span> : null}
    </>
  );
  if (state === 'unavailable') {
    const title = availability?.reason ?? 'Replay unavailable';
    return (
      <button
        aria-label={variant === 'icon' ? iconLabel : undefined}
        className={classes}
        disabled
        title={title}
        type="button"
      >
        {content}
      </button>
    );
  }
  return (
    <a
      aria-label={variant === 'icon' ? iconLabel : undefined}
      className={classes}
      href={replayRouteHash(gameId, { returnHash: returnHash ?? undefined })}
      title={state === 'recorded' ? label : RECONSTRUCTED_TITLE}
    >
      {content}
    </a>
  );
}
