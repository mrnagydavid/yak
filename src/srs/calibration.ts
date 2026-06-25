import type { Cefr, Profile } from '../db/types'

// The explicit calibration sweep (SPEC §6.4), as a pure state machine so the band-advance rule is
// unit-testable without a DOM/DB. The component owns drawing words and seeding SRS state; this only
// decides, after each Know/Don't-know answer, whether to keep going, advance a level, or stop.

export type ClaimedLevel = Profile['claimedLevel'] // 'below-A1' | 'A1' … 'C2'

const ORDER: Cefr[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

export const CALIBRATION = {
  minItems: 10, // need at least this many answers before a level can pass
  maxItems: 30, // give up on a level after this many
  passRate: 0.8, // ≥80% known to advance
}

export interface CalibrationState {
  level: Cefr // the level currently being tested
  known: number // Know answers at this level
  answered: number // total answers at this level
  lastPassed: ClaimedLevel // highest level passed so far ('below-A1' = none yet)
  done: boolean
  claimed?: ClaimedLevel // the result, set once done
}

export function startCalibration(): CalibrationState {
  return { level: 'A1', known: 0, answered: 0, lastPassed: 'below-A1', done: false }
}

function pass(state: CalibrationState, known: number, answered: number): CalibrationState {
  const passed = state.level as ClaimedLevel
  const idx = ORDER.indexOf(state.level)
  // Cleared the top level → finish at C2; otherwise advance and reset the per-level tally (the
  // component redraws words for the new level).
  if (idx === ORDER.length - 1) {
    return { ...state, known, answered, lastPassed: passed, done: true, claimed: passed }
  }
  return { level: ORDER[idx + 1], known: 0, answered: 0, lastPassed: passed, done: false }
}

/** Apply one Know/Don't-know answer and return the next state. */
export function answer(state: CalibrationState, known: boolean): CalibrationState {
  if (state.done) return state
  const answered = state.answered + 1
  const knownCount = state.known + (known ? 1 : 0)
  const rate = knownCount / answered

  if (answered >= CALIBRATION.minItems && rate >= CALIBRATION.passRate) return pass(state, knownCount, answered)
  // Out of attempts at this level without passing → stop, claim the last level passed.
  if (answered >= CALIBRATION.maxItems) return { ...state, known: knownCount, answered, done: true, claimed: state.lastPassed }
  return { ...state, known: knownCount, answered }
}

/** Force a decision when the word pool for a level runs out before maxItems (large pools make this
 *  rare). Passes if the level already met the bar, else claims the last level passed. */
export function finalize(state: CalibrationState): CalibrationState {
  if (state.done) return state
  const rate = state.answered > 0 ? state.known / state.answered : 0
  if (state.answered >= CALIBRATION.minItems && rate >= CALIBRATION.passRate) {
    return { ...state, done: true, claimed: state.level as ClaimedLevel }
  }
  return { ...state, done: true, claimed: state.lastPassed }
}
