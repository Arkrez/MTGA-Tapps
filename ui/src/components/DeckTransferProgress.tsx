import type { NativeDeckJob } from '../deckManagerApi';

export function DeckTransferProgress({ detail, progress }: Pick<NativeDeckJob, 'detail' | 'progress'>) {
  const total = progress?.total;
  const completed = Math.max(0, Math.min(progress?.completed ?? 0, total ?? Infinity));
  return <div className="deck-transfer-progress" role="status">
    <span>{detail}</span>
    <progress aria-label="Deck transfer progress" max={total && total > 0 ? total : 1}
      value={total && total > 0 ? completed : undefined} />
    {total && total > 0 ? <small>{Math.floor(completed / total * 100)}%</small> : null}
  </div>;
}
