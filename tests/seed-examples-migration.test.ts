import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ExampleSentence } from '../src/db/types'

// Regression for the v7 examples-shape migration (src/db/schema.ts). Per-sense examples (§4.8) changed
// Entry.examples from `string[]` to `{text, meaningKey}[]`, and every reader now uses `.text`/
// `.meaningKey`. Changed-only seed-sync only rewrites a word when its content hash changes, so a word
// whose text was unchanged in that release kept legacy bare-string examples that the new readers can't
// read (the example silently vanished — this is what happened to "en lära"). The fix migrates the
// stored shape on DB upgrade; this test proves a pre-v7 row with `string[]` examples is rewritten to
// the tagged shape (meaningKey 0), and an already-migrated row is left untouched.

const DB_NAME = 'yak'

// Minimal v6 schema (the shape a DB had before v7) — enough to write a legacy entry and let the real
// YakDB upgrade it. Mirrors schema.ts's entries index string at v6.
async function seedLegacyDbAtV6(): Promise<void> {
  const legacy = new Dexie(DB_NAME)
  legacy.version(6).stores({
    entries: 'id, lang, lemma, [lang+lemma], pos, source, cefr',
    entryOverlays: 'id, &entryId',
    translations: 'id, targetEntryId, nativeEntryId',
    reviewStates: 'id, translationId, skill, [translationId+skill], due, state',
    profiles: 'id, active, [learnerLang+targetLang]',
    sessionLogs: 'id, profileId, startedAt',
    ipaDicts: 'lang',
    wiktionaryCache: 'key, lang',
    meta: 'key',
    activeSessions: 'id',
  })
  await legacy.open()
  await legacy.table('entries').bulkAdd([
    // A pre-v7 seed row: examples are bare strings (the shape "en lära" was stuck in).
    { id: 'legacy-lara', lang: 'sv', lemma: 'lära', pos: 'noun', source: 'seed', examples: ['Buddhas lära är gammal.'] },
    // An already-migrated row (a word whose hash changed, so seed-sync rewrote it): must survive as-is.
    { id: 'already-tagged', lang: 'sv', lemma: 'led', pos: 'noun', source: 'seed', examples: [{ text: 'Vi följde en led genom skogen.', meaningKey: 1 }] },
    // A row with no examples at all: must not gain an `examples` field.
    { id: 'no-examples', lang: 'sv', lemma: 'och', pos: 'conj', source: 'seed' },
  ])
  legacy.close()
}

beforeAll(async () => {
  await seedLegacyDbAtV6()
})

describe('v7 examples-shape migration', () => {
  it('rewrites legacy string[] examples to {text, meaningKey: 0} while leaving tagged rows and empty rows alone', async () => {
    // Import the real DB only AFTER the legacy v6 DB exists, so opening it runs the v6 → v7 upgrade.
    const { db } = await import('../src/db/schema')

    const lara = await db.entries.get('legacy-lara')
    expect(lara?.examples).toEqual<ExampleSentence[]>([{ text: 'Buddhas lära är gammal.', meaningKey: 0 }])

    const led = await db.entries.get('already-tagged')
    expect(led?.examples).toEqual<ExampleSentence[]>([{ text: 'Vi följde en led genom skogen.', meaningKey: 1 }])

    const och = await db.entries.get('no-examples')
    expect(och?.examples).toBeUndefined()
  })
})
