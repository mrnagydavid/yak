import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { cardExamples } from '../src/components/PracticeScreen/StudyCard'
import { getPracticeCardView } from '../src/db/queries'
import { db } from '../src/db/schema'
import { loadSeedIfEmpty } from '../src/db/seed'
import type { Translation } from '../src/db/types'

// End-to-end coverage for per-sense examples (SEED-PIPELINE-DESIGN.md §4.8): loads the real committed
// seed into an in-memory IndexedDB (fake-indexeddb) and drives the actual seed.ts → queries.ts →
// StudyCard rule, proving `meaningKey` flows through so a production card shows ONLY its own sense's
// examples while recognition shows them all. This is the app's only integration test over the Dexie +
// query layer, which pure unit tests can't reach.
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf-8')
const seedJson = read('../data/seed/sv/seed-sv.json')
const versionJson = read('../data/seed/sv/version.json')

beforeAll(async () => {
  // Serve the committed seed to seed.ts's fetch (it requests `${BASE_URL}seed-sv.json` / version.json).
  global.fetch = (async (url: string | URL) =>
    new Response(String(url).includes('version.json') ? versionJson : seedJson, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
  await loadSeedIfEmpty()
})

const produceView = async (translationId: string, targetEntryId: string) => {
  const v = await getPracticeCardView({ translationId, targetEntryId, skill: 'produce', mode: 'practice' })
  if (!v) throw new Error(`no view for ${translationId}`)
  return v
}
const seedTexts = (examples: { text: string }[] | undefined) => (examples ?? []).map((e) => e.text)

describe('per-sense examples flow end-to-end (real seed + Dexie + queries)', () => {
  it('led: the joint card shows the joint sentence, the route card shows the route sentence', async () => {
    const led = (await db.entries.where('[lang+lemma]').equals(['sv', 'led']).toArray()).find(
      (e) => e.features.gender === 'en' && (e.examples?.length ?? 0) > 0,
    )
    expect(led, 'split led entry present in the seed').toBeTruthy()

    const trs = await db.translations.where('targetEntryId').equals(led!.id).toArray()
    const primary = trs.find((t) => t.meaningKey === 0)!
    const promoted = trs.find((t) => t.meaningKey === 1)!
    expect(primary && promoted, 'led has a primary + a promoted meaning').toBeTruthy()

    const joint = await produceView(primary.id, led!.id)
    const route = await produceView(promoted.id, led!.id)
    expect(joint.meaningKey).toBe(0)
    expect(route.meaningKey).toBe(1)

    const jointEx = cardExamples(joint.target.examples, joint.overlay?.customExamples, joint.meaningKey)
    const routeEx = cardExamples(route.target.examples, route.overlay?.customExamples, route.meaningKey)
    expect(jointEx.length).toBeGreaterThan(0)
    expect(routeEx.length).toBeGreaterThan(0)
    // Each card shows its own sense only — never the sibling's sentence.
    expect(jointEx).not.toContain(routeEx[0])
    expect(routeEx).not.toContain(jointEx[0])

    // Recognition (per word) shows every meaning's examples.
    const recog = await getPracticeCardView({ translationId: primary.id, targetEntryId: led!.id, skill: 'recognize', mode: 'practice' })
    const recogEx = cardExamples(recog!.target.examples, recog!.overlay?.customExamples, null)
    expect(recogEx).toEqual(expect.arrayContaining([jointEx[0], routeEx[0]]))
  })

  it('across split words: each production card’s examples are its own meaning’s, disjoint, and union to recognition', async () => {
    // Group translations by target to find split words (≥2 meanings) that carry examples.
    const trs = await db.translations.toArray()
    const byTarget = new Map<string, Translation[]>()
    for (const t of trs) {
      const list = byTarget.get(t.targetEntryId) ?? []
      list.push(t)
      byTarget.set(t.targetEntryId, list)
    }
    const svTargets = (await db.entries.where('lang').equals('sv').toArray())
      .filter((e) => (byTarget.get(e.id)?.length ?? 0) >= 2 && (e.examples?.length ?? 0) > 0)
      .sort((a, b) => a.lemma.localeCompare(b.lemma, 'sv'))
    expect(svTargets.length).toBeGreaterThan(20) // sanity: the split-with-examples set exists

    // A sample is enough — the data-level audit (audit-examples) covers all 132 words; this proves the
    // runtime wiring. Kept small so the Dexie-backed suite stays fast.
    const sample = svTargets.slice(0, 10)
    for (const target of sample) {
      const meanings = byTarget.get(target.id)!.slice().sort((a, b) => a.meaningKey - b.meaningKey)
      const perMeaning: string[][] = []
      for (const m of meanings) {
        const view = await produceView(m.id, target.id)
        expect(view.meaningKey, `${target.lemma} link meaningKey`).toBe(m.meaningKey)
        const ex = cardExamples(view.target.examples, view.overlay?.customExamples, view.meaningKey)
        // Coverage: every main meaning of a split-with-examples word has ≥1 example (audit invariant).
        expect(ex.length, `${target.lemma} meaning ${m.meaningKey} has an example`).toBeGreaterThan(0)
        // Every shown sentence really is tagged to THIS meaning in the entry.
        for (const s of ex) expect((target.examples ?? []).some((e) => e.text === s && e.meaningKey === m.meaningKey)).toBe(true)
        perMeaning.push(ex)
      }
      // Sibling meanings never share a sentence.
      for (let i = 0; i < perMeaning.length; i++)
        for (let j = i + 1; j < perMeaning.length; j++)
          expect(perMeaning[i].filter((s) => perMeaning[j].includes(s)), `${target.lemma} senses share a sentence`).toEqual([])
      // Recognition shows the union of all meanings' sentences.
      const recog = await getPracticeCardView({ translationId: meanings[0].id, targetEntryId: target.id, skill: 'recognize', mode: 'practice' })
      const recogEx = cardExamples(recog!.target.examples, recog!.overlay?.customExamples, null)
      expect(recogEx.slice().sort()).toEqual(seedTexts(target.examples).slice().sort())
    }
  })
})
