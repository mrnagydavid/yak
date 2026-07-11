// The gloss/collision model — the single definition of "when does a production prompt need a gloss".
// Shared by the checker (audit-gloss.mjs), the mechanical deletion (delete-redundant-glosses.mjs), and
// (later) the Stage-3 curation extractor, so all three agree on self-clear vs. bare-ambiguous.
//
// WHY this exists: a production gloss is the tiny parenthetical that tells a learner WHICH sense of an
// English prompt we want. It is needed ONLY when the prompt the learner actually sees is ambiguous. The
// old pipeline decided that from a coarse first-token "concept" (normTr) — which over-fired (POS
// homonyms the article separates: `to feed` vs `a feed`) and under-fired (a bare token that is a subset
// of a spelled-out sibling: `just` vs `just, only`). This model fixes both by working on the ACTUAL
// rendered, articleized SYNONYM TOKENS.
//
// COLLISION UNIT = the articleized synonym token. We split a translation on `,` AND `;` into its atomic
// synonym tokens and articleize each exactly as src/lang/en/render.ts renders a production prompt (verb →
// `to X`, countable noun → `a/an X`, uncountable/proper → bare). Two producer slots COLLIDE when their
// token-sets intersect. This is deliberately finer than the on-screen string (`feed, fodder` renders with
// one article) — the learner associates each synonym with the word, so `just` must collide with the
// `just` inside `just, only`. Keep this articleize in lockstep with src/lang/en/render.ts (parity test).

// --- articleization: MUST mirror src/lang/en/render.ts::articleize / indefiniteArticle (SPEC §5.1) ---
const CONSONANT_SOUND_WORDS = new Set([
  'one', 'once', 'unit', 'union', 'uniform', 'unique', 'universe', 'university', 'unanimity',
  'unison', 'unity', 'unicorn', 'use', 'usage', 'user', 'usual', 'usefulness', 'utopia',
  'euro', 'europe', 'european', 'ewe', 'uranium', 'ukulele',
])
const VOWEL_SOUND_WORDS = new Set([
  'hour', 'honest', 'honesty', 'honor', 'honour', 'honorable', 'honourable', 'heir', 'heiress',
])
function indefiniteArticle(word) {
  const first = word.toLowerCase().match(/[a-z]+/)?.[0] ?? ''
  if (VOWEL_SOUND_WORDS.has(first)) return 'an'
  if (CONSONANT_SOUND_WORDS.has(first)) return 'a'
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}

// Articleize ONE synonym token. `pos` is the entry's POS (a promoted meaning inherits its parent's, as
// groupConcepts already assumes); `uncountable`/`proper` are the slot's own render flags.
export function articleizeToken(token, pos, uncountable = false, proper = false) {
  const t = token.trim()
  if (!t) return ''
  if (proper) return t
  if (pos === 'verb') return /^to\s/i.test(t) ? t : `to ${t}`
  if (pos === 'noun') {
    if (uncountable) return t
    if (/^(an?|the)\s/i.test(t)) return t
    return `${indefiniteArticle(t)} ${t}`
  }
  return t
}

// The whole on-screen production prompt — mirrors src/lang/en/render.ts::renderLemma (split on ';',
// article each part). This is what the LEARNER SEES; slotTokens (below) is the finer per-synonym split
// used only for collision detection.
export function renderPrompt(translation, pos, uncountable = false, proper = false) {
  return (translation ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => articleizeToken(s, pos, uncountable, proper))
    .join('; ')
}

// The set of articleized synonym tokens a slot's prompt exposes (lowercased for comparison).
export function slotTokens(translation, pos, uncountable = false, proper = false) {
  return new Set(
    (translation ?? '')
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => articleizeToken(s, pos, uncountable, proper).toLowerCase()),
  )
}

// --- producer slots: every meaning that becomes a production card (primary + each altMeaning) ---
export function buildSlots(entries) {
  const slots = []
  for (const e of entries) {
    if (e.translation) {
      slots.push({
        seedKey: e.seedKey, meaningKey: 0, lemma: e.lemma, pos: e.pos, promoted: false,
        translation: e.translation,
        senseKey: e.sense?.key ?? null,
        gloss: (e.sense?.gloss ?? '').trim() || null,
        prompt: renderPrompt(e.translation, e.pos, e.enUncountable === true, e.enProper === true),
        tokens: slotTokens(e.translation, e.pos, e.enUncountable === true, e.enProper === true),
      })
    }
    for (const m of e.altMeanings ?? []) {
      slots.push({
        seedKey: e.seedKey, meaningKey: m.key, lemma: e.lemma, pos: e.pos, promoted: true,
        translation: m.translation,
        senseKey: m.senseKey ?? null,
        gloss: (m.gloss ?? '').trim() || null,
        prompt: renderPrompt(m.translation, e.pos, m.enUncountable === true, m.enProper === true),
        tokens: slotTokens(m.translation, e.pos, m.enUncountable === true, m.enProper === true),
      })
    }
  }
  return slots
}

// A slot's sense identity for the "contested" test: its grouping key, or a unique solo id when it has
// none (an ungrouped slot is its OWN sense — sharing a token with it is a real, unresolved collision).
const senseId = (s) => s.senseKey || `#solo:${s.seedKey}:${s.meaningKey}`

// Classify every slot as self-clear or bare-ambiguous, in place.
//   token is CONTESTED  = produced by ≥2 DISTINCT sense ids (same-sense synonyms sharing it don't count)
//   slot is SELF-CLEAR  = has ≥1 non-contested token (a token unique to its sense pins the whole prompt)
//   slot is BARE-AMBIG  = every token it shows is contested (nothing pins it → needs a disambiguator)
export function classify(slots) {
  const tokenSenses = new Map() // token -> Set(senseId)
  for (const s of slots) {
    for (const t of s.tokens) {
      if (!tokenSenses.has(t)) tokenSenses.set(t, new Set())
      tokenSenses.get(t).add(senseId(s))
    }
  }
  const contested = (t) => (tokenSenses.get(t)?.size ?? 0) > 1
  for (const s of slots) {
    s.contestedTokens = [...s.tokens].filter(contested)
    s.selfClear = s.tokens.size === 0 || [...s.tokens].some((t) => !contested(t))
    s.bareAmbiguous = !s.selfClear
  }
  return { slots, tokenSenses }
}

// A production CARD is what the learner sees: producers that share a senseKey collapse into one
// multi-answer card ("N ways to say it", per session-composer.ts); a keyless producer is its own solo
// card. Its "face" = rendered prompt + gloss. Two DISTINCT cards must never share a face, or the learner
// can't tell them apart. Because the runtime shows whichever grouped member is earliest-due, we treat
// EVERY member's (prompt, gloss) as a face the card can present (conservative). Returns the clashing
// faces — a face carried by ≥2 distinct cards — each with a representative slot per card for reporting.
export function findCardClashes(slots) {
  const cardOf = (s) => s.senseKey || `#solo:${s.seedKey}:${s.meaningKey}`
  const faceToCards = new Map() // face -> Map(cardId -> representative slot)
  for (const s of slots) {
    const face = `${s.prompt.toLowerCase()}||${(s.gloss ?? '').toLowerCase()}`
    if (!faceToCards.has(face)) faceToCards.set(face, new Map())
    const byCard = faceToCards.get(face)
    if (!byCard.has(cardOf(s))) byCard.set(cardOf(s), s)
  }
  const clashes = []
  for (const [, byCard] of faceToCards) if (byCard.size > 1) clashes.push({ cards: [...byCard.values()] })
  return clashes
}

// --- gloss-quality predicates (for the bare-ambiguous set) ---
const POS_WORD = /(?:^|[\s(,:/])(verb|noun|adj|adjective|adv|adverb|prep|preposition|conj|conjunction|pron|pronoun|interj|interjection|num|numeral|article|determiner|particle)(?:$|[\s),:./])/i
// A gloss that only tags part of speech (`feed (verb)`, `noun: book`, `assault, noun`, `on, preposition`).
export function isPosTagGloss(gloss) {
  return POS_WORD.test(gloss ?? '')
}

const STOP = new Set(['to', 'a', 'an', 'the', 'of', 'with', 'in', 'on', 'or', 'be', 'and', 'as', 'for'])
const contentWords = (s) =>
  new Set(
    (s ?? '')
      .toLowerCase()
      .replace(POS_WORD, ' ')
      .split(/[^a-z']+/)
      .filter((w) => w && !STOP.has(w)),
  )
// A gloss that adds no content word beyond its own translation — it just restates it (`book, reserve →
// reserve`). Empty gloss is not an echo (that's the "missing" case).
export function isEchoGloss(gloss, translation) {
  const g = contentWords(gloss)
  if (g.size === 0) return false
  const t = contentWords(translation)
  for (const w of g) if (!t.has(w)) return false
  return true
}
