/**
 * The « / » collapse control shared by the dashboard sidebar and the replay
 * Actions panel. A panel on the left collapses leftward («) and reopens
 * rightward (»); a panel on the right mirrors that.
 */
interface CollapseToggleProps {
  collapsed: boolean;
  /** Which edge of the layout the panel sits on. */
  side: 'left' | 'right';
  /** What the panel holds, for the accessible name ("Hide navigation"). */
  label: string;
  className: string;
  title?: string;
  onToggle: () => void;
}

export function CollapseToggle({ collapsed, side, label, className, title, onToggle }: CollapseToggleProps) {
  const glyph = (side === 'left') === collapsed ? '»' : '«';
  return (
    <button
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? 'Show' : 'Hide'} ${label}`}
      className={className}
      title={title}
      type="button"
      onClick={onToggle}
    >
      {glyph}
    </button>
  );
}
