import { ulid } from './ids'
import { db } from './schema'
import type { Cefr, Entry, PartOfSpeech, ReviewState, Skill, Translation } from './types'

// Temporary development sample data so the screens have something to show before the
// real seed pipeline (SPEC §9) lands. Only seeds when the DB is empty, so it never
// clobbers real data. Remove this module once the real seed is wired in.

const SEED_VERSION = 'dev-sample'
const DAY = 86_400_000

interface SamplePair {
  sv: string
  pos: PartOfSpeech
  cefr: Cefr
  en: string
  enPos: PartOfSpeech
  features?: Record<string, string>
  inflections?: Record<string, string>
  ipa?: string
  subDefinitions?: string[]
  uncountable?: boolean
}

const PAIRS: SamplePair[] = [
  { sv: 'hund', pos: 'noun', cefr: 'A1', en: 'dog', enPos: 'noun', features: { gender: 'en' }, inflections: { definiteSingular: 'hunden', indefinitePlural: 'hundar', definitePlural: 'hundarna' }, ipa: 'ˈhɵnd' },
  { sv: 'katt', pos: 'noun', cefr: 'A1', en: 'cat', enPos: 'noun', features: { gender: 'en' }, inflections: { definiteSingular: 'katten', indefinitePlural: 'katter', definitePlural: 'katterna' }, ipa: 'ˈkatː' },
  { sv: 'hus', pos: 'noun', cefr: 'A1', en: 'house', enPos: 'noun', features: { gender: 'ett' }, inflections: { definiteSingular: 'huset', indefinitePlural: 'hus', definitePlural: 'husen' }, ipa: 'ˈhʉːs' },
  { sv: 'vatten', pos: 'noun', cefr: 'A1', en: 'water', enPos: 'noun', features: { gender: 'ett' }, inflections: { definiteSingular: 'vattnet' }, uncountable: true, ipa: 'ˈvatən' },
  { sv: 'bok', pos: 'noun', cefr: 'A2', en: 'book', enPos: 'noun', features: { gender: 'en' }, inflections: { definiteSingular: 'boken', indefinitePlural: 'böcker', definitePlural: 'böckerna' }, ipa: 'ˈbuːk' },
  { sv: 'springa', pos: 'verb', cefr: 'A2', en: 'run', enPos: 'verb', inflections: { presens: 'springer', preteritum: 'sprang', supinum: 'sprungit', imperativ: 'spring' }, ipa: 'ˈsprɪŋa' },
  { sv: 'äta', pos: 'verb', cefr: 'A1', en: 'eat', enPos: 'verb', inflections: { presens: 'äter', preteritum: 'åt', supinum: 'ätit', imperativ: 'ät' }, ipa: 'ˈɛːta' },
  { sv: 'snabb', pos: 'adj', cefr: 'A2', en: 'fast', enPos: 'adj', ipa: 'ˈsnabː' },
  { sv: 'sällsynt', pos: 'adj', cefr: 'C1', en: 'rare', enPos: 'adj', ipa: 'ˈsɛlːsʏnt' }, // above A2 — out of scope, shown dimmed
  { sv: 'tack', pos: 'interj', cefr: 'A1', en: 'thanks', enPos: 'interj', ipa: 'ˈtakː' },
  { sv: 'mena', pos: 'verb', cefr: 'B1', en: 'mean', enPos: 'verb', inflections: { presens: 'menar', preteritum: 'menade', supinum: 'menat' }, subDefinitions: ['to mean, intend', 'to be of the opinion'], ipa: 'ˈmeːna' },
]

function makeEntry(
  lang: string,
  lemma: string,
  pos: PartOfSpeech,
  now: number,
  extra: Partial<Entry> = {},
): Entry {
  return {
    id: ulid(now),
    lang,
    lemma,
    pos,
    features: {},
    inflections: {},
    pronunciation: {},
    source: 'seed',
    seedVersion: SEED_VERSION,
    study: 'auto',
    createdAt: now,
    updatedAt: now,
    ...extra,
  }
}

function makeReviewState(
  translationId: string,
  skill: Skill,
  now: number,
  fields: Pick<ReviewState, 'stability' | 'difficulty' | 'reps' | 'lapses' | 'state'> & {
    dueInDays: number
  },
): ReviewState {
  const { dueInDays, ...rest } = fields
  return {
    id: ulid(now),
    translationId,
    skill,
    ...rest,
    due: now + dueInDays * DAY,
    lastReview: now - DAY,
    scheduledDays: Math.max(0, Math.round(dueInDays)),
    elapsedDays: 1,
    learningSteps: 0,
    createdAt: now,
    updatedAt: now,
  }
}

export async function seedDevData(): Promise<void> {
  const existing = await db.entries.count()
  if (existing > 0) return

  const now = Date.now()
  const entries: Entry[] = []
  const translations: Translation[] = []
  const reviewStates: ReviewState[] = []
  const svIdByLemma = new Map<string, string>()
  const translationIdBySv = new Map<string, string>()

  for (const pair of PAIRS) {
    const svFeatures = { ...pair.features }
    if (pair.uncountable) svFeatures.countable = 'no'
    const svEntry = makeEntry('sv', pair.sv, pair.pos, now, {
      cefr: pair.cefr,
      features: svFeatures,
      inflections: pair.inflections ?? {},
      pronunciation: pair.ipa ? { ipa: pair.ipa, ipaSource: 'generated' } : {},
      subDefinitions: pair.subDefinitions,
    })
    const enEntry = makeEntry('en', pair.en, pair.enPos, now, {
      features: pair.uncountable ? { countable: 'no' } : {},
    })
    entries.push(svEntry, enEntry)
    svIdByLemma.set(pair.sv, svEntry.id)

    const translation: Translation = {
      id: ulid(now),
      targetEntryId: svEntry.id,
      nativeEntryId: enEntry.id,
      source: 'seed',
      createdAt: now,
    }
    translations.push(translation)
    translationIdBySv.set(pair.sv, translation.id)
  }

  // A few review states so the status icons aren't all blank.
  reviewStates.push(
    makeReviewState(translationIdBySv.get('hund')!, 'recognize', now, { stability: 45, difficulty: 4.2, reps: 8, lapses: 0, state: 'review', dueInDays: 12 }),
    makeReviewState(translationIdBySv.get('hund')!, 'produce', now, { stability: 12, difficulty: 5.1, reps: 4, lapses: 1, state: 'review', dueInDays: 3 }),
    makeReviewState(translationIdBySv.get('katt')!, 'recognize', now, { stability: 3, difficulty: 7.8, reps: 6, lapses: 4, state: 'relearning', dueInDays: 0 }),
    makeReviewState(translationIdBySv.get('springa')!, 'recognize', now, { stability: 20, difficulty: 5.5, reps: 5, lapses: 1, state: 'review', dueInDays: 6 }),
  )

  const profile = {
    id: ulid(now),
    learnerLang: 'en',
    targetLang: 'sv',
    claimedLevel: 'A2' as const,
    dailyLimits: { newPerDay: 20, practicePerDay: 200 },
    active: true,
    createdAt: now,
    updatedAt: now,
  }

  await db.transaction('rw', db.entries, db.translations, db.reviewStates, db.profiles, async () => {
    await db.entries.bulkAdd(entries)
    await db.translations.bulkAdd(translations)
    await db.reviewStates.bulkAdd(reviewStates)
    await db.profiles.add(profile)
  })
}
