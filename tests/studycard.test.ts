import { describe, expect, it } from 'vitest'
import { promptCue } from '../src/components/PracticeScreen/StudyCard'

describe('promptCue — homonym sense cue (SPEC §7.2)', () => {
  const examples = ['Jag gick ut, fast det regnade.', 'Bordet står fast.']

  it('cues the first example for an ambiguous word in recognition', () => {
    expect(promptCue(examples, true, true)).toBe(examples[0])
  })

  it('no cue for an unambiguous word (examples show only on the reveal)', () => {
    expect(promptCue(examples, false, true)).toBeUndefined()
  })

  it('no cue in production even when ambiguous (the native prompt is already distinct)', () => {
    expect(promptCue(examples, true, false)).toBeUndefined()
  })

  it('no cue when there are no examples', () => {
    expect(promptCue([], true, true)).toBeUndefined()
  })
})
