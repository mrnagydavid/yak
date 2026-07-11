import { describe, expect, it } from 'vitest'
import { enRenderer } from '../src/lang/en/render'
import type { Entry } from '../src/db/types'
// The seed-side collision model must articleize a production prompt EXACTLY as the app renders it, or the
// checker/deletion would classify slots on a different string than the learner sees. This guards that
// scripts/seed/lib/glossModel.mjs::articleizeToken stays in lockstep with src/lang/en/render.ts.
import { articleizeToken, buildSlots, findCardClashes, isEchoGloss, isPosTagGloss, slotTokens } from '../scripts/seed/lib/glossModel.mjs'

const entry = (lemma: string, pos: string, features: Record<string, string> = {}): Entry =>
  ({ lemma, pos, features } as unknown as Entry)

// Exercises every articleize branch: verb "to", the a/an letter rule, the sound-word overrides, and the
// bare cases (uncountable, proper, adjective, already-articled).
const CASES: Array<[string, string, Record<string, string>]> = [
  ['run', 'verb', {}],
  ['give birth', 'verb', {}],
  ['book', 'noun', {}],
  ['apple', 'noun', {}],
  ['hour', 'noun', {}], // silent h → "an"
  ['unit', 'noun', {}], // /juː/ → "a"
  ['university', 'noun', {}],
  ['euro', 'noun', {}],
  ['heir', 'noun', {}],
  ['water', 'noun', { countable: 'no' }], // uncountable → bare
  ['May', 'noun', { proper: 'yes' }], // proper → bare
  ['English', 'noun', { proper: 'yes' }],
  ['early', 'adj', {}],
  ['quickly', 'adv', {}],
  ['a bow', 'noun', {}], // already articled → unchanged
]

describe('glossModel articleize mirrors src/lang/en/render.ts', () => {
  for (const [lemma, pos, features] of CASES) {
    it(`${pos} "${lemma}"`, () => {
      const rendered = enRenderer.renderLemma(entry(lemma, pos, features))
      const modelled = articleizeToken(lemma, pos, features.countable === 'no', features.proper === 'yes')
      expect(modelled).toBe(rendered)
    })
  }
})

describe('slotTokens splits on both , and ; and articleizes each', () => {
  it('a comma-joined verb pair', () => {
    expect(slotTokens('feed; give birth', 'verb')).toEqual(new Set(['to feed', 'to give birth']))
  })
  it('a comma-joined noun pair (each gets its own article — finer than the on-screen string)', () => {
    expect(slotTokens('feed, fodder', 'noun')).toEqual(new Set(['a feed', 'a fodder']))
  })
  it('an uncountable noun stays bare', () => {
    expect(slotTokens('water', 'noun', true)).toEqual(new Set(['water']))
  })
})

describe('gloss-quality predicates', () => {
  it('flags POS-tag glosses in their several shapes', () => {
    expect(isPosTagGloss('feed (verb)')).toBe(true)
    expect(isPosTagGloss('noun: book')).toBe(true)
    expect(isPosTagGloss('assault, noun')).toBe(true)
    expect(isPosTagGloss('on, preposition')).toBe(true)
    expect(isPosTagGloss("ship's bow")).toBe(false)
  })
  it('flags a gloss that only restates its own translation', () => {
    expect(isEchoGloss('reserve', 'book, reserve')).toBe(true)
    expect(isEchoGloss('moreover', 'besides, moreover, in addition')).toBe(true)
    expect(isEchoGloss("ship's bow", 'bow')).toBe(false) // adds content → not an echo
    expect(isEchoGloss('', 'bow')).toBe(false) // empty is "missing", not "echo"
  })
})

describe('findCardClashes — no two distinct cards may render an identical prompt+gloss', () => {
  const noun = (seedKey: number, translation: string, key: string, gloss?: string) => ({
    seedKey, lemma: `w${seedKey}`, pos: 'noun', translation, sense: { key, ...(gloss ? { gloss } : {}) },
  })
  it('flags two different senses that render the same prompt with no distinguishing gloss', () => {
    const slots = buildSlots([noun(1, 'bank', 'bank#0'), noun(2, 'bank', 'bank#1')])
    expect(findCardClashes(slots)).toHaveLength(1) // "a bank" vs "a bank"
  })
  it('a distinguishing gloss clears the clash', () => {
    const slots = buildSlots([noun(1, 'bank', 'bank#0', 'river edge'), noun(2, 'bank', 'bank#1', 'money')])
    expect(findCardClashes(slots)).toHaveLength(0)
  })
  it('same senseKey = one grouped card, never a clash with itself', () => {
    const slots = buildSlots([noun(1, 'sofa', 'sofa#0'), noun(2, 'sofa', 'sofa#0')])
    expect(findCardClashes(slots)).toHaveLength(0)
  })
})
