// Leitner-lite progress for Practice+ drills. No FSRS, no due dates: a single integer "box" per
// (word, drill) is the whole model. A right answer promotes the word one box; a wrong answer sends it
// back to box 0. The picker (see picker.ts) weights low boxes highest, so struggling and unseen words
// dominate a session while mastered ones show up increasingly rarely — but never drop out entirely.

/** A word at or above this box counts as "solid" for the hub's mastery readout. */
export const SOLID_BOX = 3

// How fast a word's selection weight decays per box above 0. 0.45 → each box up is ~half as likely
// as the one below it, so mastered words thin out fast but keep a small, permanent tail.
const BOX_DECAY = 0.45

/** The word's new box after an answer: promote on pass, reset to 0 on fail. */
export function nextBox(box: number, correct: boolean): number {
  return correct ? box + 1 : 0
}

/** Whether a box level counts as mastered (for the mastery count). */
export function isSolid(box: number): boolean {
  return box >= SOLID_BOX
}

/**
 * Selection weight for a word at box `box`. An unseen word is treated as box 0 by the caller, so it
 * shares the top weight with freshly-failed words. The weight decays geometrically with the box but
 * stays strictly positive — a mastered word is rare, never excluded.
 */
export function boxWeight(box: number): number {
  return BOX_DECAY ** Math.max(0, box)
}
