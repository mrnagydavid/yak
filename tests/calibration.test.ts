import { describe, expect, it } from 'vitest'
import { answer, type CalibrationState, finalize, startCalibration } from '../src/srs/calibration'

// Feed a sequence of Know(true)/Don't-know(false) answers through the state machine.
function run(answers: boolean[], state: CalibrationState = startCalibration()): CalibrationState {
  for (const a of answers) state = answer(state, a)
  return state
}

const knows = (n: number) => Array<boolean>(n).fill(true)
const dunnos = (n: number) => Array<boolean>(n).fill(false)

describe('calibration band-advance (SPEC §6.4)', () => {
  it('starts at A1, not done', () => {
    const s = startCalibration()
    expect(s).toMatchObject({ level: 'A1', answered: 0, lastPassed: 'below-A1', done: false })
  })

  it('advances after 10 all-known (≥80% over ≥10 items)', () => {
    const s = run(knows(10))
    expect(s.done).toBe(false)
    expect(s.level).toBe('A2') // advanced
    expect(s.answered).toBe(0) // per-level tally reset
  })

  it('does not advance before 10 items even at 100% known', () => {
    const s = run(knows(9))
    expect(s.level).toBe('A1')
    expect(s.done).toBe(false)
  })

  it('treats exactly 80% over 10 items as a pass', () => {
    const s = run([...knows(8), ...dunnos(2)]) // 8/10 = 0.8
    expect(s.level).toBe('A2')
  })

  it('fails A1 after 30 items below 80% → claims below-A1', () => {
    const s = run([...knows(5), ...dunnos(25)]) // 5/30 well under 80%
    expect(s.done).toBe(true)
    expect(s.claimed).toBe('below-A1')
  })

  it('claims the last level passed when a later level fails', () => {
    // Pass A1 (10 known → A2), pass A2 (10 known → B1), then fail B1 (30 mostly unknown).
    const s = run([...knows(10), ...knows(10), ...knows(5), ...dunnos(25)])
    expect(s.done).toBe(true)
    expect(s.claimed).toBe('A2')
  })

  it('claims C2 when the top level is cleared', () => {
    const s = run([...knows(10), ...knows(10), ...knows(10), ...knows(10), ...knows(10), ...knows(10)])
    expect(s.done).toBe(true)
    expect(s.claimed).toBe('C2')
  })

  it('finalize on an exhausted pool: passes if the bar is met, else claims last passed', () => {
    expect(finalize(run(knows(10), startCalibration())).claimed).toBe('A1') // met bar at A1 mid-pool
    expect(finalize(run([...dunnos(5)])).claimed).toBe('below-A1') // too few/low → last passed
  })
})
