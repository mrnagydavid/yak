// DEV-ONLY manual test helpers, loaded behind import.meta.env.DEV in main.tsx and stripped from
// production builds. Not part of the app — handy for eyeballing features that otherwise need real
// study history to reach.
import { applyRating, createReviewState } from '../srs/fsrs-adapter'
import { db } from './schema'

const DAY = 86_400_000

/**
 * Surface a multi-answer production card right now, without grinding two synonyms to production.
 * Stamps a shared `sense` on every Swedish answer of the English word `english`, seeds each with a
 * recognise state (parked in the future, so no recognise card) and a produce state (due now, so the
 * group surfaces), and clears the cached session so it recomposes. Reload the page, then open
 * Practice — you'll get the "english · N ways to say it" card. Call: `demoGroup('clearly')`.
 */
export async function demoGroup(english = 'clearly'): Promise<void> {
  const now = Date.now()
  const natives = (await db.entries.where('lang').equals('en').toArray()).filter(
    (e) => e.lemma.toLowerCase() === english.toLowerCase(),
  )
  const nativeIds = new Set(natives.map((n) => n.id))
  const trs = (await db.translations.toArray()).filter((t) => nativeIds.has(t.nativeEntryId))
  if (trs.length < 2) {
    console.warn(`demoGroup: need ≥2 Swedish answers for "${english}", found ${trs.length}`)
    return
  }
  await db.transaction('rw', db.entries, db.reviewStates, async () => {
    for (const t of trs) {
      await db.entries.update(t.targetEntryId, { sense: { key: `demo:${english}`, gloss: '' }, updatedAt: now })
      for (const skill of ['recognize', 'produce'] as const) {
        const existing = await db.reviewStates.where('[translationId+skill]').equals([t.id, skill]).first()
        let rs = existing ?? createReviewState(t.id, skill, now - 40 * DAY)
        if (!existing) rs = applyRating(applyRating(rs, 'good', now - 40 * DAY), 'good', now - 10 * DAY)
        rs = { ...rs, due: skill === 'produce' ? now - 1000 : now + 30 * DAY }
        await db.reviewStates.put(rs)
      }
    }
  })
  await db.activeSessions.clear() // drop the cached session so Practice recomposes with the new cards
  console.info(`demoGroup: "${english}" → ${trs.length} answers in production. Reload the page, then open Practice.`)
}
