import type { PracticeCardView } from '../../db/queries'

// In-session relearning re-queue. A card the learner didn't know yet — practice "Didn't know", or a
// new word's "New to me" — is spliced back into the session queue a few cards later and keeps
// returning until graded anything else, capped so it can't drill forever. This is PURE queue
// behavior: the FSRS scheduler is untouched (it already sets the card's real cross-session due date;
// "a few cards later" is an ordering concern, not a scheduling one). Split out from PracticeScreen so
// the queue rules stay dependency-free and unit-testable (imports only the erased view TYPE).

/** Cards to advance past before a re-queued card returns (~"5 cards later"). */
export const REQUEUE_GAP = 5

/** Total times one card may be shown in a sitting (first show + re-queues) — the boredom cap. */
export const REQUEUE_MAX_SHOWS = 5

/** Where a re-queued clone lands: REQUEUE_GAP past the (post-advance) cursor, clamped to the queue
 *  length. The clamp is what makes a failed LAST card append and repeat immediately. */
export function requeueIndexFrom(cursor: number, len: number): number {
  return Math.min(cursor + REQUEUE_GAP, len)
}

/** May a card already shown `shows` times be re-queued once more? An untagged card is its first show. */
export function mayRequeue(shows: number | undefined): boolean {
  return (shows ?? 1) < REQUEUE_MAX_SHOWS
}

/** Splice a re-queued clone into a copy of the queue at the gap offset. Cards before it are untouched,
 *  so the live cursor stays valid (the insert is always ahead of it). */
export function insertRequeue(
  views: PracticeCardView[],
  cursor: number,
  clone: PracticeCardView,
): PracticeCardView[] {
  const next = [...views]
  next.splice(requeueIndexFrom(cursor, next.length), 0, clone)
  return next
}

/** Remove the clone with this id (Undo reversing the rating that spliced it). Identity match, not a
 *  position, so it's robust to other clones spliced in between; a no-op if the clone is already gone. */
export function dropRequeue(views: PracticeCardView[], requeueId: string): PracticeCardView[] {
  return views.filter((v) => v.requeueId !== requeueId)
}
