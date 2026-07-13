import type { Entry } from '../../../db/types'
import type { DrillMeta } from '../../../drills/types'

// The Swedish irregular-adjective drill — the language-COUPLED half: eligibility, the mode picker, and
// answer-checking. (Its UI is AdjFormsDrill.tsx, alongside.) It's bidirectional and typed: each time an
// adjective comes up, one of four modes is chosen — read the base form and type a degree (produce), or
// read a degree and name the base form (decode), for the comparative or the superlative. Only the
// genuinely irregular adjectives are drilled — the suppletive/vowel-shift set (bra → bättre → bäst,
// stor → större → störst, gammal → äldre → äldst); regular -are/-ast words and the periphrastic
// mer/mest ones (mer politisk) sit out, being mechanical rather than worth memorising.

export type AdjMode = 'decode-comp' | 'decode-sup' | 'produce-comp' | 'produce-sup'

const MODES: AdjMode[] = ['decode-comp', 'decode-sup', 'produce-comp', 'produce-sup']

/** A present, non-placeholder inflection (Wiktionary marks a missing form as "-"). */
function form(entry: Entry, key: string): string | undefined {
  const v = entry.inflections[key]
  return v && v !== '-' ? v : undefined
}

/**
 * Whether an adjective compares periphrastically — "mer/mest X" rather than by inflecting (mer politisk,
 * mest intressant). Common for participles, -isk adjectives, and long words; mechanical to form ("just
 * prepend mer/mest"), so not worth a drill.
 */
export function isPeriphrastic(entry: Entry): boolean {
  const c = form(entry, 'komparativ')
  const s = form(entry, 'superlativ')
  return !!c?.startsWith('mer ') || !!s?.startsWith('mest ')
}

/**
 * Whether an adjective's comparative/superlative are mechanically derivable from the lemma by the
 * regular -are/-ast rules — those are busywork to drill, so they're excluded. Covers the plain suffix
 * (ny → nyare/nyast), the -el/-en/-er contraction (enkel → enklare/enklast), a dropped final -a
 * (ringa → ringare/ringast), and final-consonant doubling (ensam → ensammare/ensammast). Everything
 * else with both forms present — the suppletive and vowel-shift adjectives — counts as irregular.
 */
export function isRegularAdjective(entry: Entry): boolean {
  const c = form(entry, 'komparativ')
  const s = form(entry, 'superlativ')
  const l = entry.lemma
  if (!c || !s) return false
  const comps = new Set<string>()
  const sups = new Set<string>()
  const add = (stem: string) => {
    comps.add(`${stem}are`)
    sups.add(`${stem}ast`)
  }
  add(l)
  if (l.length > 2 && ['el', 'en', 'er'].includes(l.slice(-2))) add(l.slice(0, -2) + l.slice(-1)) // enkel → enkl
  if (l.endsWith('a')) add(l.slice(0, -1)) // ringa → ring
  const last = l.slice(-1)
  if (last && !'aeiouyåäö'.includes(last)) add(l + last) // ensam → ensamm
  return comps.has(c) && sups.has(s)
}

/**
 * Whether a word can appear in the adjective-forms drill: an irregular adjective with both a comparative
 * and a superlative, comparing by inflection (not mer/mest), not manually skipped, and already MET in
 * normal practice (we drill grammar of words the learner is learning, never cold-quiz unseen ones).
 * `met` is supplied by the caller (it owns the review data).
 */
export function isAdjFormsEligible(entry: Entry, met: boolean): boolean {
  return (
    entry.pos === 'adj' &&
    entry.study !== 'skip' &&
    met &&
    !!form(entry, 'komparativ') &&
    !!form(entry, 'superlativ') &&
    !isPeriphrastic(entry) &&
    !isRegularAdjective(entry)
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
 * The mode for an adjective THIS session. Deterministic in (entryId, startedAt): stable within a
 * session — so a re-queued miss returns as the SAME challenge ("clear what you actually missed") — but
 * varying across sessions, so over time a word gets drilled both directions and both degrees.
 */
export function pickMode(entryId: string, startedAt: number): AdjMode {
  return MODES[hashInt(`${entryId}:${startedAt}`) % MODES.length]
}

export function isDecode(mode: AdjMode): boolean {
  return mode === 'decode-comp' || mode === 'decode-sup'
}

/** Which degree slot a mode reads or asks for. */
export function slotOf(mode: AdjMode): 'komparativ' | 'superlativ' {
  return mode === 'decode-comp' || mode === 'produce-comp' ? 'komparativ' : 'superlativ'
}

// Plain-language name for each drilled degree, used in the question "What is the ___ of …?".
const FORM_NAME: Record<'komparativ' | 'superlativ', string> = {
  komparativ: 'comparative',
  superlativ: 'superlative',
}

/** What the card asks for (`targetName`, e.g. "the {targetName} of …") and which direction/slot it is. */
export interface AdjPrompt {
  decode: boolean
  slot: 'komparativ' | 'superlativ'
  targetName: string // the form to produce: 'base form' | 'comparative' | 'superlative'
}

export function promptFor(mode: AdjMode): AdjPrompt {
  const decode = isDecode(mode)
  const slot = slotOf(mode)
  return { decode, slot, targetName: decode ? 'base form' : FORM_NAME[slot] }
}

// Normalize a typed answer: trim + lowercase (adjectives carry no "att" prefix).
export function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase()
}

// Accepted alternates for a PRODUCED form (stored form → also-correct answers, all normalized). Swedish
// has a few adjectives with parallel comparison forms — nära gives both närmare/närmst and the shorter
// närmre/närmst. A small starter list; extend as real misses surface. (The decode direction handles its
// own ambiguity via a cross-word lookup in the runner.)
const FORM_VARIANTS: Record<string, string[]> = {
  närmare: ['närmre'],
  närmast: ['närmst'],
}

/**
 * Whether a typed answer is correct for a mode — the self-contained check (99.9% of cases). Decode
 * accepts the entry's own base form; the runner adds a cross-word fallback for shared surface forms
 * (minst ← liten/få). Produce accepts the stored form or a known variant.
 */
export function checkAnswer(mode: AdjMode, entry: Entry, typed: string): boolean {
  const guess = normalizeAnswer(typed)
  if (!guess) return false
  if (isDecode(mode)) return guess === normalizeAnswer(entry.lemma)
  const target = normalizeAnswer(entry.inflections[slotOf(mode)] ?? '')
  return guess === target || (FORM_VARIANTS[target]?.includes(guess) ?? false)
}

// A reverse index over an adjective set: normalized surface form (comparative or superlative) → the set
// of base forms that produce it. Powers two things in the decode direction (shown form → base form):
// deciding whether a form is AMBIGUOUS (shared by >1 word, so the meaning is worth showing), and
// ACCEPTING any base form whose same surface form matches (the shared 'minst' ← liten/få collision).
export function buildFormIndex(adjectives: Entry[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  for (const a of adjectives) {
    for (const key of ['komparativ', 'superlativ'] as const) {
      const raw = a.inflections[key]
      if (!raw || raw === '-' || raw.startsWith('mer ') || raw.startsWith('mest ')) continue
      const surface = normalizeAnswer(raw)
      if (!surface) continue
      let set = index.get(surface)
      if (!set) index.set(surface, (set = new Set()))
      set.add(normalizeAnswer(a.lemma))
    }
  }
  return index
}

/** Whether a shown surface form maps to more than one base form — i.e. its meaning is genuinely needed. */
export function isAmbiguousForm(index: Map<string, Set<string>>, form: string): boolean {
  return (index.get(normalizeAnswer(form))?.size ?? 0) > 1
}

/** Whether a typed base form is a valid source of the shown surface form (any adjective, not just the target). */
export function decodeAccepts(index: Map<string, Set<string>>, form: string, typed: string): boolean {
  return index.get(normalizeAnswer(form))?.has(normalizeAnswer(typed)) ?? false
}

/** Registry entry for the Swedish irregular-adjective drill. */
export const adjFormsDrillMeta: DrillMeta = {
  type: 'sv:adjForms',
  title: 'Adjective forms',
  description:
    'Irregular Swedish adjectives — read a form and name the base word, or turn the base word into its comparative or superlative.',
  funFact:
    'Fun fact: a handful of everyday adjectives compare by shifting their vowel or swapping stem entirely — stor → större → störst, bra → bättre → bäst, gammal → äldre → äldst.',
  eligible: isAdjFormsEligible,
}
