// Join Kelly (list + CEFR + POS + gender) with Wiktionary (translation + forms + IPA + examples)
// and ipa-dict (IPA fallback) into candidate entries.
// Output: data/intermediate/candidates.json
// Run: node scripts/seed/join.mjs
import { createWriteStream, existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const IPA_DICT_COMMIT = '43c3570eb3553bdd19fccd2bd0091534889af023'
const IPA_URL = `https://raw.githubusercontent.com/open-dict-data/ipa-dict/${IPA_DICT_COMMIT}/data/sv.txt`
const IPA_CACHE = 'data/intermediate/ipa-sv.txt'
const OUT = 'data/intermediate/candidates.json'

const has = (tags, ...need) => need.every((t) => tags.includes(t))
const not = (tags, ...bad) => bad.every((t) => !tags.includes(t))
const clean = (s) => s.replace(/\s+/g, ' ').trim()

// Remove balanced "(…)" clarification groups but KEEP the surrounding words — Wiktionary glosses
// put clarifications inline ("a (male or female) teacher" → "a teacher", "to (gently) lead" →
// "to lead"). Cutting at the first "(" instead (as before) truncated these to "a"/"to". An
// unbalanced trailing "(" (a cut-off gloss like "China (a large country…") drops everything from it.
function stripParentheticals(s) {
  let out = ''
  let depth = 0
  for (const ch of s ?? '') {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0) out += ch
  }
  return out
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/[\s.,;:]+$/, '')
    .trim()
}

// Split on ';' only at the top level — a ';' inside a parenthetical is part of a clarification, not
// a sense boundary ("Norway (a country…; capital: Oslo)" is ONE sense, not two). Splitting blindly
// produced mangled sub-definitions with orphaned parens ("capital and largest city: Oslo)").
function splitSenses(gloss) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of gloss) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ';' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

function pick(forms, pred) {
  return forms.find((f) => pred(f.tags))?.form
}
function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v))
}

function inflections(pos, forms) {
  if (pos === 'noun')
    return compact({
      definiteSingular: pick(forms, (t) => has(t, 'definite', 'singular') && not(t, 'genitive', 'plural', 'indefinite')),
      indefinitePlural: pick(forms, (t) => has(t, 'indefinite', 'plural') && not(t, 'genitive', 'definite', 'singular')),
      definitePlural: pick(forms, (t) => has(t, 'definite', 'plural') && not(t, 'genitive', 'indefinite', 'singular')),
    })
  if (pos === 'verb')
    return compact({
      presens: pick(forms, (t) => has(t, 'present') && not(t, 'passive', 'subjunctive')),
      preteritum: pick(forms, (t) => has(t, 'past') && not(t, 'passive', 'subjunctive')),
      supinum: pick(forms, (t) => has(t, 'supine') && not(t, 'passive')),
      imperativ: pick(forms, (t) => has(t, 'imperative')),
    })
  if (pos === 'adj')
    return compact({
      komparativ: pick(forms, (t) => has(t, 'comparative') && not(t, 'definite', 'indefinite', 'neuter', 'plural', 'superlative')),
      superlativ: pick(forms, (t) => has(t, 'superlative') && not(t, 'definite', 'indefinite', 'neuter', 'plural', 'comparative')),
    })
  return {}
}

async function loadIpa() {
  if (!existsSync(IPA_CACHE)) {
    const res = await fetch(IPA_URL)
    if (!res.ok) throw new Error(`ipa-dict HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body), createWriteStream(IPA_CACHE))
  }
  const map = {}
  for (const line of (await readFile(IPA_CACHE, 'utf-8')).split('\n')) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const word = line.slice(0, tab).trim().toLowerCase()
    const ipa = line.slice(tab + 1).match(/\/([^/]+)\//)
    if (word && ipa) map[word] = ipa[1]
  }
  return map
}

async function main() {
  const kelly = JSON.parse(await readFile('data/intermediate/kelly.json', 'utf-8'))
  const wik = JSON.parse(await readFile('data/intermediate/wik.json', 'utf-8'))
  const ipaMap = await loadIpa()

  const candidates = kelly.map((k) => {
    const all = wik[k.lemma] ?? []
    const exact = all.filter((w) => w.pos === k.pos)
    // Nouns: Kelly's authoritative gender (en/ett) disambiguates homonyms that Wiktionary splits
    // per etymology (en val "whale" vs ett val "choice"). Prefer the gender-matching objects for
    // translation, forms, IPA and examples; fall back to all exact-POS objects when there's no match.
    const genderMatch = k.pos === 'noun' && k.gender ? exact.filter((w) => w.gender === k.gender) : []
    const preferred = genderMatch.length ? genderMatch : exact
    // Translation/IPA/examples may fall back to any POS (Kelly's POS taxonomy is coarser);
    // inflections only come from an exact POS match to avoid wrong forms.
    const wiks = preferred.length ? preferred : all
    const glosses = [...new Set(wiks.flatMap((w) => w.glosses).map(clean).filter(Boolean))]
    // Primary translation = the first sub-sense of the first gloss (split on ';', which
    // separates distinct senses; ',' separates synonyms and stays), with trailing/inline
    // parenthetical clarifications stripped ("Europe (a continent…)" → "Europe"). The other
    // senses/glosses (kept verbatim) become subdefinitions.
    const senses = splitSenses(glosses[0] ?? '')
    // Primary = first sense with inline parenthetical clarifications removed but the rest kept
    // ("a (male) teacher" → "a teacher"). Comma-separated synonyms ("big, large") stay.
    const stripped = stripParentheticals(senses[0] ?? '')
    const primary = stripped || senses[0]
    const subDefinitions = [...senses.slice(1), ...glosses.slice(1)].slice(0, 4)
    const forms = preferred[0]?.forms ?? []
    return {
      kellyId: k.kellyId,
      lemma: k.lemma,
      pos: k.pos,
      gender: k.gender,
      cefr: k.cefr,
      translation: primary,
      subDefinitions,
      inflections: inflections(k.pos, forms),
      ipa: wiks[0]?.ipa || ipaMap[k.lemma.toLowerCase()],
      examples: wiks[0]?.examples ?? [],
      matched: wiks.length > 0,
    }
  })

  // Resolve form-of entries (no real gloss) to their base word's translation, e.g.
  // "alternativt" → the translation of "alternativ". (SPEC §9 quality)
  const transByLemma = new Map()
  for (const c of candidates) if (c.translation) transByLemma.set(c.lemma, c.translation)
  let resolved = 0
  for (const c of candidates) {
    if (c.translation) continue
    const base = (wik[c.lemma] ?? []).map((w) => w.formOf).find(Boolean)
    if (base && transByLemma.has(base)) {
      c.translation = transByLemma.get(base)
      c.subDefinitions = []
      c.formOf = base
      resolved++
    }
  }
  console.log(`resolved ${resolved} form-of entries to their base translation`)

  await writeFile(OUT, JSON.stringify(candidates))
  const withTr = candidates.filter((c) => c.translation).length
  const withIpa = candidates.filter((c) => c.ipa).length
  const withInfl = candidates.filter((c) => Object.keys(c.inflections).length).length
  console.log(`${candidates.length} candidates → ${OUT}`)
  console.log(`  translation: ${withTr}  ipa: ${withIpa}  inflections: ${withInfl}  unmatched: ${candidates.length - withTr}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
