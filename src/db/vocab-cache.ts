// A process-lifetime cache for the compiled Vocabulary list.
//
// The list is assembled from the whole language (~8.5k entries plus their translations, review states
// and notes) — several sequential IndexedDB reads and a handful of Maps. `useLiveQuery` redid all of
// that on every screen mount, so each time the user opened Vocabulary they paid the full compile
// again. This module compiles it once, lazily, and keeps the result until something the list actually
// depends on changes — so re-opening the screen serves the cached rows instantly.
//
// It caches the DATA, not the rendered DOM: the screen still re-renders its rows on each mount. And it
// stays framework-agnostic (plain subscribe / snapshot) — the tiny Preact hook lives in the screen.
import { getActiveProfile, listVocabulary, type VocabRow } from './queries'
import { db } from './schema'
import type { Profile } from './types'

export interface VocabData {
  profile: Profile | undefined
  rows: VocabRow[]
}

let current: VocabData | undefined // latest compiled value; the synchronous snapshot
let inFlight: Promise<void> | undefined // guards against overlapping recompiles
let dirty = true // start dirty so the first read compiles
let scheduled = false // at most one deferred refresh queued while the screen is mounted
const listeners = new Set<() => void>()

function notify(): void {
  for (const cb of listeners) cb()
}

async function recompute(): Promise<void> {
  try {
    const profile = await getActiveProfile()
    const rows = profile ? await listVocabulary(profile.targetLang, profile.claimedLevel) : []
    current = { profile, rows }
  } finally {
    inFlight = undefined
  }
  notify()
  // A write that landed mid-recompute flipped `dirty` again — redo it if anyone's still watching.
  if (dirty && listeners.size > 0) refresh()
}

function refresh(): void {
  if (inFlight) return
  dirty = false // cleared up front, so a write during the read re-marks us dirty
  inFlight = recompute()
}

// Called from the Dexie write hooks (below), once per changed row. Kept O(1) and read-free so it's
// safe to run inside a write transaction. When the screen is mounted we refresh so the visible list
// stays live, but on a deferred tick (after the transaction commits) and coalesced across a burst of
// writes — a seed import fires this thousands of times and must trigger at most one recompile. When
// nothing is watching we just remember the cache is stale and recompile on the next open.
function markDirty(): void {
  dirty = true
  if (listeners.size > 0 && !scheduled) {
    scheduled = true
    setTimeout(() => {
      scheduled = false
      refresh()
    }, 0)
  }
}

/** Subscribe to cache updates; refreshes a stale cache. Returns an unsubscribe fn. */
export function subscribeVocab(onChange: () => void): () => void {
  listeners.add(onChange)
  if (dirty) refresh()
  return () => {
    listeners.delete(onChange)
  }
}

/** The current compiled value, or `undefined` before the first compile resolves. */
export function getVocabSnapshot(): VocabData | undefined {
  return current
}

// Any write to a table the list is built from invalidates the cache. Block bodies (not `() =>
// markDirty()`) so the hooks return `undefined` — Dexie's creating/updating hooks treat a returned
// value as a key/modification, which we must not do.
const WATCHED = [db.entries, db.entryOverlays, db.translations, db.reviewStates, db.profiles]
for (const table of WATCHED) {
  table.hook('creating', () => {
    markDirty()
  })
  table.hook('updating', () => {
    markDirty()
  })
  table.hook('deleting', () => {
    markDirty()
  })
}
