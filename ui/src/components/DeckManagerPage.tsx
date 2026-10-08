import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Pencil, Archive, ArrowDownToLine, ArrowUpFromLine, Copy, Download, FolderOpen, Plus, RefreshCw, Trash2, Undo2, X } from 'lucide-react';
import {
  saveDeckCollection, removeDeckCollection, moveDecksToCollection, type DeckCollection, type NativeDeckJob,
  captureArenaDecks, exportManagedDeck, fetchDeckLibrary, fetchManagedDeck,
  importManagedDeck, updateManagedDeck, deleteManagedDeck, removeManagedDecks, type DeckLibrary, type ManagedDeckDetail,
  fetchNativeDeckStatus, startNativeDeckJob, fetchNativeDeckJob, type NativeDeckStatus, type NativeDeckAction, type ManagedDeck,
} from '../deckManagerApi';
import { formatDateTime } from '../format';
import { CardLink } from './CardLink';
import { DeckVisual } from './DeckVisual';
import { DeckTransferProgress } from './DeckTransferProgress';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Deck Manager could not complete this action.';
}

const sourceLabels: Record<string, string> = {
  import: 'Imported backup', arena_save_request: 'Captured save request',
  arena_event_submission: 'Captured submitted list',
  arena_native: 'Full backup',
};

type ModalView = 'deck' | 'import' | 'revision' | 'delete' | 'trash' | 'store' | 'bulk-trash' | 'bulk-delete' | 'collection' | 'remove-collection';

const statusLabels = {
  arena: 'In Arena', collection: 'Collection only', unknown: 'Not checked', trash: 'In Trash',
  native: 'Full backup', text: 'Text backup', partial: 'Captured list',
  backed: 'Backed up', unbacked: 'Not backed up',
};
type DeckStatus = keyof typeof statusLabels;

function deckArt(cardName?: string | null, cardId?: number | null) {
  const name = cardName && !cardName.startsWith('Card #') ? cardName : null;
  const nameUrl = name ? `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=art_crop` : null;
  return { card_name: name, card_id: cardId ?? null, type_category: 'Other', source: 'local_metadata' as const,
    image_url: cardId ? `https://api.scryfall.com/cards/arena/${cardId}?format=image&version=art_crop` : nameUrl,
    image_fallback_url: cardId ? nameUrl : null };
}

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
  const [view, setView] = useState<'saved' | 'trash' | 'arena'>('saved');
  const [statusFilter, setStatusFilter] = useState<DeckStatus | 'all'>('all');
  const [localBusy, setBusy] = useState(false);
  const [native, setNative] = useState<NativeDeckStatus | null>(null);
  const [nativeJob, setNativeJob] = useState<string | null>(null);
  const [nativeProgress, setNativeProgress] = useState('');
  const [transferProgress, setTransferProgress] = useState<NativeDeckJob['progress']>();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [destination, setDestination] = useState('');
  const [importCollection, setImportCollection] = useState('');
  const [collectionName, setCollectionName] = useState('');
  const [editingCollection, setEditingCollection] = useState<DeckCollection | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const busy = localBusy || Boolean(nativeJob) || Boolean(native?.busy);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [format, setFormat] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [modalOpener, setModalOpener] = useState<HTMLElement | null>(null);

  const arenaIds = new Set(native?.decks.map((deck) => deck.id) ?? []);
  const inArena = (deck: { native_arena_ids?: string[] }) => (deck.native_arena_ids ?? []).some((id) => arenaIds.has(id));
  const savedStatuses = (deck: ManagedDeck): DeckStatus[] => [
    deck.trashed_at ? 'trash' : native?.connected ? inArena(deck) ? 'arena' : 'collection' : 'unknown',
    deck.native_restorable ? 'native' : deck.completeness === 'text' ? 'text' : 'partial',
  ];
  const arenaBackups = new Map<string, ManagedDeck>();
  const arenaArtwork = new Map<string, ManagedDeck>();
  for (const deck of library?.decks ?? []) {
    for (const id of deck.native_arena_ids ?? []) {
      arenaArtwork.set(id, deck);
      if (!deck.trashed_at && deck.native_restorable) arenaBackups.set(id, deck);
    }
  }
  const arenaBackup = (id: string) => arenaBackups.get(id);
  const arenaStatuses = (id: string): DeckStatus[] => ['arena', arenaBackup(id) ? 'backed' : 'unbacked'];
  const filterStatuses: DeckStatus[] = view === 'arena' ? ['arena', 'backed', 'unbacked'] : view === 'trash' ? ['trash', 'native', 'text', 'partial'] : ['arena', 'collection', 'unknown', 'native', 'text', 'partial'];
  const visible = (library?.decks ?? []).filter((deck) =>
    Boolean(deck.trashed_at) === (view === 'trash')
    && (statusFilter === 'all' || savedStatuses(deck).includes(statusFilter))
    && `${deck.name} ${deck.format_name} ${deck.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const selectedDeck = library?.decks.find((deck) => deck.id === selected);
  const activeDetail = detail?.id === selected && (!revision || detail.revision_id === revision) ? detail : null;
  const editingRevision = modal === 'revision';
  const arenaDecks = (native?.decks ?? []).filter((deck) => `${deck.name} ${deck.format_name}`.toLowerCase().includes(query.toLowerCase())
    && (statusFilter === 'all' || arenaStatuses(deck.id).includes(statusFilter)));
  const checkedDecks = (library?.decks ?? []).filter((deck) => checked.includes(deck.id));
  const canRestoreSelection = checkedDecks.length > 0 && checkedDecks.length === checked.length
    && checkedDecks.every((deck) => deck.native_restorable && !deck.trashed_at && !inArena(deck));

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
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function readStatus() {
      try {
        const loaded = await fetchNativeDeckStatus(controller.signal);
        if (controller.signal.aborted) return;
        setNative(loaded);
        if (loaded.active_job) setNativeJob(loaded.active_job);
      } catch (err: unknown) { if (!controller.signal.aborted) setError(errorMessage(err)); }
      if (!controller.signal.aborted) timer = setTimeout(() => void readStatus(), 5000);
    }
    void readStatus();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refresh]);

  useEffect(() => {
    if (!nativeJob) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const job = await fetchNativeDeckJob(nativeJob!, controller.signal);
        if (controller.signal.aborted) return;
        setNativeProgress(job.detail); setTransferProgress(job.progress);
        if (job.state === 'running') { timer = setTimeout(() => void poll(), 700); return; }
        setNativeJob(null); setNativeProgress('');
        if (job.state === 'error') { setError(job.detail); setChecked([]); setModal((value) => value === 'store' ? null : value); }
        else {
          setChecked([]);
          setModal(null); setSelected(null); setRevision(undefined);
          const count = job.result?.count ?? 0;
          const messages: Record<NativeDeckAction, string> = {
            connect: 'Arena decks refreshed.', backup: `Backed up ${count} deck${count === 1 ? '' : 's'} to your collection.`,
            store: `Moved ${count} deck${count === 1 ? '' : 's'} to your collection. Arena slots are available.`,
            restore: `Restored ${count} deck${count === 1 ? '' : 's'} directly to Arena.`, reconcile: 'Interrupted transfers reconciled. No Arena writes were repeated.',
            add: 'Deck added directly to Arena.',
          };
          setNotice(messages[job.result?.action ?? 'connect']);
        }
        setRefresh((value) => value + 1);
      } catch (err: unknown) {
        if (!controller.signal.aborted) { setError(errorMessage(err)); setNativeJob(null); setNativeProgress(''); setRefresh((value) => value + 1); }
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [nativeJob]);

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

  async function nativeAction(kind: NativeDeckAction, ids = checked) {
    if (native?.in_game) throw new Error('Finish your current game before connecting Deck Manager to Arena.');
    const decks = ids.map((id) => ({ id, ...(kind === 'restore' && activeDetail?.id === id ? { revision: activeDetail.revision_id } : {}) }));
    const job = await startNativeDeckJob(kind, decks);
    setNativeJob(job.job_id); setNativeProgress('Connecting to Arena…'); setTransferProgress(undefined);
  }

  function changeView(next: 'saved' | 'trash' | 'arena') { setView(next); setChecked([]); setStatusFilter('all'); setError(''); setNotice(''); }

  function filterByStatus(status: DeckStatus | 'all') { setStatusFilter(status); setChecked([]); setCollapsed([]); }

  function statusPills(statuses: DeckStatus[]) {
    return <div className="deck-manager-status-pills">{statuses.map((status) =>
      <button type="button" key={status} className={`deck-manager-status-pill deck-manager-status-${status}`} disabled={busy}
        aria-label={`Filter by ${statusLabels[status]}`} title={`Show ${statusLabels[status].toLowerCase()} decks`}
        onClick={() => filterByStatus(status)}>{statusLabels[status]}</button>)}</div>;
  }

  function toggleChecked(id: string) { setChecked((value) => value.includes(id) ? value.filter((item) => item !== id) : [...value, id]); }

  function confirmRemoval() {
    setModalOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setError(''); setNotice(''); setModal(view === 'trash' ? 'bulk-delete' : 'bulk-trash');
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
    const saved = await importManagedDeck(text, name, format, editingRevision ? selected ?? undefined : undefined, editingRevision ? undefined : importCollection || null);
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

  const collectionGroups = [...(library?.collections ?? []), { id: '', name: 'Unsorted' }];

  function openCollection(collection: DeckCollection | null = null) {
    setModalOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setEditingCollection(collection); setCollectionName(collection?.name ?? '');
    setError(''); setNotice(''); setModal('collection');
  }

  function collectionOptions() {
    return <><option value="">Unsorted</option>{library?.collections?.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</>;
  }

  function savedTile(deck: ManagedDeck) {
    return (
          <div className="deck-manager-tile-wrapper" key={deck.id}>
          <label className="deck-manager-tile-select" title={`Select ${deck.name}`} onClick={(event) => event.stopPropagation()}>
            <input className="deck-manager-tile-check" type="checkbox" aria-label={`Select ${deck.name}`} checked={checked.includes(deck.id)} disabled={busy} onChange={() => toggleChecked(deck.id)} />
          </label>
          <button key={deck.id} className="deck-manager-tile" onClick={() => choose(deck.id)} aria-haspopup="dialog" title={deck.name}>
            <DeckVisual deckName={deck.name} visual={deckArt(deck.art_card)} />
            <span className="deck-manager-tile-text">
              <strong>{deck.name}</strong>
              <small>{deck.format_name || 'Format not specified'} · {deck.main_count} cards</small>
              <small>Updated: <time dateTime={deck.updated_at} title={formatDateTime(deck.updated_at)}>{new Date(deck.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></small>
            </span>
          </button>
          {statusPills(savedStatuses(deck))}
          </div>

    );
  }


  const feedback = <>
    {error ? <p role="alert" className="deck-manager-error">{error}</p> : null}
    {notice ? <p role="status" className="deck-manager-notice">{notice}</p> : null}
    {nativeProgress ? <DeckTransferProgress detail={nativeProgress} progress={transferProgress} /> : null}
  </>;

  return (
    <section id="deck-manager-library" className="deck-manager-collection" aria-label="Saved deck collection">
      <div className="deck-manager-collection-toolbar">
        <div className="deck-manager-toolbar deck-manager-tabs">
          <button aria-pressed={view === 'saved'} disabled={busy} onClick={() => changeView('saved')}>
            <Archive size={16} /> Saved ({library?.decks.filter((d) => !d.trashed_at).length ?? 0})
          </button>
          <button aria-pressed={view === 'arena'} disabled={busy} onClick={() => changeView('arena')}><FolderOpen size={16} /> Arena{native?.connected ? ` (${native.decks.length})` : ''}</button>
          <button aria-pressed={view === 'trash'} disabled={busy} onClick={() => changeView('trash')}><Trash2 size={16} /> Trash</button>
        </div>
        <input type="search" className="deck-manager-search" aria-label="Search saved decks" placeholder="Search names, formats or tags" value={query} disabled={busy} onChange={(e) => { setQuery(e.target.value); setChecked([]); setCollapsed([]); }} />
        <select className="deck-manager-status-filter" aria-label="Filter decks by status" value={statusFilter} disabled={busy} onChange={(e) => filterByStatus(e.target.value as DeckStatus | 'all')}>
          <option value="all">All statuses</option>
          {filterStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
        </select>
        <div className="deck-manager-toolbar deck-manager-collection-actions">
          <button disabled={busy || !native?.available || native.in_game} title={native?.message} onClick={() => void action(() => nativeAction('connect', []))}><RefreshCw size={16} />{native?.connected ? 'Refresh Arena' : 'Connect to Arena'}</button>
          {!native?.available ? <button disabled={busy} title="Back up decklists available in Arena’s log" onClick={() => void action(async () => {
            const result = await captureArenaDecks(); setRefresh((value) => value + 1);
            setNotice(`Captured ${result.captured} deck${result.captured === 1 ? '' : 's'}. ${result.note}${result.rejected ? ` ${result.rejected} malformed lists were skipped.` : ''}`);
          })}><RefreshCw size={16} /> Capture Arena lists</button> : null}
          <button disabled={busy} onClick={() => openCollection()}><FolderOpen size={16} /> New collection</button>
          <button className="deck-manager-add" disabled={busy} onClick={openImport}><Plus size={18} /> Add deck</button>
        </div>
      </div>
      {!modal ? feedback : null}
      {native?.in_game ? <p className="deck-manager-description">Finish your current game before connecting to Arena.</p> : null}
      {native?.pending_transfers?.length ? <div className="deck-manager-toolbar deck-manager-native-bar"><span>An interrupted transfer needs reconciliation.</span><button disabled={busy} onClick={() => void action(() => nativeAction('reconcile', []))}><RefreshCw size={16} /> Reconcile transfers</button></div> : null}
      {native?.connected ? <p className="deck-manager-description">Last refreshed: {formatDateTime(native.refreshed_at ?? '')} · Arena limit: {native.limit ?? 'unknown'}{native.limit_reached ? ' · Slots full' : ''}. Keep Arena on Decks outside a match when transferring.</p> : null}
      {view === 'arena' ? <div className="deck-manager-toolbar deck-manager-native-bar">
        <label><input type="checkbox" aria-label="Select all visible Arena decks" disabled={busy || !arenaDecks.length} checked={Boolean(arenaDecks.length) && arenaDecks.every((d) => checked.includes(d.id))} onChange={(e) => setChecked(e.target.checked ? arenaDecks.map((d) => d.id) : [])} /> Select all</label>
        <span>{checked.length} selected</span>
        <button disabled={busy || !native?.connected || Boolean(native.pending_transfers?.length)} onClick={() => void action(() => nativeAction('backup'))}><Archive size={16} />{checked.length ? 'Back up selected' : 'Back up all Arena decks'}</button>
        <button className="deck-manager-add" disabled={busy || !checked.length || !native?.deck_screen_open || Boolean(native.pending_transfers?.length)} onClick={() => { setModalOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null); setModal('store'); }}><ArrowDownToLine size={16} /> Move to collection</button>
      </div> : <div className="deck-manager-toolbar deck-manager-native-bar">
        <label><input type="checkbox" aria-label="Select all visible saved decks" disabled={busy || !visible.length} checked={Boolean(visible.length) && visible.every((d) => checked.includes(d.id))} onChange={(e) => setChecked(e.target.checked ? visible.map((d) => d.id) : [])} /> Select all</label>
        <span>{checked.length} selected</span>
        {view === 'saved' ? <><select aria-label="Move selected decks to collection" value={destination} disabled={busy || !checkedDecks.length} onChange={(event) => setDestination(event.target.value)}>{collectionOptions()}</select>
          <button disabled={busy || !checkedDecks.length} onClick={() => void action(async () => {
            const result = await moveDecksToCollection(checkedDecks.map((deck) => deck.id), destination || null);
            setChecked([]); setRefresh((value) => value + 1); setCollapsed((value) => value.filter((id) => id !== destination));
            setNotice(`Moved ${result.count} deck${result.count === 1 ? '' : 's'} to ${collectionGroups.find((group) => group.id === destination)?.name ?? 'Unsorted'}.`);
          })}><FolderOpen size={16} /> Move decks</button></> : null}
        {view === 'saved' && native?.available ? <button className="deck-manager-copy" title={!canRestoreSelection && checked.length ? 'Select native backups that are not already in Arena to restore.' : undefined} disabled={busy || !canRestoreSelection || !native.connected || !native.deck_screen_open || native.limit_reached !== false || Boolean(native.pending_transfers?.length)} onClick={() => void action(() => nativeAction('restore'))}><ArrowUpFromLine size={16} /> Restore selected to Arena</button> : null}
        <button className="deck-manager-delete" disabled={busy || !checkedDecks.length} onClick={confirmRemoval}><Trash2 size={16} />{view === 'trash' ? 'Delete selected permanently' : 'Move selected to trash'}</button>
      </div>}
      <div className={`deck-manager-decks${view === 'saved' ? ' deck-manager-collections-grid' : ''}`}>
        {view === 'arena' ? arenaDecks.map((deck) => <div key={deck.id} className="deck-manager-tile-wrapper">
          <label className="deck-manager-tile-select" title={`Select ${deck.name}`}><input className="deck-manager-tile-check" type="checkbox" aria-label={`Select ${deck.name}`} checked={checked.includes(deck.id)} disabled={busy} onChange={() => toggleChecked(deck.id)} /></label>
          <button type="button" className={`deck-manager-tile deck-manager-arena-tile${checked.includes(deck.id) ? ' deck-manager-tile-selected' : ''}`} disabled={busy} onClick={() => toggleChecked(deck.id)} aria-label={`Toggle selection of ${deck.name}`}>
          <DeckVisual deckName={deck.name} visual={deckArt(arenaArtwork.get(deck.id)?.art_card ?? deck.art_card, arenaArtwork.has(deck.id) ? null : deck.art_card_id)} />
          <span className="deck-manager-tile-text"><strong>{deck.name}</strong><small>{deck.format_name || 'Any format'} · {deck.main_count} cards</small></span>
          </button>
          {statusPills(arenaStatuses(deck.id))}
        </div>) : (view === 'trash' ? visible.map(savedTile) : collectionGroups.map((group) => {
          const decks = visible.filter((deck) => (deck.collection_id ?? '') === group.id);
          const closed = collapsed.includes(group.id);
          return <section className="deck-manager-group" key={group.id} aria-label={`${group.name} collection`}>
            <div className="deck-manager-group-heading deck-manager-toolbar">
              <button className="deck-manager-group-toggle" aria-label={`${group.name} (${decks.length})`} aria-expanded={!closed} aria-controls={`collection-${group.id || 'unsorted'}`} onClick={() => setCollapsed((value) => closed ? value.filter((id) => id !== group.id) : [...value, group.id])}>
                <ChevronDown size={18} className={closed ? 'is-collapsed' : ''} /><strong>{group.name}</strong><span>({decks.length})</span>
              </button>
              {group.id ? <><button aria-label={`Rename ${group.name}`} disabled={busy} onClick={() => openCollection(group)}><Pencil size={16} /></button>
                <button className="deck-manager-delete-quiet" aria-label={`Remove ${group.name} collection`} disabled={busy} onClick={() => { setEditingCollection(group); setModalOpener(document.activeElement as HTMLElement); setModal('remove-collection'); }}><Trash2 size={16} /></button></> : null}
            </div>
            {!closed ? <div className="deck-manager-group-decks" id={`collection-${group.id || 'unsorted'}`}>{decks.map(savedTile)}{!decks.length ? <p className="empty-state">{query || statusFilter !== 'all' ? 'No matching decks in this collection.' : 'Move decks here using the collection selector.'}</p> : null}</div> : null}
          </section>;
        }))}
      </div>
      {view === 'arena' && !arenaDecks.length ? <p className="empty-state">{native?.connected ? 'No Arena decks match your search.' : 'Open Arena’s Decks screen, then click Connect to Arena.'}</p> : null}
      {view !== 'arena' && (!library ? <p className="empty-state" role="status">Loading your collection…</p> : !visible.length ? (
        <p className="empty-state">{view === 'trash' ? 'No decks in trash.' : query ? 'No saved decks match your search.' : 'Add your first deck, or capture lists available in Arena’s log.'}</p>
      ) : null)}

      {modal ? (
        <DeckModal key={modal} title={modal === 'collection' ? editingCollection ? 'Rename collection' : 'New collection' : modal === 'remove-collection' ? `Remove ${editingCollection?.name} collection?` : modal === 'bulk-trash' ? `Move ${checkedDecks.length} decks to Trash?` : modal === 'bulk-delete' ? `Permanently delete ${checkedDecks.length} decks?` : modal === 'store' ? `Move ${checked.length} deck${checked.length === 1 ? '' : 's'} to your collection?` : modal === 'trash' ? `Move ${activeDetail?.name ?? selectedDeck?.name ?? 'saved deck'} to Trash?` : modal === 'delete' ? `Delete ${activeDetail?.name ?? selectedDeck?.name ?? 'saved deck'}?` : modal === 'deck' ? activeDetail?.name ?? selectedDeck?.name ?? 'Saved deck' : editingRevision ? 'Save a new revision' : 'Add a deck'} busy={busy} onClose={modal === 'trash' ? cancelTrash : closeModal} returnFocus={modalOpener}
          headerActions={modal === 'deck' && activeDetail ? activeDetail.native_restorable && native?.available ? <button className="deck-manager-copy" disabled={busy || !native.connected || !native.deck_screen_open || native.limit_reached !== false || Boolean(native.pending_transfers?.length) || Boolean(activeDetail.trashed_at) || inArena(activeDetail)} onClick={() => void action(() => nativeAction('restore', [activeDetail.id]))}><ArrowUpFromLine size={16} /> Restore to Arena</button> : <button className="deck-manager-copy" disabled={busy} onClick={() => void action(() => exportDeck(false))}><Copy size={16} /> Copy for Arena</button> : null}>
          {feedback}
          {modal === 'collection' ? <form className="deck-manager-import" onSubmit={(event) => { event.preventDefault(); void action(async () => {
            await saveDeckCollection(collectionName, editingCollection?.id); setRefresh((value) => value + 1); closeModal(); setNotice(editingCollection ? 'Collection renamed.' : 'Collection created.');
          }); }}>
            <label>Collection name<input autoFocus value={collectionName} maxLength={80} required onChange={(event) => setCollectionName(event.target.value)} placeholder="For example, Brawl or Blue decks" /></label>
            <div className="deck-manager-toolbar"><button type="button" disabled={busy} onClick={closeModal}>Cancel</button><button className="deck-manager-add" disabled={busy || !collectionName.trim()} type="submit">{editingCollection ? 'Save name' : 'Create collection'}</button></div>
          </form> : modal === 'remove-collection' ? <div className="deck-manager-delete-confirmation">
            <p>Remove this collection? All its decks, including decks in Trash, will move to Unsorted. Their saved revisions will be retained.</p>
            <div className="deck-manager-toolbar"><button disabled={busy} onClick={closeModal}>Cancel</button><button className="deck-manager-delete" disabled={busy || !editingCollection} onClick={() => void action(async () => {
              if (!editingCollection) return; await removeDeckCollection(editingCollection.id); setDestination(''); setImportCollection(''); setRefresh((value) => value + 1); closeModal(); setNotice('Collection removed. Its decks are in Unsorted.');
            })}>Remove collection</button></div>
          </div> : modal === 'bulk-trash' || modal === 'bulk-delete' ? <div className="deck-manager-delete-confirmation">
            <p>{modal === 'bulk-trash' ? 'These decks and all their saved revisions will move to Trash. You can restore them from the Trash tab.' : 'These decks and all their saved revisions will be permanently deleted. You cannot undo this from Trash.'}</p>
            <p className="deck-manager-description">This affects your saved collection only. Decks in Arena and recorded games remain unchanged.</p>
            <ul className="deck-manager-confirmation-list" aria-label="Decks selected for removal">{checkedDecks.map((deck) => <li key={deck.id}><strong>{deck.name}</strong><small>{deck.format_name || 'Any format'}</small></li>)}</ul>
            <div className="deck-manager-toolbar">
              <button disabled={busy} onClick={closeModal}>Cancel</button>
              <button className="deck-manager-delete" disabled={busy || !checkedDecks.length} onClick={() => void action(async () => {
                const result = await removeManagedDecks(checkedDecks.map((deck) => deck.id), modal === 'bulk-trash' ? 'trash' : 'delete');
                const removed = modal === 'bulk-delete';
                setChecked([]); setRefresh((value) => value + 1); closeModal();
                setNotice(`${result.count} deck${result.count === 1 ? '' : 's'} ${removed ? 'permanently deleted from your collection.' : 'moved to Trash. You can restore them there.'}`);
              })}><Trash2 size={16} />{busy ? modal === 'bulk-trash' ? 'Moving…' : 'Deleting…' : modal === 'bulk-trash' ? 'Move to trash' : 'Delete permanently'}</button>
            </div>
          </div> : modal === 'store' ? <div className="deck-manager-delete-confirmation">
            <p>Each selected deck is backed up and checked before it is removed from Arena. Its cards, printings and cosmetics remain in your collection. This frees Arena deck slots.</p>
            <ul className="deck-manager-confirmation-list">{(native?.decks ?? []).filter((d) => checked.includes(d.id)).map((d) => <li key={d.id}>{d.name}</li>)}</ul>
            <div className="deck-manager-toolbar"><button disabled={busy} onClick={closeModal}>Cancel</button><button className="deck-manager-add" disabled={busy || !checked.length} onClick={() => void action(() => nativeAction('store'))}><ArrowDownToLine size={16} />{busy ? 'Moving…' : 'Move to collection'}</button></div>
          </div> : modal === 'trash' ? (
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
              {!activeDetail.trashed_at ? <label>Collection<select aria-label="Deck collection" disabled={busy} value={activeDetail.collection_id ?? ''} onChange={(event) => { const target = event.target.value; void action(async () => {
                await moveDecksToCollection([activeDetail.id], target || null); setRefresh((value) => value + 1); setNotice('Deck moved to collection.');
              }); }}>{collectionOptions()}</select></label> : null}
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
              {!editingRevision ? <label>Collection<select value={importCollection} disabled={busy} onChange={(event) => setImportCollection(event.target.value)}>{collectionOptions()}</select></label> : null}
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
