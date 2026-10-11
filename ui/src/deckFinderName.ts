/** The deck name the exported text gives Arena (its About/Name line), e.g. "Lizards (Ash)". */
export function exportedDeckName(deckText: string | null | undefined, fallback: string): string {
  const match = /^\s*About\s*\n\s*Name\s+(.+?)\s*$/imu.exec(deckText ?? '');
  return match?.[1] || fallback;
}
