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

// The senses layer's compiled concept list → Map(kellyId → {key, gloss, single}). (Ported verbatim.)
export async function loadSenseStamps(layer) {
  const file = `${layerDir(layer)}/decisions.json`
  const byId = new Map()
  if (!existsSync(file)) return byId
  for (const concept of JSON.parse(await readFile(file, 'utf-8'))) {
    ;(concept.senses ?? []).forEach((s, i) => {
      const key = `${concept.english}#${i}`
      const gloss = (s.gloss ?? '').trim()
      const single = (s.members ?? []).length === 1
      for (const kellyId of s.members ?? []) byId.set(kellyId, { key, gloss, single })
    })
  }
  return byId
}

// ---- field resolution: base + layers → candidate-shaped entries ----
// decisionMapsLowToHigh: Maps for the `decisions` layers in precedence order (last wins wholesale).
// translationMap / exampleMap: the layer-40 / layer-60 maps, or null to exclude (batchers freeze input
// by passing only the layers *below* the layer being batched). Returns entries + drop/omit counts.
// This is byte-for-byte the original apply-decisions inner loop; only the input sourcing is injected.
export function resolveEntries(base, { decisionMapsLowToHigh = [], translationMap = null, exampleMap = null } = {}) {
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
      const list = td.senses.map(cleanTranslation).filter(Boolean)
      subDefinitions = list.length >= 2 ? list : []
    } else {
      const subSource = isFix ? (d.proposedSubDefinitions ?? c.subDefinitions) : c.subDefinitions
      subDefinitions = (subSource ?? []).map(cleanTranslation).filter(Boolean)
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
  for (const layer of manifest) {
    if (layer.id >= upToExclusive) continue
    if (layer.kind === 'decisions') decisionMapsLowToHigh.push(await loadLayerById(layer))
    else if (layer.kind === 'translation') translationMap = await loadLayerById(layer)
    else if (layer.kind === 'examples') exampleMap = await loadLayerById(layer)
  }
  return { decisionMapsLowToHigh, translationMap, exampleMap }
}

// ---- assembled views: base + layers → the shipped shape (or a frozen "layers below" view) ----
// Production grouping: a "concept" is one English translation carried by ≥2 Swedish answers. Grouped
// on the primary gloss (normTr). Returns the member shape the sense-partitioner is shown. (Ported.)
export function groupConcepts(finalEntries) {
  const byTranslation = new Map()
  for (const e of finalEntries) {
    const k = normTr(e.translation)
    if (!k) continue
    if (byTranslation.has(k) === false) byTranslation.set(k, [])
    byTranslation.get(k).push(e)
  }
  const concepts = []
  for (const rows of byTranslation.values()) {
    if (rows.length < 2) continue
    concepts.push({
      english: rows[0].translation,
      members: rows.map((e) => ({
        kellyId: e.kellyId,
        lemma: e.lemma,
        pos: e.pos,
        cefr: e.cefr,
        ...(e.subDefinitions?.length ? { subDefinitions: e.subDefinitions } : {}),
        ...(e.examples?.length ? { examples: e.examples } : {}),
      })),
    })
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
  return { finalEntries, concepts: groupConcepts(finalEntries), ambiguous: computeAmbiguous(finalEntries), dropped, omitted }
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
    if (layer.kind === 'translation' || layer.kind === 'examples') {
      const { finalEntries } = await assemble(manifest, { upToExclusive: layer.id })
      out[layer.kind] = new Map(finalEntries.map((e) => [e.kellyId, shortHash(wordFrozenInput(e))]))
    } else if (layer.kind === 'senses') {
      const { concepts } = await assemble(manifest, { upToExclusive: layer.id })
      out.senses = new Map(concepts.map((c) => [c.english, shortHash(c)]))
    }
  }
  return out
}
