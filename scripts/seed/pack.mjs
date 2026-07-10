// The build: pack the hand-edited snapshot (data/seed/sv/wordlist.json) into the shipped seed.
// Replaces apply-decisions.mjs on the day-to-day path — writes the SAME output files:
//   data/seed/sv/seed-sv.json + version.json  and  public/seed-sv.json + version.json
// See SNAPSHOT-PIPELINE-DESIGN.md §5. Run: node scripts/seed/pack.mjs   (alias: pnpm seed:pack)
//
// The snapshot holds ONLY authored fields. This step recomputes the DERIVED ones so they can never go
// stale: `ipaAmbiguous` (a pure cross-entry function of lemma → IPA set), the per-entry content hash
// `h`, and the file-level `version`. It also serializes every entry through ONE fixed key order (§5.1),
// so hand-reordering keys or reflowing whitespace in wordlist.json can never change what ships.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { cleanIpa, entryHash, SEED_DIR } from './lib/layers.mjs'

const SEED_VERSION = 'sv-2026-06-01' // en.wiktionary dump date the kaikki extract is from (unchanged)

// Optional output redirect (mirrors apply-decisions): when SEED_OUT_DIR is set, generated files are
// written under that dir instead of in place. Inputs are always read from the repo. The reproducibility
// guard uses this to pack from committed inputs without clobbering the repo copy.
const OUT_DIR = process.env.SEED_OUT_DIR
const outPath = (p) => (OUT_DIR ? `${OUT_DIR}/${p}` : p)

// ---- fixed key order (§5.1) ----
// h and version use JSON.stringify, which is key-order sensitive, so every entry is serialized through
// exactly this order (absent keys omitted). `ipaAmbiguous` and `h` are derived and slotted in here.
const TOP_ORDER = [
  'seedKey', 'lemma', 'pos', 'cefr', 'gender', 'ipa', 'inflections', 'subDefinitions', 'altMeanings',
  'enUncountable', 'enProper', 'svUncountable', 'svProper', 'examples', 'translation', 'ipaAmbiguous', 'sense', 'h',
]
const ALT_ORDER = ['key', 'translation', 'enUncountable', 'enProper', 'examples', 'senseKey', 'gloss']
const SENSE_ORDER = ['key', 'gloss']
// Boolean render flags: present only when true (absent == false), matching how the reducer wrote them.
const BOOL_FLAGS = new Set(['enUncountable', 'enProper', 'svUncountable', 'svProper', 'ipaAmbiguous'])

// Whether a key carries a meaningful value worth serializing — mirrors the reducer's omit rules so a
// hand-edited empty array / false flag can't spuriously change a hash. (No-op on the generated snapshot,
// which already omits empties; matters only for future hand edits.)
const has = (obj, k) => {
  const v = obj[k]
  if (v == null) return false
  if (BOOL_FLAGS.has(k)) return v === true
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return true
}
const pick = (obj, order) => {
  const out = {}
  for (const k of order) if (has(obj, k)) out[k] = obj[k]
  return out
}
// Canonicalize one entry to the fixed order, WITHOUT `h` (added after hashing). Nested altMeanings and
// sense are rebuilt to their own fixed orders. `inflections` is copied verbatim (its key order is the
// dictionary's and is preserved).
function canonEntry(entry) {
  const out = {}
  for (const k of TOP_ORDER) {
    if (k === 'h') continue
    if (!has(entry, k)) continue
    if (k === 'altMeanings') out[k] = entry[k].map((m) => pick(m, ALT_ORDER))
    else if (k === 'sense') out[k] = pick(entry[k], SENSE_ORDER)
    else out[k] = entry[k]
  }
  return out
}

async function main() {
  const authored = JSON.parse(await readFile(`${SEED_DIR}/wordlist.json`, 'utf-8'))

  // 1. Derive ipaAmbiguous: per lemma collect cleanIpa(e.ipa); a lemma with >1 distinct IPA marks all
  //    its entries (browser TTS can't be steered to a sense, so the app suppresses audio for these; the
  //    IPA text still shows). Ported verbatim from apply-decisions.mjs.
  const ipaByLemma = new Map()
  for (const e of authored) {
    if (!e.ipa) continue
    const set = ipaByLemma.get(e.lemma) ?? new Set()
    set.add(cleanIpa(e.ipa))
    ipaByLemma.set(e.lemma, set)
  }
  const ambiguousKeys = new Set()
  for (const e of authored) if (e.ipa && (ipaByLemma.get(e.lemma)?.size ?? 0) > 1) ambiguousKeys.add(e.seedKey)

  // 2. Canonicalize + set derived ipaAmbiguous. Any authored h/ipaAmbiguous is dropped and recomputed.
  // 3. h = sha256(JSON.stringify(entry-without-h)).slice(0,8) — appended last, matching the fixed order.
  let ipaAmbiguousCount = 0
  const seedEntries = authored.map((e) => {
    const { h: _h, ipaAmbiguous: _ia, ...rest } = e
    if (ambiguousKeys.has(e.seedKey)) {
      rest.ipaAmbiguous = true
      ipaAmbiguousCount++
    }
    const c = canonEntry(rest)
    return { ...c, h: entryHash(c) }
  })

  // 4. version = dump date + a content hash of the full (ordered) entries array. Any curation change
  //    flips the version so the runtime seed-sync picks it up.
  const contentHash = createHash('sha256').update(JSON.stringify(seedEntries)).digest('hex').slice(0, 8)
  const version = `${SEED_VERSION}-${contentHash}`

  // 5 + 6. Assemble and write the shipped files (same filenames the reducer wrote).
  const seed = { version, generatedAt: new Date().toISOString(), count: seedEntries.length, entries: seedEntries }
  const json = JSON.stringify(seed)
  const versionJson = JSON.stringify({ version })
  await mkdir(outPath('data/seed/sv'), { recursive: true })
  await mkdir(outPath('public'), { recursive: true })
  await writeFile(outPath('data/seed/sv/seed-sv.json'), json)
  await writeFile(outPath('public/seed-sv.json'), json)
  await writeFile(outPath('data/seed/sv/version.json'), versionJson)
  await writeFile(outPath('public/version.json'), versionJson)

  console.log(`seed-sv.json: ${seedEntries.length} entries`)
  console.log(`version: ${version}`)
  console.log(`ipa-ambiguous entries (TTS suppressed): ${ipaAmbiguousCount}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
