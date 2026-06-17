import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearSession,
  dayKey,
  resumableSession,
  saveSession,
  setSessionIndex,
} from '../src/components/PracticeScreen/session-store'

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
