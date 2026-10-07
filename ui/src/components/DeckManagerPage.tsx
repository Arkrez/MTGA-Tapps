import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Archive, Copy, Download, FolderOpen, Plus, RefreshCw, Trash2, Undo2, X } from 'lucide-react';
import {
  captureArenaDecks, exportManagedDeck, fetchDeckLibrary, fetchManagedDeck,
  importManagedDeck, updateManagedDeck, deleteManagedDeck, type DeckLibrary, type ManagedDeckDetail,
} from '../deckManagerApi';
import { formatDateTime } from '../format';
import { CardLink } from './CardLink';
import { DeckVisual } from './DeckVisual';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Deck Manager could not complete this action.';
}

const sourceLabels: Record<string, string> = {
  import: 'Imported backup', arena_save_request: 'Captured save request',
  arena_event_submission: 'Captured submitted list',
};

type ModalView = 'deck' | 'import' | 'revision' | 'delete' | 'trash';

function DeckModal({ title, busy, onClose, returnFocus, headerActions, children }: {
  title: string; busy: boolean; onClose: () => void; returnFocus: HTMLElement | null; headerActions?: ReactNode; children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = returnFocus ?? document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [returnFocus]);

  return (
    <dialog
      ref={dialogRef}
      className="deck-manager-modal"
      aria-modal="true"
      aria-labelledby="deck-manager-modal-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right
          || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}
    >
      <div className="deck-manager-modal-heading">
        <h3 id="deck-manager-modal-title" tabIndex={-1} autoFocus>{title}</h3>
        <div className="deck-manager-heading-actions">
          {headerActions}
          <button type="button" className="deck-manager-close" aria-label="Close dialog" disabled={busy} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      </div>
      {children}
    </dialog>
  );
}

export function DeckManagerPage() {
  const [library, setLibrary] = useState<DeckLibrary | null>(null);
  const [detail, setDetail] = useState<ManagedDeckDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState<string | undefined>();
  const [modal, setModal] = useState<ModalView | null>(null);
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
  const fileInput = useRef<HTMLInputElement>(null);
  const [modalOpener, setModalOpener] = useState<HTMLElement | null>(null);

  const visible = (library?.decks ?? []).filter((deck) =>
    Boolean(deck.trashed_at) === (view === 'trash')
    && `${deck.name} ${deck.format_name} ${deck.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const selectedDeck = library?.decks.find((deck) => deck.id === selected);
  const activeDetail = detail?.id === selected && (!revision || detail.revision_id === revision) ? detail : null;
  const editingRevision = modal === 'revision';

  useEffect(() => {
    const controller = new AbortController();
    fetchDeckLibrary(controller.signal).then((loaded) => {
      if (!controller.signal.aborted) setLibrary(loaded);
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(err));
    });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    fetchManagedDeck(selected, revision, controller.signal).then((loaded) => {
      if (controller.signal.aborted) return;
      setDetail(loaded); setNotes(loaded.notes); setTags(loaded.tags.join(', '));
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(err));
    });
    return () => controller.abort();
  }, [selected, revision, refresh]);

  async function action(run: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await run(); } catch (err: unknown) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  function closeModal() {
    setModal(null); setSelected(null); setRevision(undefined); setError('');
  }

  function cancelTrash() {
    setModal('deck'); setError(''); setNotice('');
  }

  function choose(id: string) {
    setModalOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSelected(id); setRevision(undefined); setModal('deck'); setError(''); setNotice('');
  }

  function openImport() {
    setModalOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSelected(null); setRevision(undefined); setText(''); setName(''); setFormat('');
    setError(''); setNotice(''); setModal('import');
  }

  async function saveImport() {
    const saved = await importManagedDeck(text, name, format, editingRevision ? selected ?? undefined : undefined);
    setRevision(undefined); setText(''); setName(''); setFormat('');
    if (editingRevision) { setSelected(saved.id); setModal('deck'); }
    else { setSelected(null); setModal(null); setView('saved'); setQuery(''); }
    setRefresh((value) => value + 1);
    setNotice(editingRevision ? 'Saved a new revision. Earlier lists are retained.' : 'Deck saved to your collection.');
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

  const feedback = <>
    {error ? <p role="alert" className="deck-manager-error">{error}</p> : null}
    {notice ? <p role="status" className="deck-manager-notice">{notice}</p> : null}
  </>;

  return (
    <section id="deck-manager-library" className="deck-manager-collection" aria-label="Saved deck collection">
      <div className="deck-manager-collection-toolbar">
        <div className="deck-manager-toolbar deck-manager-tabs">
          <button aria-pressed={view === 'saved'} onClick={() => setView('saved')}>
            <Archive size={16} /> Saved ({library?.decks.filter((d) => !d.trashed_at).length ?? 0})
          </button>
          <button aria-pressed={view === 'trash'} onClick={() => setView('trash')}><Trash2 size={16} /> Trash</button>
        </div>
        <input type="search" className="deck-manager-search" aria-label="Search saved decks" placeholder="Search names, formats or tags" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="deck-manager-toolbar deck-manager-collection-actions">
          <button disabled={busy} title="Back up decklists available in Arena’s log" onClick={() => void action(async () => {
            const result = await captureArenaDecks(); setRefresh((value) => value + 1);
            setNotice(`Captured ${result.captured} deck${result.captured === 1 ? '' : 's'}. ${result.note}${result.rejected ? ` ${result.rejected} malformed lists were skipped.` : ''}`);
          })}><RefreshCw size={16} /> Capture Arena lists</button>
          <button className="deck-manager-add" disabled={busy} onClick={openImport}><Plus size={18} /> Add deck</button>
        </div>
      </div>
      {!modal ? feedback : null}
      <div className="deck-manager-decks">
        {visible.map((deck) => (
          <button key={deck.id} className="deck-manager-tile" onClick={() => choose(deck.id)} aria-haspopup="dialog" title={deck.name}>
            <DeckVisual deckName={deck.name} visual={{ card_name: deck.art_card, card_id: null, type_category: 'Other', source: 'local_metadata', image_url: deck.art_card && !deck.art_card.startsWith('Card #') ? `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(deck.art_card)}&format=image&version=art_crop` : null }} />
            <span className="deck-manager-tile-text">
              <strong>{deck.name}</strong>
              <small>{deck.format_name || 'Format not specified'} · {deck.main_count} cards</small>
              <small>Updated: <time dateTime={deck.updated_at} title={formatDateTime(deck.updated_at)}>{new Date(deck.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></small>
            </span>
          </button>
        ))}
      </div>
      {!library ? <p className="empty-state" role="status">Loading your collection…</p> : !visible.length ? (
        <p className="empty-state">{view === 'trash' ? 'No decks in trash.' : query ? 'No saved decks match your search.' : 'Add your first deck, or capture lists available in Arena’s log.'}</p>
      ) : null}

      {modal ? (
        <DeckModal key={modal} title={modal === 'trash' ? `Move ${activeDetail?.name ?? selectedDeck?.name ?? 'saved deck'} to Trash?` : modal === 'delete' ? `Delete ${activeDetail?.name ?? selectedDeck?.name ?? 'saved deck'}?` : modal === 'deck' ? activeDetail?.name ?? selectedDeck?.name ?? 'Saved deck' : editingRevision ? 'Save a new revision' : 'Add a deck'} busy={busy} onClose={modal === 'trash' ? cancelTrash : closeModal} returnFocus={modalOpener}
          headerActions={modal === 'deck' && activeDetail ? <button className="deck-manager-copy" disabled={busy} onClick={() => void action(() => exportDeck(false))}><Copy size={16} /> Copy for Arena</button> : null}>
          {feedback}
          {modal === 'trash' ? (
            <div className="deck-manager-delete-confirmation">
              <p>This moves the deck and its saved revisions out of your collection into Trash. You can restore it from the Trash tab.</p>
              <div className="deck-manager-toolbar">
                <button disabled={busy} onClick={cancelTrash}>Cancel</button>
                <button className="deck-manager-delete" disabled={busy || !activeDetail || Boolean(activeDetail.trashed_at)} onClick={() => void action(async () => {
                  if (!activeDetail) return;
                  await updateManagedDeck(activeDetail.id, { trashed: true });
                  setRefresh((value) => value + 1); closeModal();
                  setNotice('Deck moved to Trash. You can restore it there.');
                })}><Trash2 size={16} />{busy ? 'Moving…' : 'Move to trash'}</button>
              </div>
            </div>
          ) : modal === 'delete' ? (
            <div className="deck-manager-delete-confirmation">
              <p>This permanently removes this deck and {activeDetail?.revisions.length === 1 ? 'its saved revision' : `all ${activeDetail?.revisions.length ?? 0} saved revisions`} from your collection. You cannot undo this from Trash.</p>
              <p className="deck-manager-description">Your deck in Arena and recorded game history are unchanged. Previously downloaded backups retain their copies.</p>
              <div className="deck-manager-toolbar">
                <button disabled={busy} onClick={() => { setModal('deck'); setError(''); }}>Cancel</button>
                <button className="deck-manager-delete" disabled={busy || !activeDetail?.trashed_at} onClick={() => void action(async () => {
                  if (!activeDetail) return;
                  await deleteManagedDeck(activeDetail.id);
                  setRefresh((value) => value + 1); closeModal();
                  setNotice('Deck and all saved revisions permanently deleted from your collection.');
                })}><Trash2 size={16} />{busy ? 'Deleting…' : 'Delete deck'}</button>
              </div>
            </div>
          ) : modal === 'deck' ? activeDetail ? (
            <div className="deck-manager-detail">
              <p className="deck-manager-description">{activeDetail.deck.format_name || 'Any format'} · {sourceLabels[activeDetail.deck.source] || 'Saved deck'}{activeDetail.deck.completeness === 'main_only' ? ' · Available piles only' : ''}</p>
              <div className="deck-manager-toolbar">
                <button disabled={busy} onClick={() => void action(() => exportDeck(true))}><Download size={16} /> Download backup</button>
                <button className={activeDetail.trashed_at ? undefined : 'deck-manager-delete'} disabled={busy} onClick={() => {
                  if (!activeDetail.trashed_at) { setModal('trash'); setError(''); setNotice(''); return; }
                  void action(async () => {
                    await updateManagedDeck(activeDetail.id, { trashed: false });
                    setRefresh((value) => value + 1); closeModal();
                    setNotice('Deck restored to your collection.');
                  });
                }}>{activeDetail.trashed_at ? <Undo2 size={16} /> : <Trash2 size={16} />}{activeDetail.trashed_at ? 'Restore from trash' : 'Move to trash'}</button>
                {activeDetail.trashed_at ? <button className="deck-manager-delete" disabled={busy} onClick={() => { setModal('delete'); setError(''); setNotice(''); }}><Trash2 size={16} /> Delete permanently</button> : null}
              </div>
              <p className="deck-manager-description">{library?.capabilities.message}</p>
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
              <div className="deck-manager-fields">
                <label>Tags<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Separate tags with commas" /></label>
                <label>Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></label>
              </div>
              <div className="deck-manager-toolbar">
                <button disabled={busy} onClick={() => void action(async () => {
                  await updateManagedDeck(activeDetail.id, { notes, tags: tags.split(',') }); setRefresh((value) => value + 1); setNotice('Notes and tags saved.');
                })}>Save notes & tags</button>
                {!activeDetail.trashed_at ? <button disabled={busy} onClick={() => void action(async () => {
                  const exported = await exportManagedDeck(activeDetail.id, activeDetail.revision_id, 'arena');
                  setText(exported.text); setName(activeDetail.name); setFormat(activeDetail.format_name); setModal('revision');
                })}>Save an edited revision…</button> : null}
              </div>
            </div>
          ) : <p role="status" className="empty-state">Loading deck…</p> : (
            <form className="deck-manager-import" onSubmit={(event) => { event.preventDefault(); void action(saveImport); }}>
              <p className="deck-manager-description">Paste an Arena decklist or open a .txt or .tappsdeck backup.{editingRevision ? ' Earlier revisions are retained.' : ''}</p>
              <div className="deck-manager-fields">
                <label>Deck name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Use the name in the decklist" maxLength={256} /></label>
                <label>Format<input value={format} onChange={(e) => setFormat(e.target.value)} placeholder="Optional" maxLength={128} /></label>
              </div>
              <label>Decklist or backup<textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} required spellCheck={false} /></label>
              <input ref={fileInput} type="file" accept=".txt,.tappsdeck,.json" className="deck-manager-file" aria-label="Open deck backup file" onChange={(event) => {
                const file = event.target.files?.[0]; if (!file) return;
                void action(async () => { if (file.size > 2_000_000) throw new Error('Deck file is too large.'); setText(await file.text()); setNotice(`${file.name} is ready to save.`); });
                event.target.value = '';
              }} />
              <div className="deck-manager-toolbar deck-manager-import-actions">
                <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}><FolderOpen size={16} /> Open file</button>
                <button className="deck-manager-add" type="submit" disabled={busy || !text.trim()}><Archive size={16} />{busy ? 'Working…' : editingRevision ? 'Save revision' : 'Save deck'}</button>
                <button type="button" disabled={busy} onClick={() => {
                  if (editingRevision) { setModal('deck'); setError(''); setNotice(''); } else closeModal();
                }}>{editingRevision ? 'Cancel revision' : 'Cancel'}</button>
              </div>
            </form>
          )}
        </DeckModal>
      ) : null}
    </section>
  );
}
