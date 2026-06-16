// Stream the kaikki.org Swedish extract (en.wiktionary via wiktextract, CC-BY-SA), keep only
// entries whose word is a Kelly lemma, and trim to what the seed needs.
// Output: data/intermediate/wik.json — { [lemma]: [{ pos, glosses, forms, ipa, examples }] }
// Run: node scripts/seed/fetch-wiktionary.mjs   (downloads ~334MB on first run, then caches)
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const KAIKKI_URL = 'https://kaikki.org/dictionary/Swedish/kaikki.org-dictionary-Swedish.jsonl'
const CACHE = 'data/intermediate/kaikki-sv.jsonl'
const OUT = 'data/intermediate/wik.json'

// wiktextract pos → our PartOfSpeech (for matching against Kelly).
function normPos(pos) {
  const map = {
    noun: 'noun',
    verb: 'verb',
    adj: 'adj',
    adv: 'adv',
    prep: 'prep',
    conj: 'conj',
    pron: 'pron',
    num: 'num',
    intj: 'interj',
  }
  return map[pos] ?? 'other'
}

// Drop wiktextract meta/error forms; keep real inflected forms.
const SKIP_TAGS = new Set(['table-tags', 'inflection-template', 'class'])
function keepForm(f) {
  if (!f.form || !f.tags) return false
  if (f.tags.some((t) => SKIP_TAGS.has(t) || t.startsWith('error'))) return false
  return true
}

async function main() {
  if (!existsSync(CACHE)) {
    process.stdout.write('downloading kaikki Swedish extract (~334MB)… ')
    const res = await fetch(KAIKKI_URL)
    if (!res.ok) throw new Error(`kaikki HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body), createWriteStream(CACHE))
    console.log('done')
  }
  console.log('cache size:', (statSync(CACHE).size / 1e6).toFixed(0), 'MB')

  const kelly = JSON.parse(await readFile('data/intermediate/kelly.json', 'utf-8'))
  const wanted = new Set(kelly.map((e) => e.lemma))

  const out = {}
  let scanned = 0
  let matched = 0
  const rl = createInterface({ input: createReadStream(CACHE), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line) continue
    scanned++
    let o
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    const word = o.word
    if (!word || !wanted.has(word)) continue
    matched++
    // Prefer real definitions; ignore redirect senses — "form-of" ("indefinite neuter singular of
    // alternativ") and "alt-of" ("alternative spelling of i morgon", "alternative letter-case form
    // of CD"). Their gloss is a pointer, not a translation. If the word is ONLY a redirect, record
    // its base word for resolution in join.
    const isRedirect = (s) => s.tags?.includes('form-of') === true || s.tags?.includes('alt-of') === true
    const realSenses = (o.senses ?? []).filter((s) => isRedirect(s) === false)
    const glosses = realSenses
      .map((s) => (s.glosses ?? [])[0])
      .filter(Boolean)
      .slice(0, 6)
    const formOf =
      glosses.length === 0
        ? (o.senses ?? []).map((s) => s.form_of?.[0]?.word ?? s.alt_of?.[0]?.word).find(Boolean)
        : undefined
    const examples = (o.senses ?? [])
      .flatMap((s) => s.examples ?? [])
      .map((ex) => ex.text)
      .filter(Boolean)
      .slice(0, 2)
    const forms = (o.forms ?? []).filter(keepForm).map((f) => ({ form: f.form, tags: f.tags }))
    const ipa = (o.sounds ?? []).map((s) => s.ipa).filter(Boolean)[0]
    ;(out[word] ??= []).push({ pos: normPos(o.pos), glosses, formOf, forms, ipa, examples })
  }

  await writeFile(OUT, JSON.stringify(out))
  console.log(`scanned ${scanned} lines, matched ${matched} entries for ${Object.keys(out).length} lemmas →`, OUT)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
