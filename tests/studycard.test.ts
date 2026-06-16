import { describe, expect, it } from 'vitest'
import { splitExamples } from '../src/components/PracticeScreen/StudyCard'

describe('splitExamples — homonym sense cue (SPEC §7.2)', () => {
  const examples = ['Jag gick ut, fast det regnade.', 'Bordet står fast.']

  it('puts the first example on the prompt for an ambiguous word in recognition', () => {
    const { promptExample, revealExamples } = splitExamples(examples, true, true)
    expect(promptExample).toBe(examples[0])
    expect(revealExamples).toEqual([examples[1]])
  })

  it('shows no prompt cue for an unambiguous word (all examples on reveal)', () => {
    const { promptExample, revealExamples } = splitExamples(examples, false, true)
    expect(promptExample).toBeUndefined()
    expect(revealExamples).toEqual(examples)
  })

  it('shows no prompt cue in production even when ambiguous (native prompt is distinct)', () => {
    const { promptExample, revealExamples } = splitExamples(examples, true, false)
    expect(promptExample).toBeUndefined()
    expect(revealExamples).toEqual(examples)
  })

  it('handles a word with no examples', () => {
    expect(splitExamples([], true, true)).toEqual({ revealExamples: [] })
  })
})
