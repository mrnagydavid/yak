// Shared seed-pipeline library: the layer manifest, loaders, and the field-resolution that turns
// base + layers into candidate-shaped entries. Both the reducer (apply-decisions.mjs) and the
// batchers/staleness tools import from here so "what the LLM was shown" and "what ships" agree.
//
// Precedence & ownership (reproduces today's build exactly — see SEED-PIPELINE-DESIGN.md):
//   The four `decisions` layers (10 cleaner, 20 pos, 30 subdef, 90 manual) collapse to a single
//   effective record per kellyId — the HIGHEST layer that has an opinion wins WHOLESALE (matching the
//   old "alphabetically-last decisions/ file wins"). The translation layer (40) then overrides the
//   main translation + meaning list where it spoke; the examples layer (60) supplies examples; the
//   senses layer (50) stamps the production-grouping marker post-collapse (handled by the reducer).
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'

export const SEED_DIR = 'data/seed/sv'
export const SCRATCH_DIR = 'data/scratch/sv' // gitignored, regenerable: fetch/join artifacts + batch dirs
export const MAX_EXAMPLE_LEN = 160 // flashcard examples stay short — drop any longer (poetry/quote dumps)

// ---- transforms (ported verbatim from the original apply-decisions.mjs) ----
export const cleanTranslation = (t) => t.replace(/\s+/g, ' ').replace(/[\s:;,]+$/, '').trim()
export const cleanIpa = (ipa) => ipa.replace(/^\/+/, '').replace(/\/+$/, '').trim()
// Short per-entry content hash for changed-only seed-sync. Computed over the entry *without* `h`.
export const entryHash = (e) => createHash('sha256').update(JSON.stringify(e)).digest('hex').slice(0, 8)

// Strip a leading article/particle so the native lemma is bare — the renderer re-adds it. POS-aware.
export function bareNative(pos, t) {
  if (pos === 'noun') return t.replace(/^(an?|the)\s+/i, '').trim() || t
  if (pos === 'verb') return t.replace(/^to\s+/i, '').trim() || t
  return t
}

export const CEFR_RANK = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 }
// Compare primary sense only (drop synonyms/clarifications after the first ,/;/( ), ignore leading article/"to".
export const normTr = (s) =>
  (s ?? '')
    .toLowerCase()
    .split(/[;,(]/)[0]
    .replace(/^(an?|the|to)\s+/, '')
    .trim()
export const richness = (e) =>
  (e.subDefinitions?.length ?? 0) + (e.examples?.length ?? 0) + Object.keys(e.inflections ?? {}).length
// Whole-string equality after lowercasing, dropping a leading article/"to", flattening punctuation.
export const flatten = (s) => (s ?? '').toLowerCase().replace(/^(an?|the|to)\s+/, '').replace(/[\s.,;:()]+/g, ' ').trim()
export const sameText = (a, b) => flatten(a) === flatten(b)

// Collapse "same word, multiple POS, same meaning" duplicates into one card. (Ported verbatim.)
export function collapseDuplicates(entries, { quiet = false } = {}) {
  const groups = new Map()
  for (const e of entries) {
    if (groups.has(e.lemma) === false) groups.set(e.lemma, [])
    groups.get(e.lemma).push(e)
  }
  const out = []
  let collapsed = 0
  for (const rows of groups.values()) {
    const sameTr = new Set(rows.map((r) => normTr(r.translation))).size === 1
    const distinctPos = new Set(rows.map((r) => r.pos)).size === rows.length
    if (rows.length === 1 || sameTr === false || distinctPos === false) {
      out.push(...rows)
      continue
    }
    rows.sort((a, b) => CEFR_RANK[a.cefr] - CEFR_RANK[b.cefr] || richness(b) - richness(a))
    const keep = { ...rows[0] }
    const subDefinitions = (rows[0].subDefinitions ?? []).slice(0, 4)
    const examples = (rows[0].examples?.length ? rows[0].examples : [...new Set(rows.flatMap((r) => r.examples ?? []))]).slice(0, 2)
    if (subDefinitions.length) keep.subDefinitions = subDefinitions
    else delete keep.subDefinitions
    if (examples.length) keep.examples = examples
    else delete keep.examples
    out.push(keep)
    collapsed += rows.length - 1
  }
  if (!quiet) console.log(`collapsed ${collapsed} duplicate-lemma rows (${entries.length} → ${out.length})`)
  return out
}

// kellyId becomes the seed's stable cross-version key (seedKey). (SPEC §9 / seed-sync)
export const toSeedEntry = (e) => {
  const { kellyId, ...rest } = e
  return { seedKey: kellyId, ...rest }
}

// ---- manifest + layer loaders ----
export async function loadManifest() {
  return JSON.parse(await readFile(`${SEED_DIR}/layers.json`, 'utf-8'))
}
export async function loadBase() {
  return JSON.parse(await readFile(`${SEED_DIR}/base.json`, 'utf-8'))
}
export const layerDir = (layer) => `${SEED_DIR}/layers/${layer.id}-${layer.name}`

// Token-synonym merges (SEED-PIPELINE-DESIGN.md §4.8): the human-curated widening of concept
// detection from first-token identity (`normTr`) to token overlap, scoped to the solo promoted
// meanings that need it. `merges` are extra concepts to hand the gloss/sense pass — each a full,
// explicit member set + a stable `english` — so a promoted meaning whose synonym lives under a later
// token (panna's "pan, pot" ↔ kastrull "saucepan, pot, pan") can group. `keepSeparate` records the
// collisions a human ruled "different sense, stay solo" (laga/kock, skuld/skylla…) so the standing
// guard (detect-token-synonyms.mjs) knows they're reviewed and doesn't re-flag them. Absent file →
// empty (safe bootstrap). See groupConcepts.
export async function loadTokenSynonyms() {
  const file = `${SEED_DIR}/token-synonyms.json`
  if (!existsSync(file)) return { merges: [], keepSeparate: [] }
  const j = JSON.parse(await readFile(file, 'utf-8'))
  return { merges: j.merges ?? [], keepSeparate: j.keepSeparate ?? [] }
}

// A layer's top-level decision file(s), merged last-wins by kellyId. runs/ (a subdir) and stale.json
// are ignored here — only the compile/stale tools read those. Used for `decisions`, `translation`,
// `examples` layers (all kellyId-keyed). The `senses` layer is a concept list — see loadSenseStamps.
export async function loadLayerById(layer) {
  const dir = layerDir(layer)
  const byId = new Map()
  if (!existsSync(dir)) return byId
  const files = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.json') && e.name !== 'stale.json')
    .map((e) => e.name)
    .sort()
  for (const f of files) for (const rec of JSON.parse(await readFile(`${dir}/${f}`, 'utf-8'))) byId.set(rec.kellyId, rec)
  return byId
}

// The gloss pass's compiled concept list → Map("kellyId:meaningKey" → {key, gloss, conceptSenses}).
// A member is either a bare kellyId (legacy primary-only answers → meaningKey 0) or {kellyId,
// meaningKey} (the §12 expansion, which can point at a promoted altMeaning). `conceptSenses` is how
// many senses the English phrase carries — the reducer blanks a gloss only when the phrase is
// single-sense (no ambiguity), never when it has sibling senses. `key` (`english#i`) is the synonym
// grouping key; only the primary slot uses it (altMeaning grouping is deferred, §12 non-goal).
export async function loadSenseStamps(layer) {
  const file = `${layerDir(layer)}/decisions.json`
  const byId = new Map()
  if (!existsSync(file)) return byId
  for (const concept of JSON.parse(await readFile(file, 'utf-8'))) {
    const senses = concept.senses ?? []
    senses.forEach((s, i) => {
      const key = `${concept.english}#${i}`
      const gloss = (s.gloss ?? '').trim()
      for (const m of s.members ?? []) {
        const kellyId = typeof m === 'number' ? m : m.kellyId
        const meaningKey = typeof m === 'number' ? 0 : (m.meaningKey ?? 0)
        byId.set(`${kellyId}:${meaningKey}`, { key, gloss, conceptSenses: senses.length })
      }
    })
  }
  return byId
}

// ---- field resolution: base + layers → candidate-shaped entries ----
// decisionMapsLowToHigh: Maps for the `decisions` layers in precedence order (last wins wholesale).
// translationMap / exampleMap: the layer-40 / layer-60 maps, or null to exclude (batchers freeze input
// by passing only the layers *below* the layer being batched). Returns entries + drop/omit counts.
// This is byte-for-byte the original apply-decisions inner loop; only the input sourcing is injected.
export function resolveEntries(base, { decisionMapsLowToHigh = [], translationMap = null, exampleMap = null, splitMap = null } = {}) {
  const entries = []
  let dropped = 0
  for (const c of base) {
    let d
    for (const m of decisionMapsLowToHigh) if (m.has(c.kellyId)) d = m.get(c.kellyId)
    if (d?.decision === 'drop') {
      dropped++
      continue
    }
    const isFix = d?.decision === 'fix'
    const fixTranslation = isFix ? (d.proposedTranslation ?? '').trim() : ''
    const td = translationMap?.get(c.kellyId)
    const curatedTranslation = (td?.translation ?? '').trim()
    const translation = bareNative(c.pos, cleanTranslation(curatedTranslation || fixTranslation || c.translation || ''))
    if (!translation) continue // no translation yet (unmatched, pending cleanup) → omit
    let subDefinitions
    if (td && Array.isArray(td.senses)) {
      // `senses` is now the word's OTHER possible meanings — the primary (and any promoted meaning)
      // are excluded by the curator. So ANY non-empty list is meaningful. The old `>= 2` guard assumed
      // the list led with the primary (a lone entry meant "just the primary restated" → drop it); that
      // no longer holds. (multi-meaning design §4.8 / subDefinitions = "other meanings only")
      subDefinitions = td.senses.map(cleanTranslation).filter(Boolean)
    } else {
      const subSource = isFix ? (d.proposedSubDefinitions ?? c.subDefinitions) : c.subDefinitions
      subDefinitions = (subSource ?? []).map(cleanTranslation).filter(Boolean)
    }
    // Meaning-list partition (multi-meaning design): the split layer (45) promotes distinct meanings
    // into their own production cards (`altMeanings`) and repartitions the reference list wholesale.
    // manual(90) — the highest decisions layer, so `d` here — outranks the split layer. `altMeanings`
    // is a field no other layer writes, so a word that declares no split is byte-identical to before.
    let altMeanings
    const splitRec = splitMap?.get(c.kellyId)
    const partition = d?.altMeanings ? d : splitRec?.altMeanings ? splitRec : null
    if (partition) {
      // A promoted meaning's gloss AND its grouping key come wholesale from the sense pass (layer 50,
      // stamped by the reducer) — never from the split/manual layer here. A split-layer gloss is only a
      // candidate the sense pass may adopt; a manual (90) split sits ABOVE the pass, so it can't be
      // glossed or grouped (author splittable meanings in 45-split, not 90). So altMeanings carry only
      // their translation here; the reducer adds `gloss` + `senseKey`. (§12 grouping follow-up)
      // Senses the primary already carries (its comma/semicolon-joined pieces). A promoted meaning that
      // duplicates one of these is a curation echo (primary "circle; circuit" + promoted "circuit"),
      // not a real split — drop it. Also dedupes promoted meanings against each other. (safety)
      const taken = new Set(translation.toLowerCase().split(/[;,]/).map((s) => s.trim()).filter(Boolean))
      altMeanings = []
      for (const m of partition.altMeanings ?? []) {
        const t = bareNative(c.pos, cleanTranslation(typeof m === 'string' ? m : (m.translation ?? '')))
        if (!t) continue
        const firstSense = t.toLowerCase().split(/[;,]/)[0].trim()
        if (taken.has(t.toLowerCase()) || taken.has(firstSense)) continue
        taken.add(t.toLowerCase())
        taken.add(firstSense)
        const enUncountable = typeof m === 'object' && m.enUncountable === true
        altMeanings.push({ key: altMeanings.length + 1, translation: t, ...(enUncountable ? { enUncountable: true } : {}) })
      }
      subDefinitions = (partition.subDefinitions ?? []).map(cleanTranslation).filter(Boolean)
    }
    const enUncountable = td?.uncountable === true
    const svUncountable = d?.svUncountable === true
    const ipa = (isFix ? (d.proposedIpa ?? '').trim() : '') || c.ipa
    const exRec = exampleMap?.get(c.kellyId)
    const curatedExamples = Array.isArray(exRec?.examples) ? exRec.examples : undefined
    const examples = (curatedExamples ?? c.examples ?? []).filter((e) => e.length <= MAX_EXAMPLE_LEN).slice(0, 2)
    entries.push({
      kellyId: c.kellyId, // internal — stripped before the seed is written
      lemma: c.lemma,
      pos: c.pos,
      cefr: c.cefr,
      ...(c.gender ? { gender: c.gender } : {}),
      ...(ipa ? { ipa: cleanIpa(ipa) } : {}),
      ...(Object.keys(c.inflections).length ? { inflections: c.inflections } : {}),
      ...(subDefinitions.length ? { subDefinitions } : {}),
      ...(altMeanings?.length ? { altMeanings } : {}),
      ...(enUncountable ? { enUncountable: true } : {}),
      ...(svUncountable ? { svUncountable: true } : {}),
      ...(examples.length ? { examples } : {}),
      translation,
    })
  }
  return { entries, dropped, omitted: base.length - entries.length - dropped }
}

// Build the resolution context for the reducer (all layers) or a batcher (layers strictly below
// `upToExclusive`). Reads every kellyId-keyed layer per the manifest.
export async function loadResolutionContext(manifest, { upToExclusive = Infinity } = {}) {
  const decisionMapsLowToHigh = []
  let translationMap = null
  let exampleMap = null
  let splitMap = null
  for (const layer of manifest) {
    if (layer.id >= upToExclusive) continue
    if (layer.kind === 'decisions') decisionMapsLowToHigh.push(await loadLayerById(layer))
    else if (layer.kind === 'translation') translationMap = await loadLayerById(layer)
    else if (layer.kind === 'examples') exampleMap = await loadLayerById(layer)
    else if (layer.kind === 'split') splitMap = await loadLayerById(layer)
  }
  return { decisionMapsLowToHigh, translationMap, exampleMap, splitMap }
}

// ---- assembled views: base + layers → the shipped shape (or a frozen "layers below" view) ----
// Production grouping: a "concept" is one English phrase produced by ≥2 Swedish MEANING-SLOTS. A slot
// is a primary translation (meaningKey 0) OR a promoted altMeaning (§12 expansion — a promoted meaning
// like `route` of `led` competes for its English against other Swedish words too). Grouped by the
// phrase's primary sense (normTr). The member shape is the gloss pass's frozen INPUT — lean, so it
// re-stales only when the producing slot-set changes (cefr/subDefinitions/examples are supplementary
// context the batcher adds, not identity). `english` = the first PRIMARY slot's phrase, so it stays
// byte-identical to the old primary-only grouping for every pre-existing concept (reconcile-safe).
// `merges` (from loadTokenSynonyms) widen detection beyond first-token identity for a curated set of
// solo promoted meanings: each merge lists a full slot set that should be considered ONE concept and
// carries a stable `english`. A slot named in any merge is pulled out of normal first-token bucketing
// and placed only in its merge concept, so the two never double-count. Because every merged slot was
// either solo (its first-token bucket had <2 members) or explicitly re-listed to reconstitute an
// existing concept, first-token concepts NOT named in a merge stay byte-identical (Approach A: tiny
// blast radius). Member order (primaries first, then promoted, both in finalEntries order) is kept for
// merge concepts too, so their staleness hash is deterministic.
export function groupConcepts(finalEntries, merges = []) {
  const primaries = []
  const promoted = []
  for (const e of finalEntries) {
    primaries.push({ kellyId: e.kellyId, meaningKey: 0, lemma: e.lemma, pos: e.pos, cefr: e.cefr, promoted: false, translation: e.translation })
    for (const m of e.altMeanings ?? [])
      promoted.push({ kellyId: e.kellyId, meaningKey: m.key, lemma: e.lemma, pos: e.pos, cefr: e.cefr, promoted: true, translation: m.translation })
  }
  const allSlots = [...primaries, ...promoted]
  const shape = (p) => ({ kellyId: p.kellyId, meaningKey: p.meaningKey, lemma: p.lemma, pos: p.pos, promoted: p.promoted })
  const mergedIds = new Set()
  for (const g of merges) for (const m of g.members) mergedIds.add(`${m.kellyId}:${m.meaningKey}`)

  const byPhrase = new Map()
  // Primaries first so a group's rows[0] (→ its `english`) is the first primary — stable across the
  // grouping change; promoted slots then join the phrases they compete for. Merge-owned slots skip
  // first-token bucketing entirely (they belong only to their merge concept).
  for (const p of allSlots) {
    if (mergedIds.has(`${p.kellyId}:${p.meaningKey}`)) continue
    const k = normTr(p.translation)
    if (!k) continue
    if (byPhrase.has(k) === false) byPhrase.set(k, [])
    byPhrase.get(k).push(p)
  }
  const concepts = []
  for (const rows of byPhrase.values()) {
    if (rows.length < 2) continue
    concepts.push({ english: rows[0].translation, members: rows.map(shape) })
  }
  // Curated token-overlap concepts, appended. `english` is explicit (stable across re-runs); members
  // are gathered in finalEntries scan order. A merge that resolves to <2 present slots is skipped —
  // the detect-token-synonyms guard reports it rather than the build silently minting a solo "concept".
  for (const g of merges) {
    const rows = allSlots.filter((p) => g.members.some((m) => m.kellyId === p.kellyId && m.meaningKey === p.meaningKey))
    if (rows.length < 2) continue
    concepts.push({ english: g.english ?? rows[0].translation, members: rows.map(shape) })
  }
  return concepts
}

// Ambiguous = a lemma carried by >1 surviving card (fast conj/adj, val en/ett). (Ported.)
export function computeAmbiguous(finalEntries) {
  const byLemma = new Map()
  for (const e of finalEntries) {
    if (byLemma.has(e.lemma) === false) byLemma.set(e.lemma, [])
    byLemma.get(e.lemma).push(e)
  }
  const ambiguous = []
  for (const rows of byLemma.values()) {
    if (rows.length < 2) continue
    for (const e of rows)
      ambiguous.push({
        kellyId: e.kellyId,
        lemma: e.lemma,
        pos: e.pos,
        gender: e.gender ?? null,
        cefr: e.cefr,
        translation: e.translation,
        currentExamples: e.examples ?? [],
      })
  }
  return ambiguous
}

// Assemble base + layers (all of them, or only those strictly below `upToExclusive`) into the
// collapsed final entries plus the derived concept / ambiguous views. The full build (upTo=∞) is what
// ships; a partial build (upTo=<layer id>) is the frozen INPUT an LLM layer is shown — see
// SEED-PIPELINE-DESIGN.md §4.5. Manual (90) is above everything, so it is never part of a frozen input.
export async function assemble(manifest, { upToExclusive = Infinity } = {}) {
  const base = await loadBase()
  const ctx = await loadResolutionContext(manifest, { upToExclusive })
  const { entries, dropped, omitted } = resolveEntries(base, ctx)
  const finalEntries = collapseDuplicates(entries, { quiet: upToExclusive !== Infinity })
  const { merges } = await loadTokenSynonyms()
  return { finalEntries, concepts: groupConcepts(finalEntries, merges), ambiguous: computeAmbiguous(finalEntries), dropped, omitted }
}

// ---- staleness: frozen input → short hash ----
// Stable-key JSON so the hash is order-independent for object keys (arrays keep their order).
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}
export const shortHash = (v) => createHash('sha256').update(canonical(v)).digest('hex').slice(0, 8)

// The curation-relevant slice of a resolved entry: what a per-word LLM layer (translation, examples)
// starts from. A change here is the actionable signal to re-curate that word.
export const wordFrozenInput = (e) => ({
  lemma: e.lemma,
  pos: e.pos,
  gender: e.gender ?? null,
  cefr: e.cefr,
  translation: e.translation,
  subDefinitions: e.subDefinitions ?? [],
})

// inputHash per LLM layer, computed from its frozen input (base + layers below). Keyed by kellyId for
// per-word layers (translation, examples) and by `english` for the concept-based senses layer.
export async function computeInputHashes(manifest) {
  const out = {}
  for (const layer of manifest) {
    if (layer.kind === 'translation' || layer.kind === 'examples' || layer.kind === 'split') {
      const { finalEntries } = await assemble(manifest, { upToExclusive: layer.id })
      out[layer.kind] = new Map(finalEntries.map((e) => [e.kellyId, shortHash(wordFrozenInput(e))]))
    } else if (layer.kind === 'senses') {
      const { concepts } = await assemble(manifest, { upToExclusive: layer.id })
      out.senses = new Map(concepts.map((c) => [c.english, shortHash(c)]))
    }
  }
  return out
}
