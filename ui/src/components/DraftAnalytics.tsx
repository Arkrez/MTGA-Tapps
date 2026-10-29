import { useEffect, useMemo, useState } from 'react';
import { fetchDraftAnalytics } from '../api';
import type { DraftAnalytics as DraftAnalyticsData, DraftCardStats, DraftPairStats, DraftTally } from '../replay/draft/types';
import { CardLink } from './CardLink';
import { ColorPips } from './ColorPips';
import { MetricCard } from './MetricCard';
import { Section } from './Section';
import { SortableTable, type Column } from './SortableTable';
import { WinRatePill } from './WinRatePill';

type Tab = 'overview' | 'cards' | 'pairs';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'cards', label: 'Cards' },
  { id: 'pairs', label: 'Card pairs' },
];
const MIN_GAMES_OPTIONS = [0, 3, 5, 10];

function record(tally: DraftTally): string {
  return tally.games ? `${tally.wins}–${tally.losses}` : '—';
}

function Rate({ tally }: { tally: DraftTally }) {
  return tally.wins + tally.losses ? <WinRatePill wins={tally.wins} losses={tally.losses} /> : <span className="draft-stats-muted">—</span>;
}

function CardName({ card }: { card: { name: string; rarity: string } }) {
  return (
    <span className="draft-stats-card">
      <span className={`draft-stats-rarity draft-stats-rarity-${card.rarity}`} title={card.rarity} aria-hidden="true" />
      {card.name.startsWith('Card #') ? card.name : <CardLink cardName={card.name} returnHash="#/replay" />}
    </span>
  );
}

const cardColumns: Column<DraftCardStats>[] = [
  { key: 'name', header: 'Card', render: (row) => <CardName card={row} />, sortValue: (row) => row.name },
  { key: 'colors', header: 'Colors', render: (row) => <ColorPips colors={row.colors} size={13} />, sortValue: (row) => row.colors },
  {
    key: 'in_deck',
    header: 'WR in deck',
    center: true,
    render: (row) => <Rate tally={row.in_deck} />,
    sortValue: (row) => (row.in_deck.wins + row.in_deck.losses ? row.in_deck.win_rate : null),
  },
  { key: 'arena_id', header: 'Record in deck', numeric: true, render: (row) => record(row.in_deck), sortValue: (row) => row.in_deck.games },
  {
    key: 'picked',
    header: 'WR when picked',
    center: true,
    render: (row) => <Rate tally={row.picked} />,
    sortValue: (row) => (row.picked.wins + row.picked.losses ? row.picked.win_rate : null),
  },
  {
    key: 'rarity',
    header: 'Picked / in deck',
    numeric: true,
    render: (row) => `${row.picked.drafts} / ${row.in_deck.drafts}`,
    sortValue: (row) => row.picked.drafts,
  },
  { key: 'avg_pick', header: 'Avg pick', numeric: true, render: (row) => row.avg_pick ?? '—', sortValue: (row) => row.avg_pick },
  { key: 'first_picks', header: 'P1p1', numeric: true },
];

function PairList({ title, pairs, empty }: { title: string; pairs: DraftPairStats[]; empty: string }) {
  return (
    <section className="draft-pairs" aria-label={title}>
      <h4>{title}</h4>
      {pairs.length ? (
        <ol>
          {pairs.map((pair) => (
            <li key={`${pair.cards[0].arena_id}-${pair.cards[1].arena_id}`}>
              <span className="draft-pairs-cards">
                <CardName card={pair.cards[0]} />
                <span className="draft-stats-muted">+</span>
                <CardName card={pair.cards[1]} />
              </span>
              <span className="draft-pairs-result">
                <WinRatePill wins={pair.wins} losses={pair.losses} />
                <span className="draft-stats-muted">
                  {pair.wins}–{pair.losses} · {pair.drafts} drafts
                </span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-state">{empty}</p>
      )}
    </section>
  );
}

/**
 * Replay list "Draft details": your results across drafts — overall and by
 * colors and event, every card's win rate when you picked it and when it made
 * your deck, and notable pairs of cards that were in a deck together.
 */
export function DraftAnalytics({ reloadToken = 0 }: { reloadToken?: number }) {
  const [data, setData] = useState<DraftAnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [query, setQuery] = useState('');
  const [minGames, setMinGames] = useState(3);

  useEffect(() => {
    const controller = new AbortController();
    fetchDraftAnalytics(controller.signal).then(setData, (failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => controller.abort();
  }, [reloadToken]);

  const cards = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (data?.cards ?? []).filter(
      (card) => card.picked.games >= minGames && (!needle || card.name.toLocaleLowerCase().includes(needle)),
    );
  }, [data, minGames, query]);

  if (error) {
    return (
      <Section id="replay-draft-details" title="Draft details" collapsible={false}>
        <p className="state-panel error-state" role="alert">
          {error}
        </p>
      </Section>
    );
  }
  if (!data) {
    return (
      <Section id="replay-draft-details" title="Draft details" collapsible={false}>
        <p className="state-panel" role="status" aria-busy="true">
          Loading draft details...
        </p>
      </Section>
    );
  }
  if (!data.summary.games) {
    return (
      <Section id="replay-draft-details" title="Draft details" collapsible={false}>
        <p className="empty-state">Draft details appear once you have played games with a drafted deck.</p>
      </Section>
    );
  }

  const { summary } = data;
  return (
    <Section id="replay-draft-details" title="Draft details" collapsible={false}>
      <p className="replay-list-intro">
        Your own results: each draft's games are credited to the cards you picked and the cards in its final deck.
        Small samples swing a lot, so check the number of games before reading much into a rate.
      </p>
      <div className="quick-filters draft-stats-tabs" role="tablist" aria-label="Draft details">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? 'quick-filter quick-filter-active' : 'quick-filter'}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div role="tabpanel" aria-label="Overview">
          <section className="metric-grid" aria-label="Draft record">
            <MetricCard label="Drafts played" value={summary.drafts} detail={`${summary.games} games`} />
            <MetricCard label="Record" value={record(summary)} />
            <MetricCard
              label="Win rate"
              value={summary.win_rate === null ? '—' : `${Math.round(summary.win_rate * 100)}%`}
              tone={summary.win_rate !== null && summary.win_rate >= 0.5 ? 'win' : 'loss'}
            />
          </section>
          <div className="draft-stats-split">
            <SortableTable
              caption="By deck colors"
              compact
              columns={[
                { key: 'colors', header: 'Colors', render: (row) => <ColorPips colors={row.colors} size={14} /> },
                { key: 'drafts', header: 'Drafts', numeric: true },
                { key: 'games', header: 'Record', numeric: true, render: (row) => record(row) },
                { key: 'win_rate', header: 'Win rate', center: true, render: (row) => <Rate tally={row} /> },
              ]}
              getRowKey={(row) => row.colors}
              initialSort={{ key: 'games', direction: 'desc' }}
              rows={data.colors}
            />
            <SortableTable
              caption="By event"
              compact
              columns={[
                { key: 'format_label', header: 'Event' },
                { key: 'drafts', header: 'Drafts', numeric: true },
                { key: 'games', header: 'Record', numeric: true, render: (row) => record(row) },
                { key: 'win_rate', header: 'Win rate', center: true, render: (row) => <Rate tally={row} /> },
              ]}
              getRowKey={(row) => row.format_label}
              initialSort={{ key: 'games', direction: 'desc' }}
              rows={data.formats}
            />
          </div>
        </div>
      ) : null}

      {tab === 'cards' ? (
        <div role="tabpanel" aria-label="Cards">
          <div className="replay-list-controls draft-stats-controls">
            <input
              aria-label="Filter cards"
              placeholder="Filter cards"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <label>
              Min games
              <select value={minGames} onChange={(event) => setMinGames(Number(event.target.value))}>
                {MIN_GAMES_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {cards.length ? (
            <SortableTable
              caption="Your win rate by card"
              compact
              columns={cardColumns}
              getRowKey={(row) => row.arena_id}
              initialSort={{ key: 'in_deck', direction: 'desc' }}
              pageSize={25}
              rows={cards}
            />
          ) : (
            <p className="empty-state">No cards match these filters.</p>
          )}
        </div>
      ) : null}

      {tab === 'pairs' ? (
        <div role="tabpanel" aria-label="Card pairs">
          <p className="replay-list-intro">
            Two cards in the same final deck, across at least {data.pair_rules.min_drafts} drafts and{' '}
            {data.pair_rules.min_games} decided games. At most two pairs from the same decks are listed, so one hot
            run does not fill the list.
          </p>
          <div className="draft-stats-split">
            <PairList title="Best together" pairs={data.pairs.best} empty="No pair has enough games yet." />
            <PairList title="Worst together" pairs={data.pairs.worst} empty="No pair has enough games yet." />
          </div>
        </div>
      ) : null}
    </Section>
  );
}
