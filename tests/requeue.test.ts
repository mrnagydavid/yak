import { describe, expect, it } from 'vitest'
import type { PracticeCardView } from '../src/db/queries'
import {
  dropRequeue,
  insertRequeue,
  mayRequeue,
  requeueIndexFrom,
} from '../src/components/PracticeScreen/requeue'

// requeue.ts imports only the PracticeCardView TYPE (erased at build), so this is a pure unit test —
// no Dexie/preact/DOM — like the suite's other split-out helper tests (search, session-store).

describe('requeueIndexFrom — where a re-queued clone lands', () => {
  it('drops the clone REQUEUE_GAP cards past the (post-advance) cursor mid-queue', () => {
    expect(requeueIndexFrom(1, 20)).toBe(6) // cursor 1 + gap 5
  })

  it('clamps to the queue length near the end — a failed LAST card appends and repeats at once', () => {
    // Rate the last card (index 9, len 10): post-advance cursor 10 → clamp to 10 → appended, and
    // since the cursor is now 10 it's the immediate next card, so it repeats right away.
    expect(requeueIndexFrom(10, 10)).toBe(10)
    expect(requeueIndexFrom(9, 10)).toBe(10) // even a few from the end clamps in
  })
})

describe('mayRequeue — the boredom cap', () => {
  it('treats an untagged (first-shown) card as show 1', () => {
    expect(mayRequeue(undefined)).toBe(true)
  })

  it('allows re-queues up to, and stops at, REQUEUE_MAX_SHOWS (5)', () => {
    expect(mayRequeue(4)).toBe(true) // shown 4× → one more allowed (its 5th)
    expect(mayRequeue(5)).toBe(false) // shown 5× → capped, rests on its real due date
  })
})

// Minimal stand-in views — only the field the queue helpers read.
const v = (requeueId?: string) => ({ requeueId }) as unknown as PracticeCardView

describe('insertRequeue — splicing the clone in', () => {
  it('inserts at the gap offset and leaves the cards before it (the live cursor) untouched', () => {
    const views = [v('a'), v('b'), v('c')]
    const clone = v('clone')
    const out = insertRequeue(views, 1, clone) // cursor 1 → min(1+5, 3) = 3 → appended
    expect(out).toHaveLength(4)
    expect(out[3].requeueId).toBe('clone')
    expect(out.slice(0, 3)).toEqual(views) // originals in place, source array not mutated
    expect(views).toHaveLength(3)
  })

  it('places the clone GAP cards ahead when the queue is long enough', () => {
    const views = Array.from({ length: 20 }, (_, i) => v(`c${i}`))
    const out = insertRequeue(views, 2, v('clone'))
    expect(out[7].requeueId).toBe('clone') // min(2+5, 20) = 7
  })
})

describe('dropRequeue — Undo removing the clone', () => {
  it('removes exactly the clone with the given id, keeping the rest in order', () => {
    const out = dropRequeue([v('a'), v('clone'), v('b')], 'clone')
    expect(out.map((x) => x.requeueId)).toEqual(['a', 'b'])
  })

  it('is a no-op when the id is already gone (robust under out-of-order clones)', () => {
    const views = [v('a'), v('b')]
    expect(dropRequeue(views, 'missing')).toEqual(views)
  })
})
