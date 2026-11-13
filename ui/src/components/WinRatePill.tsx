/**
 * A deck's or draft's win rate as a colored pill: red at 35% and below, amber at 50%,
 * green at 65% and above. Draws are left out of the rate.
 */
export function WinRatePill({ wins, losses }: { wins: number; losses: number }) {
  const decided = wins + losses;
  if (!decided) return <span className="replay-winrate replay-winrate-none">No results</span>;
  const rate = wins / decided;
  const hue = Math.round(Math.max(0, Math.min(1, (rate - 0.35) / 0.3)) * 130);
  return (
    <span
      className="replay-winrate"
      style={{ ['--winrate-color' as string]: `hsl(${hue} 70% 48%)` }}
      title={`${wins}–${losses} (${Math.round(rate * 100)}% of decided games)`}
    >
      {Math.round(rate * 100)}% WR
    </span>
  );
}
