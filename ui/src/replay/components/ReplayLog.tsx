/**
 * Action log beside the table: rows grouped under turn headers, the active
 * row highlighted and kept in view, click (or Enter) to seek. Rows are
 * memoized so a tick re-renders only the previously and newly active rows;
 * card names share one delegated hover preview.
 */
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react';
import { formatCardName } from '../../format';
import { cardRouteHash } from '../../routes';
import { activeItemIndex, buildLogItems, formatClock } from '../logText';
import type { LogEventRow, LogItem, LogTurnHeader } from '../logText';
import type { HoverStore } from '../scene/hoverStore';
import type { CardKey, ReplayStream } from '../types';

export const MANUAL_SCROLL_HOLD_MS = 2000;
/** Height of the sticky turn header (rows scroll under it). */
const STICKY_HEADER_PX = 30;

interface RowProps {
  row: LogEventRow;
  active: boolean;
  cardReturnHash: string | undefined;
  onSeek: (seq: number) => void;
}

const ReplayLogRow = memo(function ReplayLogRow({ row, active, cardReturnHash, onSeek }: RowProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key === 'Enter' && event.target === event.currentTarget) onSeek(row.seq);
  };
  return (
    <li
      className={`timeline-event timeline-event-${row.actor} replay-log-row${active ? ' replay-log-row-active' : ''}`}
      data-active={active ? 'true' : undefined}
      data-seq={row.seq}
      aria-current={active ? 'step' : undefined}
      tabIndex={0}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest('a')) onSeek(row.seq);
      }}
      onKeyDown={onKeyDown}
    >
      <span className="replay-log-time">{formatClock(row.t)}</span>
      <span className="timeline-text">
        {row.parts.map((part, index) =>
          part.kind === 'text' ? (
            <span key={index}>{part.text}</span>
          ) : (
            <span key={index} className="timeline-card-entry">
              <a className="card-link timeline-card-reference" href={cardRouteHash(part.name, cardReturnHash)} data-card-name={part.name}>
                {formatCardName(part.text)}
              </a>
              {part.meta ? <span className="timeline-card-metadata">{part.meta}</span> : null}
            </span>
          ),
        )}
      </span>
    </li>
  );
});

function headerLabel(item: LogTurnHeader, playerSeat: number): string {
  if (item.turn === null) return 'Pre-game';
  const whose = item.seat === null ? '' : item.seat === playerSeat ? ' – Your turn' : " – Opponent's turn";
  return `Turn ${item.turn}${whose}`;
}

interface LogGroupProps {
  items: readonly LogItem[];
  firstIndex: number;
  /** Absolute index of the active row when it is in this group, else -1. */
  activeIndex: number;
  playerSeat: number;
  cardReturnHash: string | undefined;
  onSeek: (seq: number) => void;
}

/** One turn's rows; only the groups holding the old and new active row re-render on a tick. */
const LogGroup = memo(function LogGroup({ items, firstIndex, activeIndex, playerSeat, cardReturnHash, onSeek }: LogGroupProps) {
  return (
    <>
      {items.map((item, offset) =>
        item.type === 'turn' ? (
          <li key={item.key} className="timeline-turn-header replay-log-turn">
            <strong>{headerLabel(item, playerSeat)}</strong>
          </li>
        ) : (
          <ReplayLogRow
            key={item.key}
            row={item}
            active={firstIndex + offset === activeIndex}
            cardReturnHash={cardReturnHash}
            onSeek={onSeek}
          />
        ),
      )}
    </>
  );
});

interface LogGroupData {
  key: string;
  firstIndex: number;
  items: LogItem[];
}

function groupItems(items: readonly LogItem[]): LogGroupData[] {
  const groups: LogGroupData[] = [];
  items.forEach((item, index) => {
    if (item.type === 'turn' || !groups.length) groups.push({ key: item.key, firstIndex: index, items: [] });
    groups[groups.length - 1].items.push(item);
  });
  return groups;
}

interface ReplayLogProps {
  stream: ReplayStream;
  seq: number;
  hover: HoverStore;
  /** Stable back link for card pages (keeps rows memoized). */
  cardReturnHash?: string;
  /** Back link at the current position, applied when a card link is clicked. */
  returnHashNow?: () => string;
  onSeek: (seq: number) => void;
}

export function ReplayLog({ stream, seq, hover, cardReturnHash, returnHashNow, onSeek }: ReplayLogProps) {
  const items = useMemo<LogItem[]>(() => buildLogItems(stream), [stream]);
  const groups = useMemo(() => groupItems(items), [items]);
  const keyByName = useMemo(() => {
    const map = new Map<string, CardKey>();
    for (const [key, card] of Object.entries(stream.cards)) if (!map.has(card.name)) map.set(card.name, key);
    return map;
  }, [stream.cards]);
  const activeIndex = activeItemIndex(items, seq);
  // The active row is the newest event row at or before the playhead.
  let activeRow = -1;
  for (let i = activeIndex; i >= 0; i -= 1) {
    if (items[i].type === 'event') {
      activeRow = i;
      break;
    }
  }
  const scroller = useRef<HTMLDivElement>(null);
  const lastManual = useRef(-Infinity);
  const markManual = useCallback(() => {
    lastManual.current = performance.now();
  }, []);

  useEffect(() => {
    if (activeRow < 0 || performance.now() - lastManual.current < MANUAL_SCROLL_HOLD_MS) return;
    const host = scroller.current;
    const node = host?.querySelector<HTMLElement>('[data-active="true"]');
    if (!host || !node) return;
    // Only scroll when the row is out of view: scrollIntoView forces a full layout pass.
    const view = host.getBoundingClientRect();
    const row = node.getBoundingClientRect();
    if (row.top < view.top + STICKY_HEADER_PX || row.bottom > view.bottom) {
      node.scrollIntoView?.({ block: 'nearest' });
    }
  }, [activeRow]);

  const showPreview = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-card-name]');
    if (!anchor) return;
    const name = anchor.dataset.cardName ?? '';
    const rect = anchor.getBoundingClientRect();
    const host = scroller.current?.getBoundingClientRect();
    hover.set({
      key: `log:${name}`,
      card: keyByName.get(name) ?? null,
      name,
      x: host ? host.left : rect.left,
      y: rect.top + rect.height / 2,
      source: 'log',
    });
  };
  const hidePreview = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-card-name]');
    const next = event.relatedTarget as Node | null;
    if (anchor && !(next && anchor.contains(next))) hover.clear(`log:${anchor.dataset.cardName ?? ''}`);
  };

  if (!items.length) {
    return <p className="empty-state">No actions were logged for this game.</p>;
  }
  return (
    <div
      className="replay-log"
      ref={scroller}
      onWheel={markManual}
      onTouchStart={markManual}
      onPointerDown={markManual}
      onMouseOver={showPreview}
      onMouseOut={hidePreview}
      onFocus={showPreview}
      onBlur={hidePreview}
      onClickCapture={(event) => {
        const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-card-name]');
        if (anchor && returnHashNow) {
          anchor.setAttribute('href', cardRouteHash(anchor.dataset.cardName ?? '', returnHashNow()));
        }
        hover.set(null);
      }}
    >
      <ol className="replay-log-list" aria-label="Actions">
        {groups.map((group) => (
          <LogGroup
            key={group.key}
            items={group.items}
            firstIndex={group.firstIndex}
            activeIndex={activeRow >= group.firstIndex && activeRow < group.firstIndex + group.items.length ? activeRow : -1}
            playerSeat={stream.player_seat}
            cardReturnHash={cardReturnHash}
            onSeek={onSeek}
          />
        ))}
      </ol>
    </div>
  );
}
