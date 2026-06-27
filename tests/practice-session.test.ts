import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearSession,
  dayKey,
  isResumableRecord,
  resumableSession,
  saveSession,
  setSessionIndex,
} from '../src/components/PracticeScreen/session-store'
import type { ActiveSessionRecord } from '../src/db/types'

describe('practice session store — resume across tab switches', () => {
  beforeEach(() => clearSession())

  it('has nothing to resume initially', () => {
    expect(resumableSession()).toBeNull()
  })

  it('resumes a session saved today at its current position', () => {
    saveSession({ dayKey: dayKey(), views: [], index: 2, canPushFurther: true })
    expect(resumableSession()?.index).toBe(2)
  })

  it('discards a session from a previous day (recompose)', () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000
    saveSession({ dayKey: dayKey(yesterday), views: [], index: 1, canPushFurther: false })
    expect(resumableSession()).toBeNull()
  })

  it('persists the advancing cursor', () => {
    saveSession({ dayKey: dayKey(), views: [], index: 0, canPushFurther: true })
    setSessionIndex(3)
    expect(resumableSession()?.index).toBe(3)
  })
})

describe('isResumableRecord — persisted session gate (refresh recovery)', () => {
  const record = (over: Partial<ActiveSessionRecord> = {}): ActiveSessionRecord => ({
    id: 'active',
    profileId: 'p1',
    dayKey: dayKey(),
    cards: [],
    index: 0,
    canPushFurther: true,
    updatedAt: Date.now(),
    ...over,
  })

  it('resumes when profile and day both match', () => {
    expect(isResumableRecord(record(), 'p1')).toBe(true)
  })

  it('rejects a missing record', () => {
    expect(isResumableRecord(undefined, 'p1')).toBe(false)
  })

  it('rejects a record from a previous day', () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000
    expect(isResumableRecord(record({ dayKey: dayKey(yesterday) }), 'p1')).toBe(false)
  })

  it('rejects a record from a different profile', () => {
    expect(isResumableRecord(record({ profileId: 'p2' }), 'p1')).toBe(false)
  })
})
