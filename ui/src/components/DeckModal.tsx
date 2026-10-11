import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Native modal dialog shared by Deck Manager and Deck Finder. */
export function DeckModal({ title, busy, onClose, returnFocus, headerActions, wide = false, children }: {
  title: string; busy: boolean; onClose: () => void; returnFocus: HTMLElement | null; headerActions?: ReactNode; wide?: boolean; children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = returnFocus ?? document.activeElement;
    const root = document.documentElement;
    const overflow = document.body.style.overflow;
    const gutter = root.style.scrollbarGutter;
    // Hiding the page scrollbar would widen the layout and shift every tile;
    // keep its space reserved while the page is locked.
    if (window.innerWidth > root.clientWidth) root.style.scrollbarGutter = 'stable';
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      root.style.scrollbarGutter = gutter;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [returnFocus]);

  return (
    <dialog
      ref={dialogRef}
      className={wide ? 'deck-manager-modal deck-manager-modal-wide' : 'deck-manager-modal'}
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
