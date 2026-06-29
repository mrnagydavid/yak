// DEV-ONLY manual test helpers, loaded behind import.meta.env.DEV in main.tsx and stripped from
// production builds. Not part of the app — handy for eyeballing features that need specific data.
import { persistSession } from '../components/PracticeScreen/session-store'
import type { SessionCard } from '../srs/session-composer'
import { db } from './schema'
import type { Entry } from './types'

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// The clean English concept behind a sense key ("clearly#0" → "clearly"; "find, to locate#1" → "find").
const conceptOf = (key: string) =>
  key.slice(0, key.lastIndexOf('#')).split(/[,(]/)[0].trim().toLowerCase()

/**
 * Build a practice session that tours the sense feature so you can flip through it as if practising:
 * multi-answer synonym GROUP cards (e.g. "clearly" → klart/tydligt) and solo PRODUCTION cards for
 * polysemous words, which show the disambiguating gloss (e.g. "hand (body part)"). All production,
 * practice mode (tap to reveal). Pass English words to target specific concepts, e.g.
 * `demoSenses(['hand', 'clearly', 'find'])`; with no argument it samples a random mix.
 * Run it in the console, then RELOAD and open Practice. `resetYak()` clears it.
 */
export async function demoSenses(words?: string[]): Promise<void> {
  const want = words?.map((w) => w.toLowerCase())
  const sv = (await db.entries.where('lang').equals('sv').toArray()).filter(
    (e) => e.sense?.key && (!want || want.includes(conceptOf(e.sense.key))),
  )
  const byKey = new Map<string, Entry[]>()
  for (const e of sv) {
    const list = byKey.get(e.sense!.key) ?? []
    list.push(e)
    byKey.set(e.sense!.key, list)
  }
  let groupSets = [...byKey.values()].filter((m) => m.length >= 2) // ≥2-member sense → group card
  let soloEntries = sv.filter((e) => e.sense!.gloss && byKey.get(e.sense!.key)!.length === 1) // gloss solo
  if (!want) {
    groupSets = shuffle(groupSets).slice(0, 4)
    soloEntries = shuffle(soloEntries).slice(0, 4)
  }

  const involved = [...groupSets.flat(), ...soloEntries]
  const trs = await db.translations.where('targetEntryId').anyOf(involved.map((e) => e.id)).toArray()
  const trOf = (id: string) => trs.find((t) => t.targetEntryId === id)?.id

  const cards: SessionCard[] = []
  for (const set of groupSets) {
    const members = set.flatMap((e) => {
      const t = trOf(e.id)
      return t ? [{ translationId: t, targetEntryId: e.id }] : []
    })
    if (members.length < 2) continue
    cards.push({ translationId: members[0].translationId, targetEntryId: members[0].targetEntryId, skill: 'produce', mode: 'practice', group: { members } })
  }
  for (const e of soloEntries) {
    const t = trOf(e.id)
    if (t) cards.push({ translationId: t, targetEntryId: e.id, skill: 'produce', mode: 'practice' })
  }
  shuffle(cards)

  if (cards.length === 0) {
    console.warn('demoSenses: no matching sense words found', words ?? '')
    return
  }
  await persistSession(cards, 0, false)
  console.info(
    `demoSenses: ${cards.length} cards (${groupSets.length} synonym groups + ${soloEntries.length} polysemy solos). Reload the page, then open Practice. resetYak() to clear.`,
  )
}
