import { useEffect, useRef, useState } from 'react';
import { Archive, Copy, Download, FolderOpen, RefreshCw, Trash2, Undo2 } from 'lucide-react';
import {
  captureArenaDecks, exportManagedDeck, fetchDeckLibrary, fetchManagedDeck,
  importManagedDeck, updateManagedDeck, type DeckLibrary, type ManagedDeckDetail,
} from '../deckManagerApi';
import { formatDateTime } from '../format';
import { CardLink } from './CardLink';
import { DeckVisual } from './DeckVisual';
import { Section } from './Section';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Deck Manager could not complete this action.';
}

const sourceLabels: Record<string, string> = {
  import: 'Imported backup', arena_save_request: 'Captured save request',
  arena_event_submission: 'Captured submitted list',
};

export function DeckManagerPage() {
  const [library, setLibrary] = useState<DeckLibrary | null>(null);
  const [detail, setDetail] = useState<ManagedDeckDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState<string | undefined>();
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'saved' | 'trash'>('saved');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [format, setFormat] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const editingRevision = editingDeckId !== null;
  const fileInput = useRef<HTMLInputElement>(null);

  const visible = (library?.decks ?? []).filter((deck) =>
    Boolean(deck.trashed_at) === (view === 'trash')
    && `${deck.name} ${deck.format_name} ${deck.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const activeId = selected && visible.some((deck) => deck.id === selected) ? selected : visible[0]?.id;
  const activeDetail = detail?.id === activeId && (!revision || detail.revision_id === revision) ? detail : null;

  useEffect(() => {
    const controller = new AbortController();
    fetchDeckLibrary(controller.signal).then(setLibrary).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(err));
    });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    fetchManagedDeck(activeId, revision, controller.signal).then((loaded) => {
      if (controller.signal.aborted) return;
      setDetail(loaded); setNotes(loaded.notes); setTags(loaded.tags.join(', '));
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(err));
    });
    return () => controller.abort();
  }, [activeId, revision, refresh]);

  async function action(run: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await run(); } catch (err: unknown) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  function choose(id: string) {
    setSelected(id); setRevision(undefined); setEditingDeckId(null);
  }

  async function saveImport() {
    const saved = await importManagedDeck(text, name, format, editingDeckId ?? undefined);
    choose(saved.id); setView('saved'); setQuery(''); setText(''); setName(''); setFormat('');
    setRefresh((value) => value + 1); setNotice(editingRevision ? 'Saved a new revision. Earlier lists are retained.' : 'Deck saved to your collection.');
  }

  async function exportDeck(download: boolean) {
    if (!activeDetail) return;
    const result = await exportManagedDeck(activeDetail.id, activeDetail.revision_id, download ? 'backup' : 'arena');
    if (download) {
      const url = URL.createObjectURL(new Blob([result.text], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url;
      const fileName = Array.from(result.name).filter((char) => char.charCodeAt(0) > 31).join('').replace(/[<>:"/\\|?*]/gu, '_');
      link.download = `${fileName || 'deck'}${result.extension}`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Full deck backup downloaded.');
    } else {
      await navigator.clipboard.writeText(result.text);
      setNotice(`Deck copied. Open Arena’s Decks screen and click Import when a slot is available.${result.note ? ` ${result.note}` : ''}`);
    }
  }

  return <Section id="deck-manager-library" collapsible={false}>
    <div className="deck-manager-content">
    <div className="deck-manager-intro">
      <div><h3>Your deck collection</h3><p>Keep any deck, restore it later, and retain earlier versions.</p></div>
      <button className="deck-finder-action" disabled={busy} onClick={() => void action(async () => {
        const result = await captureArenaDecks(); setRefresh((value) => value + 1);
        setNotice(`Captured ${result.captured} deck${result.captured === 1 ? '' : 's'}. ${result.note}${result.rejected ? ` ${result.rejected} malformed lists were skipped.` : ''}`);
      })}><RefreshCw size={16} /> Capture available Arena lists</button>
    </div>
    <p className="section-description">{library?.capabilities.message ?? 'Loading your collection…'}</p>
    {error ? <p role="alert" className="deck-manager-error">{error}</p> : null}
    {notice ? <p role="status" className="deck-manager-notice">{notice}</p> : null}
    <div className="deck-manager-layout">
      <div className="deck-manager-browser">
        <div className="deck-manager-toolbar">
          <button aria-pressed={view === 'saved'} onClick={() => { setView('saved'); setRevision(undefined); }}><Archive size={16} /> Saved ({library?.decks.filter((d) => !d.trashed_at).length ?? 0})</button>
          <button aria-pressed={view === 'trash'} onClick={() => { setView('trash'); setRevision(undefined); }}><Trash2 size={16} /> Trash</button>
        </div>
        <input type="search" aria-label="Search saved decks" placeholder="Search names, formats or tags" value={query} onChange={(e) => { setQuery(e.target.value); setRevision(undefined); }} />
        <div className="deck-manager-decks">
          {visible.map((deck) => <button key={deck.id} className={`deck-manager-tile${activeId === deck.id ? ' selected' : ''}`} onClick={() => choose(deck.id)} aria-pressed={activeId === deck.id}>
            <DeckVisual deckName={deck.name} visual={{ card_name: deck.art_card, card_id: null, type_category: 'Other', source: 'local_metadata', image_url: deck.art_card && !deck.art_card.startsWith('Card #') ? `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(deck.art_card)}&format=image&version=art_crop` : null }} />
            <span><strong>{deck.name}</strong><small>{deck.format_name || 'Format not specified'} · {deck.main_count} cards</small><small>{deck.tags.join(' · ') || sourceLabels[deck.source] || 'Saved deck'}</small></span>
          </button>)}
          {library && !visible.length ? <p className="empty-state">{view === 'trash' ? 'No decks in trash.' : query ? 'No saved decks match your search.' : 'Save your first deck below, or capture lists available in Arena’s log.'}</p> : null}
        </div>
      </div>
      <div className="deck-manager-detail">
        {activeDetail ? <>
          <h3>{activeDetail.name}</h3>
          <p className="section-description">{activeDetail.deck.format_name || 'Any format'} · {sourceLabels[activeDetail.deck.source] || 'Saved deck'}{activeDetail.deck.completeness === 'main_only' ? ' · Available piles only' : ''}</p>
          <div className="deck-manager-toolbar">
            <button disabled={busy} onClick={() => void action(() => exportDeck(false))}><Copy size={16} /> Copy for Arena</button>
            <button disabled={busy} onClick={() => void action(() => exportDeck(true))}><Download size={16} /> Download backup</button>
            <button disabled={busy} onClick={() => void action(async () => {
              await updateManagedDeck(activeDetail.id, { trashed: !activeDetail.trashed_at });
              setRefresh((value) => value + 1); setRevision(undefined);
              setNotice(activeDetail.trashed_at ? 'Deck restored to your collection.' : 'Deck moved to Trash. You can restore it there.');
            })}>{activeDetail.trashed_at ? <Undo2 size={16} /> : <Trash2 size={16} />}{activeDetail.trashed_at ? 'Restore from trash' : 'Move to trash'}</button>
          </div>
          <label>Saved revision<select aria-label="Saved revision" value={activeDetail.revision_id} onChange={(e) => setRevision(e.target.value)}>
            {activeDetail.revisions.map((r) => <option key={r.id} value={r.id}>{formatDateTime(r.created_at)}{r.id === activeDetail.current_revision_id ? ' · Latest' : ''}</option>)}
          </select></label>
          {['Commander', 'Companion', 'Deck', 'Sideboard', 'Maybeboard'].map((section) => {
            const cards = activeDetail.deck.cards.filter((c) => c.section === section);
            return cards.length ? <div key={section} className="deck-manager-card-section"><h4>{section} <span>{cards.reduce((sum, c) => sum + c.quantity, 0)}</span></h4>
              <ul>{cards.map((card, i) => <li key={`${section}-${i}`}><span className="deck-manager-quantity">{card.quantity}</span>
                {card.name.startsWith('Card #') ? <span>{card.name}</span> : <CardLink cardName={card.name} returnHash="#/deck-manager" />}
                {card.set_code ? <small>{card.set_code} {card.collector_number}</small> : null}</li>)}</ul></div> : null;
          })}
          <div className="deck-manager-fields"><label>Tags<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Separate tags with commas" /></label>
            <label>Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></label></div>
          <div className="deck-manager-toolbar"><button disabled={busy} onClick={() => void action(async () => {
            await updateManagedDeck(activeDetail.id, { notes, tags: tags.split(',') }); setRefresh((value) => value + 1); setNotice('Notes and tags saved.');
          })}>Save notes & tags</button>
            {!activeDetail.trashed_at ? <button disabled={busy} onClick={() => void action(async () => {
              const exported = await exportManagedDeck(activeDetail.id, activeDetail.revision_id, 'arena');
              setText(exported.text); setName(activeDetail.name); setFormat(activeDetail.format_name); setEditingDeckId(activeDetail.id);
              document.getElementById('deck-manager-import')?.scrollIntoView({ block: 'start' });
            })}>Save an edited revision…</button> : null}</div>
        </> : <p className="empty-state">{activeId ? 'Loading deck…' : 'Select a saved deck to view its list and backups.'}</p>}
      </div>
    </div>
    <form className="deck-manager-import" id="deck-manager-import" onSubmit={(event) => { event.preventDefault(); void action(saveImport); }}>
      <h3>{editingRevision ? 'Save a new revision' : 'Add a deck to your collection'}</h3>
      <p className="section-description">Paste any Arena decklist or open a .txt or .tappsdeck file. Full backups preserve captured Arena card IDs and deck metadata.</p>
      <div className="deck-manager-fields"><label>Deck name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Use the name in the decklist" maxLength={256} /></label>
        <label>Format<input value={format} onChange={(e) => setFormat(e.target.value)} placeholder="Optional" maxLength={128} /></label></div>
      <label>Decklist or backup<textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} required spellCheck={false} /></label>
      <input ref={fileInput} type="file" accept=".txt,.tappsdeck,.json" className="deck-manager-file" aria-label="Open deck backup file" onChange={(event) => {
        const file = event.target.files?.[0]; if (!file) return;
        void action(async () => { if (file.size > 2_000_000) throw new Error('Deck file is too large.'); setText(await file.text()); setNotice(`${file.name} is ready to save.`); });
        event.target.value = '';
      }} />
      <div className="deck-manager-toolbar"><button type="button" disabled={busy} onClick={() => fileInput.current?.click()}><FolderOpen size={16} /> Open file</button>
        <button type="submit" disabled={busy || !text.trim()}><Archive size={16} />{busy ? 'Working…' : editingRevision ? 'Save revision' : 'Save deck'}</button>
        {editingRevision ? <button type="button" onClick={() => { setEditingDeckId(null); setText(''); setName(''); setFormat(''); }}>Cancel revision</button> : null}</div>
    </form>
    </div>
  </Section>;
}
