/** "backRankMate" → "Back Rank Mate" */
export function prettify(s: string): string {
  return s.replace(/([A-Z])/g, " $1").replace(/([0-9]+)/g, " $1").replace(/^./, (c) => c.toUpperCase()).replace(/\s+/g, " ").trim();
}
