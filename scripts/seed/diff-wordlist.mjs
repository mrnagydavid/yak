// Human-readable review report of what changed in wordlist.json, per meaning-slot, as old → new.
// Compares a git ref (default HEAD) against the working wordlist and emits one row per changed slot:
// translation edits, gloss removed / added / changed. Purpose-built so a human can review a sweep
// without reading the 125k-line JSON diff.
//
// Run: node scripts/seed/diff-wordlist.mjs [gitRef]   (writes data/scratch/sv/gloss-sweep-review.txt)
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { SCRATCH_DIR, SEED_DIR } from './lib/layers.mjs'
import { isEchoGloss, isPosTagGloss } from './lib/glossModel.mjs'

const WORDLIST = `${SEED_DIR}/wordlist.json`
const OUT = `${SCRATCH_DIR}/gloss-sweep-review.txt`

// slot map: "seedKey:meaningKey" -> { seedKey, lemma, english, gloss }
function slots(entries) {
  const m = new Map()
  for (const e of entries) {
    if (e.translation) m.set(`${e.seedKey}:0`, { seedKey: e.seedKey, lemma: e.lemma, english: e.translation, gloss: (e.sense?.gloss ?? '').trim() })
    for (const a of e.altMeanings ?? []) m.set(`${e.seedKey}:${a.key}`, { seedKey: e.seedKey, lemma: `${e.lemma}*`, english: a.translation, gloss: (a.gloss ?? '').trim() })
  }
  return m
}

async function main() {
  const ref = process.argv[2] ?? 'HEAD'
  const oldEntries = JSON.parse(execFileSync('git', ['show', `${ref}:${WORDLIST}`], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })) // ref content
  const newEntries = JSON.parse(await readFile(WORDLIST, 'utf-8'))
  const oldS = slots(oldEntries)
  const newS = slots(newEntries)

  const trChanges = [] // translation edited
  const glossRemoved = { rich: [], posTag: [], echo: [] }
  const glossAdded = []
  const glossChanged = []

  for (const [key, n] of newS) {
    const o = oldS.get(key)
    if (!o) continue // new word — not a "change" for this review
    if (o.english !== n.english) trChanges.push({ ...n, from: o.english, to: n.english })
    if (o.gloss !== n.gloss) {
      if (o.gloss && !n.gloss) {
        const rec = { ...n, from: o.gloss }
        if (isPosTagGloss(o.gloss)) glossRemoved.posTag.push(rec)
        else if (isEchoGloss(o.gloss, o.english)) glossRemoved.echo.push(rec)
        else glossRemoved.rich.push(rec)
      } else if (!o.gloss && n.gloss) glossAdded.push({ ...n, to: n.gloss })
      else glossChanged.push({ ...n, from: o.gloss, to: n.gloss })
    }
  }

  const bySeed = (a, b) => a.seedKey - b.seedKey
  const pad = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))
  const L = []
  const section = (title, rows, fmt) => {
    if (!rows.length) return
    L.push('', `━━━ ${title} (${rows.length}) ━━━`, '')
    for (const r of rows.slice().sort(bySeed)) L.push(fmt(r))
  }
  const removed = glossRemoved.rich.length + glossRemoved.posTag.length + glossRemoved.echo.length
  L.push(
    `GLOSS SWEEP — wordlist.json changes vs ${ref}`,
    `translations edited: ${trChanges.length} · glosses removed: ${removed} · glosses improved: ${glossChanged.length} · glosses added: ${glossAdded.length}`,
    `(Stage 1+2 removes redundant glosses only; translation/gloss edits appear here once Stage 3 runs.)`,
    `Rows: <swedish>  <english prompt>   <old> → <new>.   * = a promoted meaning (altMeaning).`,
  )
  section('TRANSLATIONS EDITED', trChanges, (r) => `${pad(r.lemma, 18)} "${r.from}" → "${r.to}"`)
  section('GLOSSES IMPROVED', glossChanged, (r) => `${pad(r.lemma, 18)}${pad(r.english, 34)} "${r.from}" → "${r.to}"`)
  section('GLOSSES ADDED', glossAdded, (r) => `${pad(r.lemma, 18)}${pad(r.english, 34)} — → "${r.to}"`)
  section('GLOSSES REMOVED — semantically rich (worth a skim)', glossRemoved.rich, (r) => `${pad(r.lemma, 18)}${pad(r.english, 34)} "${r.from}" → ✗`)
  section('GLOSSES REMOVED — POS-tag only (mechanically safe)', glossRemoved.posTag, (r) => `${pad(r.lemma, 18)}${pad(r.english, 34)} "${r.from}" → ✗`)
  section('GLOSSES REMOVED — echo of translation (mechanically safe)', glossRemoved.echo, (r) => `${pad(r.lemma, 18)}${pad(r.english, 34)} "${r.from}" → ✗`)

  await mkdir(SCRATCH_DIR, { recursive: true })
  await writeFile(OUT, `${L.join('\n')}\n`)
  console.log(`wrote ${OUT}`)
  console.log(`translations: ${trChanges.length} · removed: ${removed} (rich ${glossRemoved.rich.length}, POS ${glossRemoved.posTag.length}, echo ${glossRemoved.echo.length}) · improved: ${glossChanged.length} · added: ${glossAdded.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
