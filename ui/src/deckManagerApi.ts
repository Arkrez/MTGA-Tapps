export interface ManagedCard {
  section: string;
  quantity: number;
  name: string;
  arena_id: number | null;
  set_code: string | null;
  collector_number: string | null;
}

export interface ManagedDeck {
  id: string;
  name: string;
  format_name: string;
  notes: string;
  tags: string[];
  current_revision_id: string;
  trashed_at: string | null;
  saved_at: string;
  updated_at: string;
  source: string;
  completeness: string;
  main_count: number;
  art_card: string | null;
}

export interface ManagedDeckDetail extends ManagedDeck {
  revision_id: string;
  deck: { name: string; format_name: string; cards: ManagedCard[]; import_text: string | null; source: string; completeness: string };
  revisions: { id: string; created_at: string; source: string; content_hash: string }[];
}

export interface DeckLibrary {
  decks: ManagedDeck[];
  capabilities: { arena_transfers: boolean; native_section: boolean; capacity: number | null; message: string };
}

async function request<T>(path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/deck-manager${path}`, payload === undefined ? { signal } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal,
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Deck Manager returned ${response.status}`);
  return body;
}

export const fetchDeckLibrary = (signal?: AbortSignal) => request<DeckLibrary>('', undefined, signal);
export const fetchManagedDeck = (id: string, revision?: string, signal?: AbortSignal) =>
  request<ManagedDeckDetail>(`/deck?${new URLSearchParams({ id, ...(revision ? { revision } : {}) })}`, undefined, signal);
export const importManagedDeck = (text: string, name: string, format_name: string, deck_id?: string) =>
  request<ManagedDeckDetail>('/import', { text, name, format_name, deck_id });
export const updateManagedDeck = (id: string, fields: { notes?: string; tags?: string[]; trashed?: boolean }) =>
  request<{ ok: boolean }>('/update', { id, ...fields });
export const captureArenaDecks = () => request<{ captured: number; rejected: number; note: string }>('/capture', {});
export const exportManagedDeck = (id: string, revision: string, format: 'backup' | 'arena') =>
  request<{ text: string; name: string; extension: string; note?: string }>(`/export?${new URLSearchParams({ id, revision, format })}`);
