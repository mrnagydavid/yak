// In-session re-queue for Practice+ drills. A MISSED word is spliced back into the working queue a few
// cards later and keeps returning until it's answered right — there is NO cap (the drill's End button is
// the exit). Pure and dependency-free (it operates on the entryId string queue), so the ordering rule is
// unit-testable without Dexie or Preact. This is a QUEUE concern only: the box model / scheduler are
// untouched — each attempt still writes the box in session.ts.

/** How many cards play before a missed word comes back (~"5 cards later"). Tunable. */
export const DRILL_REQUEUE_GAP = 5

/**
 * Where a re-queued word lands: `DRILL_REQUEUE_GAP` past the (post-advance) cursor, clamped to the
 * queue length. The clamp is what makes a missed LAST word re-appear immediately — it appends, so a
 * lone remaining word repeats back-to-back until cleared (intended under no cap).
 */
export function requeueIndexFrom(cursor: number, len: number): number {
  return Math.min(cursor + DRILL_REQUEUE_GAP, len)
}

/** Splice a missed word back into a COPY of the queue, always ahead of the live cursor so it stays valid. */
export function insertRequeue(queue: string[], cursor: number, entryId: string): string[] {
  const next = [...queue]
  next.splice(requeueIndexFrom(cursor, next.length), 0, entryId)
  return next
}
