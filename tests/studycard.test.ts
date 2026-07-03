import { describe, expect, it } from 'vitest'
import { cardExamples, promptCue } from '../src/components/PracticeScreen/StudyCard'
import type { ExampleSentence } from '../src/db/types'

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

describe('cardExamples — per-sense example selection (§4.8)', () => {
  // led: primary "joint" (meaningKey 0), promoted "route, trail" (meaningKey 1).
  const led: ExampleSentence[] = [
    { text: 'Han har ont i en led i knäet.', meaningKey: 0 },
    { text: 'Vi följde en led genom skogen.', meaningKey: 1 },
  ]

  it('production shows only the asked meaning — route card omits the joint sentence', () => {
    expect(cardExamples(led, undefined, 1)).toEqual(['Vi följde en led genom skogen.'])
    expect(cardExamples(led, undefined, 0)).toEqual(['Han har ont i en led i knäet.'])
  })

  it('recognition (meaningKey null) shows every meaning’s examples', () => {
    expect(cardExamples(led, undefined, null)).toEqual([led[0].text, led[1].text])
  })

  it('a meaning with no example shows nothing (never a wrong-sense sentence)', () => {
    expect(cardExamples([{ text: 'Han har ont i en led i knäet.', meaningKey: 0 }], undefined, 1)).toEqual([])
  })

  it('the user’s own custom examples are word-level and always ride along', () => {
    expect(cardExamples(led, ['Min egen mening.'], 1)).toEqual(['Vi följde en led genom skogen.', 'Min egen mening.'])
    expect(cardExamples(undefined, ['Min egen mening.'], 0)).toEqual(['Min egen mening.'])
  })
})
