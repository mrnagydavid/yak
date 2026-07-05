import { describe, expect, it } from 'vitest'
import { boxWeight, isSolid, nextBox, SOLID_BOX } from '../src/drills/box'

describe('drill box model', () => {
  it('promotes on a pass, resets to 0 on a fail', () => {
    expect(nextBox(0, true)).toBe(1)
    expect(nextBox(3, true)).toBe(4)
    expect(nextBox(4, false)).toBe(0)
    expect(nextBox(0, false)).toBe(0)
  })

  it('marks a word solid at (not below) the threshold', () => {
    expect(isSolid(SOLID_BOX - 1)).toBe(false)
    expect(isSolid(SOLID_BOX)).toBe(true)
    expect(isSolid(SOLID_BOX + 5)).toBe(true)
  })

  it('weights low boxes highest, decays monotonically, and never reaches zero', () => {
    expect(boxWeight(0)).toBeGreaterThan(boxWeight(1))
    expect(boxWeight(1)).toBeGreaterThan(boxWeight(2))
    expect(boxWeight(2)).toBeGreaterThan(boxWeight(10))
    expect(boxWeight(10)).toBeGreaterThan(0) // mastered words thin out but never drop out
  })
})
