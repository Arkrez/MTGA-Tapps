import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

function pageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, 'end', total];
  if (current >= total - 3) return [1, 'start', total - 4, total - 3, total - 2, total - 1, total];
  return [1, 'start', current - 1, current, current + 1, 'end', total];
}

export function TablePagination({
  caption, currentPage, pageCount, pageSize, totalRows, fullControls, onPageChange,
}: {
  caption: string;
  currentPage: number;
  pageCount: number;
  pageSize: number;
  totalRows: number;
  fullControls: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <nav className={fullControls ? 'table-pagination table-pagination-full' : 'table-pagination'} aria-label={`${caption} pagination`}>
      <div className="table-pagination-summary" aria-live="polite" aria-atomic="true">
        <p>Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, totalRows)} of {totalRows}</p>
        {fullControls ? <p>Page {currentPage} of {pageCount}</p> : null}
      </div>
      <div className="table-pagination-actions">
        <div className="table-pagination-controls">
          {fullControls ? (
            <button type="button" aria-label="First page" title="First page" disabled={currentPage === 1} onClick={() => onPageChange(1)}>
              <ChevronsLeft aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" aria-label="Previous page" title="Previous page" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)}>
            <ChevronLeft aria-hidden="true" />
          </button>
          {fullControls ? pageNumbers(currentPage, pageCount).map((page) => (
            typeof page === 'number' ? (
              <button
                key={page}
                type="button"
                className={page === currentPage ? 'table-page-current' : undefined}
                aria-label={`Page ${page}`}
                aria-current={page === currentPage ? 'page' : undefined}
                onClick={() => onPageChange(page)}
              >
                {page}
              </button>
            ) : <span key={page} className="table-page-ellipsis" aria-hidden="true">…</span>
          )) : <span>Page {currentPage} of {pageCount}</span>}
          <button type="button" aria-label="Next page" title="Next page" disabled={currentPage === pageCount} onClick={() => onPageChange(currentPage + 1)}>
            <ChevronRight aria-hidden="true" />
          </button>
          {fullControls ? (
            <button type="button" aria-label="Last page" title="Last page" disabled={currentPage === pageCount} onClick={() => onPageChange(pageCount)}>
              <ChevronsRight aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {fullControls ? (
          <form
            key={`${currentPage}-${pageCount}`}
            className="table-pagination-jump"
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem('page') as HTMLInputElement;
              const page = input.valueAsNumber;
              if (Number.isInteger(page) && page >= 1 && page <= pageCount) onPageChange(page);
            }}
          >
            <label>
              Go to page
              <input name="page" type="number" min={1} max={pageCount} step={1} defaultValue={currentPage} required />
            </label>
            <button type="submit">Go</button>
          </form>
        ) : null}
      </div>
    </nav>
  );
}
