// Fetch + parse the Swedish Kelly list (LMF XML, CC-BY-4.0) into a normalised JSON list.
// Output: data/scratch/sv/kelly.json — [{ kellyId, lemma, pos, gender, cefr, freq }]
// Run: node scripts/seed/fetch-kelly.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const KELLY_URL = 'https://svn.spraakbanken.gu.se/sb-arkiv/pub/lmf/kelly/kelly.xml'
const CACHE = 'data/scratch/sv/kelly.xml'
const OUT = 'data/scratch/sv/kelly.json'

const CEFR = { 1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2', 5: 'C1', 6: 'C2' }

// Kelly's `kellyPartOfSpeech` → our PartOfSpeech. Nouns carry gender via "-en"/"-ett".
function mapPos(kelly) {
  const k = kelly.toLowerCase()
  if (k.startsWith('noun')) return 'noun'
  if (k.startsWith('adverb')) return 'adv' // before verb — "adverb" contains "verb"
  if (k.includes('verb')) return 'verb'
  if (k.startsWith('adjective')) return 'adj'
  if (k.startsWith('prep')) return 'prep'
  if (k.startsWith('conj') || k.startsWith('subj')) return 'conj'
  if (k.startsWith('pronoun')) return 'pron'
  if (k.startsWith('numeral')) return 'num'
  if (k.startsWith('interj')) return 'interj'
  if (k.startsWith('particip')) return 'adj'
  return 'other' // proper name, determiner, particle, …
}

function gender(gram, kellyPos) {
  const g = (gram || '').trim()
  if (g === 'en' || g === 'ett') return g
  if (kellyPos.endsWith('-en')) return 'en'
  if (kellyPos.endsWith('-ett')) return 'ett'
  return undefined
}

async function main() {
  await mkdir('data/scratch/sv', { recursive: true })
  if (!existsSync(CACHE)) {
    process.stdout.write('downloading kelly.xml… ')
    const res = await fetch(KELLY_URL)
    if (!res.ok) throw new Error(`Kelly HTTP ${res.status}`)
    await writeFile(CACHE, Buffer.from(await res.arrayBuffer()))
    console.log('done')
  }
  const xml = await readFile(CACHE, 'utf-8')

  const entries = []
  for (const block of xml.split('<LexicalEntry>').slice(1)) {
    const form = block.slice(0, block.indexOf('</FormRepresentation>'))
    const feats = {}
    for (const m of form.matchAll(/<feat att="([^"]+)" val="([^"]*)" \/>/g)) feats[m[1]] = m[2]
    const lemma = feats.writtenForm?.trim()
    const kellyPos = feats.kellyPartOfSpeech ?? ''
    if (!lemma || !feats.cefr) continue
    entries.push({
      kellyId: Number(feats.kellyID),
      lemma,
      pos: mapPos(kellyPos),
      gender: gender(feats.gram, kellyPos),
      cefr: CEFR[Number(feats.cefr)],
      freq: feats.wpm ? Number(feats.wpm.replace(',', '.')) : undefined,
    })
  }

  await writeFile(OUT, JSON.stringify(entries))
  const byCefr = {}
  for (const e of entries) byCefr[e.cefr] = (byCefr[e.cefr] ?? 0) + 1
  console.log(`parsed ${entries.length} Kelly entries →`, OUT)
  console.log('CEFR:', byCefr)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
