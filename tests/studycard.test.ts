import { describe, expect, it } from 'vitest'
import { cardExamples, productionDisambig, promptCue, promptTranslation } from '../src/components/PracticeScreen/StudyCard'
import type { ExampleSentence } from '../src/db/types'

describe('promptTranslation — override-aware English for a solo card (SPEC §4.2)', () => {
  it('uses the seed native lemma when there is no override', () => {
    expect(promptTranslation('feed')).toBe('feed')
    expect(promptTranslation('feed', undefined)).toBe('feed')
  })

  it('uses the user override when set — the production-prompt bug: it used to show the seed word', () => {
    expect(promptTranslation('feed', 'nourish')).toBe('nourish')
  })

  it('ignores a blank/whitespace override', () => {
    expect(promptTranslation('feed', '   ')).toBe('feed')
    expect(promptTranslation('feed', '')).toBe('feed')
  })
})

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

describe('productionDisambig — trim the sense gloss against the rendered prompt', () => {
  it('drops the gloss entirely when the prompt already discloses the POS (verb "to", noun "a/an")', () => {
    // "to link" over "(to link (verb))" — the "to" already says verb; the gloss is pure repetition.
    expect(productionDisambig('to link', 'to link (verb)')).toBeUndefined()
    expect(productionDisambig('a risk', 'a risk (noun)')).toBeUndefined()
    expect(productionDisambig('an individual', 'an individual (noun)')).toBeUndefined()
    expect(productionDisambig('to cost', 'to cost (verb)')).toBeUndefined()
  })

  it('keeps only the POS tag when the prompt renders bare (adj/adv/prep, uncountable noun)', () => {
    // "early" is both adj and adv and renders the same either way, so the POS tag is the sole cue.
    expect(productionDisambig('early', 'early (adj)')).toBe('adj')
    expect(productionDisambig('early', 'early (adv)')).toBe('adv')
    expect(productionDisambig('around', 'around (prep)')).toBe('prep')
    expect(productionDisambig('water', 'water (noun)')).toBe('noun') // uncountable → no article to disclose it
  })

  it('leaves a semantic gloss untouched (it carries meaning the prompt does not)', () => {
    expect(productionDisambig('hand', 'hand (of a clock)')).toBe('hand (of a clock)')
    expect(productionDisambig('around', 'approximately')).toBe('approximately')
    expect(productionDisambig('around', 'all around (adv)')).toBe('all around (adv)') // phrase ≠ prompt → kept whole
  })

  it('returns undefined for an empty/absent gloss', () => {
    expect(productionDisambig('to link', undefined)).toBeUndefined()
    expect(productionDisambig('to link', '')).toBeUndefined()
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
