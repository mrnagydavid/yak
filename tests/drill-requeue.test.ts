import { describe, expect, it } from 'vitest'
import { DRILL_REQUEUE_GAP, insertRequeue, requeueIndexFrom } from '../src/drills/requeue'

// Pure queue-ordering rules for the in-session re-queue (missed word returns until cleared, no cap).

describe('requeueIndexFrom', () => {
  it('lands GAP past the cursor when there is room', () => {
    expect(requeueIndexFrom(2, 20)).toBe(2 + DRILL_REQUEUE_GAP)
  })

  it('clamps to the queue length so a missed last word re-appears immediately (appends)', () => {
    expect(requeueIndexFrom(19, 20)).toBe(20)
    expect(requeueIndexFrom(1, 1)).toBe(1)
  })
})

describe('insertRequeue', () => {
  it('splices the word back in a few cards later without touching what came before', () => {
    const queue = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    // Answered 'b' at index 1 → cursor now 2; re-queue lands at min(2+5, 8) = 7.
    const next = insertRequeue(queue, 2, 'b')
    expect(next).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'b', 'h'])
    expect(queue).toHaveLength(8) // original untouched (pure)
  })

  it('appends when the gap runs past the end (lone remaining word repeats next)', () => {
    expect(insertRequeue(['a'], 1, 'a')).toEqual(['a', 'a'])
  })
})
