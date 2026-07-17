import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/schema'
import type { DailyLimits } from '../src/db/types'
import {
  canPushFurtherFor,
  cardKey,
  extendLimits,
  reconcileLimits,
  type SessionCard,
  type SessionMaster,
  windowMaster,
} from '../src/srs/session-composer'
import {
  clearSession,
  dayKey,
  dismissLimitNotice,
  pushFurtherSession,
  reconcileActiveSession,
} from '../src/components/PracticeScreen/session-store'

// The live daily-limits feature (SPEC §6.2): the limit is a WINDOW over a frozen master, so changing it
// mid-session re-slices in place instead of only taking effect tomorrow. Pure windowing/limit rules
// first, then the DB-backed reconcile / push-further over the real Dexie schema (fake-indexeddb).

const P = (n: number): SessionCard => ({ translationId: `p${n}`, targetEntryId: `e${n}`, skill: 'produce', mode: 'practice' })
const N = (n: number): SessionCard => ({ translationId: `n${n}`, targetEntryId: `x${n}`, skill: 'recognize', mode: 'new' })
const seq = (n: number) => Array.from({ length: n }, (_, i) => i)
const keys = (cards: SessionCard[]) => cards.map(cardKey)
const lim = (newPerDay: number, practicePerDay: number): DailyLimits => ({ newPerDay, practicePerDay })

describe('windowMaster — the daily limit as a window over the frozen master', () => {
  const master: SessionMaster = { practice: seq(100).map(P), news: [] }

  it('serves the first N practice cards', () => {
    const w = windowMaster(master, lim(0, 30))
    expect(w).toHaveLength(30)
    expect(keys(w)).toEqual(keys(seq(30).map(P)))
  })

  it('raising reveals more and keeps the earlier cards (50 → 100)', () => {
    const at50 = windowMaster(master, lim(0, 50))
    const at100 = windowMaster(master, lim(0, 100))
    expect(at50).toHaveLength(50)
    expect(at100).toHaveLength(100)
    expect(keys(at100).slice(0, 50)).toEqual(keys(at50)) // the first 50 are unchanged
  })

  it('lowering above the done count leaves only the remainder (50 → 30, 25 done → 5 left)', () => {
    const done = new Set(keys(seq(25).map(P)))
    const w = windowMaster(master, lim(0, 30), done)
    expect(w).toHaveLength(5)
    expect(keys(w)).toEqual(keys([P(25), P(26), P(27), P(28), P(29)]))
  })

  it('lowering to/below the done count ends the session (50 → 20, 25 done → none)', () => {
    const done = new Set(keys(seq(25).map(P)))
    expect(windowMaster(master, lim(0, 20), done)).toHaveLength(0)
  })

  it('dip then raise returns the identical first cards — the master is frozen (50 → 30 → 100)', () => {
    const full50 = windowMaster(master, lim(0, 50))
    windowMaster(master, lim(0, 30)) // dip
    const raised = windowMaster(master, lim(0, 100))
    expect(keys(raised).slice(0, 50)).toEqual(keys(full50))
  })

  it('windows the two budgets independently, counting done in each', () => {
    const both: SessionMaster = { practice: seq(10).map(P), news: seq(10).map(N) }
    const plain = windowMaster(both, lim(3, 5))
    expect(plain.filter((c) => c.mode === 'practice')).toHaveLength(5)
    expect(plain.filter((c) => c.mode === 'new')).toHaveLength(3)

    const done = new Set(keys([P(0), P(1), N(0)]))
    const w = windowMaster(both, lim(3, 5), done)
    expect(w.filter((c) => c.mode === 'practice')).toHaveLength(3) // 5 − 2 done
    expect(w.filter((c) => c.mode === 'new')).toHaveLength(2) // 3 − 1 done
  })
})

describe('reconcileLimits — pushed vs not pushed', () => {
  it('tracks the global up and down while not pushed (local == global)', () => {
    expect(reconcileLimits(lim(5, 50), lim(5, 50), lim(5, 100))).toEqual(lim(5, 100))
    expect(reconcileLimits(lim(5, 50), lim(5, 50), lim(5, 30))).toEqual(lim(5, 30))
  })

  it('only grows, never shrinks, a pushed budget (local > global)', () => {
    // practice pushed to 80 (global was 50): a lower/equal global is ignored, a higher one wins.
    expect(reconcileLimits(lim(5, 80), lim(5, 50), lim(5, 30))).toEqual(lim(5, 80))
    expect(reconcileLimits(lim(5, 80), lim(5, 50), lim(5, 60))).toEqual(lim(5, 80))
    expect(reconcileLimits(lim(5, 80), lim(5, 50), lim(5, 100))).toEqual(lim(5, 100))
  })

  it('decides each budget independently', () => {
    // new not pushed (5==5) tracks down to 2; practice pushed (80>50) ignores the drop to 30.
    expect(reconcileLimits(lim(5, 80), lim(5, 50), lim(2, 30))).toEqual(lim(2, 80))
  })
})

describe('extendLimits — Push further widens by a day, clamped to the master', () => {
  const master: SessionMaster = { practice: seq(100).map(P), news: seq(50).map(N) }

  it('adds one global-sized batch per budget', () => {
    expect(extendLimits(lim(5, 50), lim(5, 50), master)).toEqual(lim(10, 100))
  })

  it('never exceeds the master size (the hard daily ceiling)', () => {
    expect(extendLimits(lim(45, 90), lim(20, 50), master)).toEqual(lim(50, 100))
  })
})

describe('canPushFurtherFor', () => {
  const master: SessionMaster = { practice: seq(100).map(P), news: seq(50).map(N) }

  it('is true while any budget has room and a non-zero daily amount', () => {
    expect(canPushFurtherFor(lim(5, 50), lim(5, 50), master)).toBe(true)
    expect(canPushFurtherFor(lim(5, 100), lim(5, 50), master)).toBe(true) // practice maxed, new still has room
  })

  it('is false when both budgets are exhausted', () => {
    expect(canPushFurtherFor(lim(50, 100), lim(5, 50), master)).toBe(false)
  })

  it('does not push a budget the user zeroed out', () => {
    expect(canPushFurtherFor(lim(0, 100), lim(0, 50), master)).toBe(false) // new global 0, practice maxed
  })
})

describe('reconcileActiveSession / pushFurtherSession — live over Dexie', () => {
  async function setup(opts: {
    global: DailyLimits
    local: DailyLimits
    master: SessionMaster
    cards: SessionCard[]
    index: number
  }): Promise<void> {
    await db.profiles.clear()
    await db.activeSessions.clear()
    clearSession()
    const now = Date.now()
    await db.profiles.add({
      id: 'prof',
      learnerLang: 'en',
      targetLang: 'sv',
      claimedLevel: 'A1',
      dailyLimits: opts.global,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.activeSessions.put({
      id: 'active',
      profileId: 'prof',
      dayKey: dayKey(now),
      cards: opts.cards,
      index: opts.index,
      canPushFurther: true,
      master: opts.master,
      localLimits: opts.local,
      limitChangeNotice: false,
      updatedAt: now,
    })
  }

  const rec = () => db.activeSessions.get('active')

  beforeEach(async () => {
    await db.profiles.clear()
    await db.activeSessions.clear()
    clearSession()
  })

  it('shrinks today when the global is lowered (not pushed), keeping the cursor and done work', async () => {
    const master: SessionMaster = { practice: seq(50).map(P), news: [] }
    await setup({ global: lim(0, 50), local: lim(0, 50), master, cards: seq(50).map(P), index: 25 })

    await reconcileActiveSession(lim(0, 50), lim(0, 30))

    const r = await rec()
    expect(r!.localLimits).toEqual(lim(0, 30))
    expect(r!.cards).toHaveLength(30) // 25 done + 5 more
    expect(r!.index).toBe(25) // cursor untouched
    expect(keys(r!.cards).slice(0, 25)).toEqual(keys(seq(25).map(P))) // prefix preserved verbatim
    expect(r!.limitChangeNotice).toBe(false) // it landed today
  })

  it('ends the session when the new limit is at/below the done count', async () => {
    const master: SessionMaster = { practice: seq(50).map(P), news: [] }
    await setup({ global: lim(0, 50), local: lim(0, 50), master, cards: seq(50).map(P), index: 25 })

    await reconcileActiveSession(lim(0, 50), lim(0, 20))

    const r = await rec()
    expect(r!.cards).toHaveLength(25) // just the done ones → index (25) >= length → caught up
    expect(r!.index).toBe(25)
  })

  it('extends today when the global is raised (not pushed)', async () => {
    const master: SessionMaster = { practice: seq(100).map(P), news: [] }
    await setup({ global: lim(0, 50), local: lim(0, 50), master, cards: seq(50).map(P), index: 25 })

    await reconcileActiveSession(lim(0, 50), lim(0, 100))

    const r = await rec()
    expect(r!.localLimits).toEqual(lim(0, 100))
    expect(r!.cards).toHaveLength(100)
    expect(keys(r!.cards).slice(0, 50)).toEqual(keys(seq(50).map(P))) // first 50 unchanged
    expect(r!.limitChangeNotice).toBe(false)
  })

  it('does not shrink a pushed session, and flags the banner instead', async () => {
    const master: SessionMaster = { practice: seq(100).map(P), news: [] }
    // Pushed: local practice (100) is above the global (50).
    await setup({ global: lim(0, 50), local: lim(0, 100), master, cards: seq(100).map(P), index: 60 })

    await reconcileActiveSession(lim(0, 50), lim(0, 30))

    const r = await rec()
    expect(r!.localLimits).toEqual(lim(0, 100)) // unchanged — a lower global can't shrink a push
    expect(r!.cards).toHaveLength(100)
    expect(r!.limitChangeNotice).toBe(true) // change only applies tomorrow → banner
  })

  it('push-further widens within the master, caps at its size, and stops when exhausted', async () => {
    const master: SessionMaster = { practice: seq(100).map(P), news: [] }
    // Caught up at 50/50.
    await setup({ global: lim(0, 50), local: lim(0, 50), master, cards: seq(50).map(P), index: 50 })

    const first = await pushFurtherSession()
    expect(first).not.toBeNull()
    expect(first!.index).toBe(50) // continues from where you were
    expect(first!.cards).toHaveLength(100) // 50 done + 50 revealed
    expect(first!.canPushFurther).toBe(false) // master exhausted (100/100)

    const r = await rec()
    expect(r!.localLimits).toEqual(lim(0, 100))

    // Nothing left to reveal → a second push is a no-op.
    expect(await pushFurtherSession()).toBeNull()
  })

  it('is a no-op on a record with no master (composed before the feature)', async () => {
    await db.profiles.clear()
    await db.activeSessions.clear()
    const now = Date.now()
    await db.profiles.add({
      id: 'prof',
      learnerLang: 'en',
      targetLang: 'sv',
      claimedLevel: 'A1',
      dailyLimits: lim(0, 50),
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.activeSessions.put({
      id: 'active',
      profileId: 'prof',
      dayKey: dayKey(now),
      cards: seq(50).map(P),
      index: 25,
      canPushFurther: true,
      updatedAt: now,
    })

    await reconcileActiveSession(lim(0, 50), lim(0, 10))

    const r = await rec()
    expect(r!.cards).toHaveLength(50) // untouched
    expect(r!.localLimits).toBeUndefined()
  })

  it('dismissLimitNotice clears the flag', async () => {
    const master: SessionMaster = { practice: seq(10).map(P), news: [] }
    await setup({ global: lim(0, 50), local: lim(0, 50), master, cards: seq(10).map(P), index: 0 })
    await db.activeSessions.update('active', { limitChangeNotice: true })

    await dismissLimitNotice()

    expect((await rec())!.limitChangeNotice).toBe(false)
  })

  it('reconcile is a no-op when there is no active profile', async () => {
    await db.profiles.clear()
    await expect(reconcileActiveSession(lim(0, 50), lim(0, 10))).resolves.toBeUndefined()
  })
})
