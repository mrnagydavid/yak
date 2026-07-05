import type { Entry } from '../../../db/types'
import type { DrillMeta } from '../../../drills/types'

// The Swedish irregular-verb drill — the language-COUPLED half: eligibility, the mode picker, and
// answer-checking. (Its UI is VerbFormsDrill.tsx, alongside.) It's bidirectional and typed: each time a
// verb comes up, one of four modes is chosen — read a form and type the infinitive (decode), or read
// the infinitive and type a form (produce), for the preteritum (past) or the supinum (perfect). Only
// preteritum + supinum are drilled — the genuinely irregular parts; present/imperative sit out.

export type VerbMode = 'decode-pret' | 'decode-sup' | 'produce-pret' | 'produce-sup'

const MODES: VerbMode[] = ['decode-pret', 'decode-sup', 'produce-pret', 'produce-sup']

/** A present, non-placeholder inflection (Wiktionary marks a missing form as "-"). */
function form(entry: Entry, key: string): string | undefined {
  const v = entry.inflections[key]
  return v && v !== '-' ? v : undefined
}

/**
 * Whether a verb is a REGULAR (weak) verb whose past/supine are mechanically derivable from the lemma
 * (tala → talade → talat) — those are busywork to drill, so they're excluded. A verb is regular when
 * its lemma ends in -a and both forms match the weak patterns; everything else (strong verbs, irregular
 * weak verbs, short group-3 verbs like bo → bodde → bott) counts as irregular and IS worth drilling.
 * Filters the ~1500 verbs with full forms down to the ~400 irregular ones.
 */
export function isRegularVerb(entry: Entry): boolean {
  const p = entry.inflections.preteritum
  const s = entry.inflections.supinum
  const l = entry.lemma
  if (!p || !s || !l.endsWith('a')) return false
  const stem = l.slice(0, -1)
  const regPret = [`${stem}ade`, `${stem}de`, `${stem}te`, `${stem}dde`]
  const regSup = [`${stem}at`, `${stem}t`, `${stem}tt`]
  return regPret.includes(p) && regSup.includes(s)
}

/**
 * Whether a word can appear in the verb-forms drill: an irregular verb with both a past and a supine,
 * not manually skipped, and already MET in normal practice (we drill grammar of words the learner is
 * learning, never cold-quiz unseen ones). `met` is supplied by the caller (it owns the review data).
 */
export function isVerbFormsEligible(entry: Entry, met: boolean): boolean {
  return (
    entry.pos === 'verb' &&
    entry.study !== 'skip' &&
    met &&
    !!form(entry, 'preteritum') &&
    !!form(entry, 'supinum') &&
    !isRegularVerb(entry)
  )
}

// FNV-1a 32-bit → an integer. Not security-grade; just needs to spread (entryId, session) pairs across
// the four modes. The entryId (a random ULID) supplies most of the entropy.
function hashInt(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * The mode for a verb THIS session. Deterministic in (entryId, startedAt): stable within a session — so
 * a re-queued miss returns as the SAME challenge ("clear what you actually missed") — but varying across
 * sessions, so over time a verb gets drilled both directions and both forms.
 */
export function pickMode(entryId: string, startedAt: number): VerbMode {
  return MODES[hashInt(`${entryId}:${startedAt}`) % MODES.length]
}

export function isDecode(mode: VerbMode): boolean {
  return mode === 'decode-pret' || mode === 'decode-sup'
}

/** Which form slot a mode reads or asks for. */
export function slotOf(mode: VerbMode): 'preteritum' | 'supinum' {
  return mode === 'decode-pret' || mode === 'produce-pret' ? 'preteritum' : 'supinum'
}

// Plain-language name for each drilled form, used in the question "What is the ___ of …?". "Supine" is
// the textbook term but opaque to beginners, so it's glossed with the concrete har-construction; "past
// participle" is deliberately avoided (in Swedish that's the separate, agreeing perfekt particip).
const FORM_NAME: Record<'preteritum' | 'supinum', string> = {
  preteritum: 'past tense',
  supinum: 'supine (har-form)',
}

/** What the card asks for (`targetName`, e.g. "the {targetName} of …") and which direction/slot it is. */
export interface VerbPrompt {
  decode: boolean
  slot: 'preteritum' | 'supinum'
  targetName: string // the form to produce: 'infinitive' | 'past tense' | 'supine (har-form)'
}

export function promptFor(mode: VerbMode): VerbPrompt {
  const decode = isDecode(mode)
  const slot = slotOf(mode)
  return { decode, slot, targetName: decode ? 'infinitive' : FORM_NAME[slot] }
}

// Normalize a typed answer: trim, lowercase, and drop a leading "att " so "att lägga" == "lägga".
export function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/^att\s+/, '')
}

// Accepted alternates for a PRODUCED form (stored form → also-correct answers, all normalized). Swedish
// has spoken/written variants — "lade"/"la", "sade"/"sa" — and a few verbs with alternate strong/weak
// forms. A small starter list; extend as real misses surface. (Decode direction handles its own rare
// ambiguity via a cross-verb lookup in the runner.)
const FORM_VARIANTS: Record<string, string[]> = {
  lade: ['la'],
  sade: ['sa'],
  bade: ['ba'],
}

/**
 * Whether a typed answer is correct for a mode — the self-contained check (99.9% of cases). Decode
 * accepts the entry's own infinitive; the runner adds a cross-verb fallback for shared surface forms.
 * Produce accepts the stored form or a known variant.
 */
export function checkAnswer(mode: VerbMode, entry: Entry, typed: string): boolean {
  const guess = normalizeAnswer(typed)
  if (!guess) return false
  if (isDecode(mode)) return guess === normalizeAnswer(entry.lemma)
  const target = normalizeAnswer(entry.inflections[slotOf(mode)] ?? '')
  return guess === target || (FORM_VARIANTS[target]?.includes(guess) ?? false)
}

// A reverse index over a verb set: normalized surface form (preteritum or supinum) → the set of
// infinitives that produce it. Powers two things in the decode direction (shown form → infinitive):
// deciding whether a form is AMBIGUOUS (shared by >1 verb, so the meaning is worth showing), and
// ACCEPTING any infinitive whose same surface form matches (the rare "lett" ← le/leda collision).
export function buildFormIndex(verbs: Entry[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  for (const v of verbs) {
    for (const key of ['preteritum', 'supinum'] as const) {
      const raw = v.inflections[key]
      if (!raw || raw === '-') continue
      const surface = normalizeAnswer(raw)
      if (!surface) continue
      let set = index.get(surface)
      if (!set) index.set(surface, (set = new Set()))
      set.add(normalizeAnswer(v.lemma))
    }
  }
  return index
}

/** Whether a shown surface form maps to more than one infinitive — i.e. its meaning is genuinely needed. */
export function isAmbiguousForm(index: Map<string, Set<string>>, form: string): boolean {
  return (index.get(normalizeAnswer(form))?.size ?? 0) > 1
}

/** Whether a typed infinitive is a valid source of the shown surface form (any verb, not just the target). */
export function decodeAccepts(index: Map<string, Set<string>>, form: string, typed: string): boolean {
  return index.get(normalizeAnswer(form))?.has(normalizeAnswer(typed)) ?? false
}

/** Registry entry for the Swedish irregular-verb drill. */
export const verbFormsDrillMeta: DrillMeta = {
  type: 'sv:verbForms',
  title: 'Verb forms',
  description: 'Irregular Swedish verbs — read a form and name the infinitive, or the other way round.',
  funFact:
    'Fun fact: most Swedish irregulars are “strong” verbs whose stem vowel shifts — dricka → drack → druckit. Learn the pattern and dozens fall into place.',
  eligible: isVerbFormsEligible,
}
