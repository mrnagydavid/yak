import { db } from '../db/schema'
import type { EnrichmentCandidate, PartOfSpeech, WiktionaryCacheRecord } from '../db/types'
import { languageName } from '../lang'

// Best-effort enrichment from en.wiktionary's REST HTML: every POS-section in the target
// language becomes a candidate (POS, gender, inflection table, gloss) so the user can pick
// when a word has several senses (e.g. "plan" → adjective / en-noun / ett-noun). en.wiktionary
// is used for its standardized `inflection-table` markup and English labels. Fail-soft;
// cached 30 days. (SPEC §7.4, §10.2)
const TTL_MS = 30 * 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000

const POS_BY_HEADING: Record<string, PartOfSpeech> = {
  noun: 'noun',
  verb: 'verb',
  adjective: 'adj',
  adverb: 'adv',
  preposition: 'prep',
  conjunction: 'conj',
  pronoun: 'pron',
  numeral: 'num',
  interjection: 'interj',
  proverb: 'phrase',
  phrase: 'phrase',
}

export async function lookupWiktionary(lang: string, lemma: string): Promise<EnrichmentCandidate[]> {
  const key = `${lang}:${lemma.trim().toLowerCase()}`
  const cached = await db.wiktionaryCache.get(key)
  if (cached?.candidates && Date.now() - cached.fetchedAt < TTL_MS) return cached.candidates

  let candidates: EnrichmentCandidate[] = []
  try {
    const html = await fetchText(`https://en.wiktionary.org/api/rest_v1/page/html/${encodeURIComponent(lemma.trim())}`)
    if (html) candidates = parse(html, languageName(lang))
  } catch {
    // network/CORS/parse error → leave empty
  }
  const record: WiktionaryCacheRecord = { key, lang, lemma, candidates, fetchedAt: Date.now() }
  await db.wiktionaryCache.put(record)
  return candidates
}

async function fetchText(url: string): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    return res.ok ? await res.text() : null
  } finally {
    clearTimeout(timer)
  }
}

// ---- parsing ----

interface Cell {
  text: string
  header: boolean
}

interface Building {
  pos: PartOfSpeech
  gender?: string
  table?: HTMLTableElement
  gloss?: string
}

function parse(html: string, languageHeading: string): EnrichmentCandidate[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (!doc.body) return []
  const heading = doc.getElementById(languageHeading) // <h2 id="Swedish">
  if (!heading) return []

  const out: EnrichmentCandidate[] = []
  let cur: Building | null = null
  const flush = () => {
    if (cur) out.push(finalize(cur))
    cur = null
  }

  for (const el of sectionNodes(doc, heading)) {
    const tag = el.tagName
    if (tag === 'H3' || tag === 'H4' || tag === 'H5') {
      const name = el.id.replace(/_\d+$/, '').toLowerCase()
      if (POS_BY_HEADING[name]) {
        flush() // a POS heading starts a new candidate
        cur = { pos: POS_BY_HEADING[name] }
      }
      continue
    }
    if (!cur) continue
    if (tag === 'ABBR' && !cur.gender) {
      const title = (el.getAttribute('title') ?? '').toLowerCase()
      if (title === 'common gender') cur.gender = 'en'
      else if (title === 'neuter gender') cur.gender = 'ett'
    } else if (tag === 'TABLE' && !cur.table && el.classList.contains('inflection-table')) {
      cur.table = el as HTMLTableElement
    } else if (tag === 'OL' && !cur.gloss) {
      cur.gloss = glossFrom(el)
    }
  }
  flush()
  return out
}

function finalize(b: Building): EnrichmentCandidate {
  let inflections: Record<string, string> | undefined
  if (b.table) {
    const grid = buildGrid(b.table)
    const inf =
      b.pos === 'verb'
        ? verbInflections(grid)
        : b.pos === 'noun'
          ? nounInflections(grid)
          : b.pos === 'adj'
            ? adjInflections(grid)
            : {}
    if (Object.keys(inf).length > 0) inflections = inf
  }
  return { pos: b.pos, gender: b.gender, inflections, gloss: b.gloss }
}

/** First definition of a sense list, stripped of nested quotes/examples, truncated. */
function glossFrom(ol: Element): string | undefined {
  const li = ol.querySelector(':scope > li')
  if (!li) return undefined
  const clone = li.cloneNode(true) as Element
  clone.querySelectorAll('ul, ol, dl, cite').forEach((n) => n.remove())
  const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.length > 80 ? `${text.slice(0, 77)}…` : text
}

/** Elements in document order between the language's <h2> and the next <h2>. */
function sectionNodes(doc: Document, heading: Element): Element[] {
  const out: Element[] = []
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT)
  let started = false
  while (walker.nextNode()) {
    const el = walker.currentNode as Element
    if (el === heading) {
      started = true
      continue
    }
    if (!started) continue
    if (el.tagName === 'H2') break
    out.push(el)
  }
  return out
}

/** Expand a table into a 2-D grid, resolving rowspan/colspan (cells shared by reference). */
function buildGrid(table: HTMLTableElement): Cell[][] {
  const grid: Cell[][] = []
  Array.from(table.rows).forEach((tr, r) => {
    grid[r] ??= []
    let c = 0
    Array.from(tr.cells).forEach((el) => {
      while (grid[r][c]) c++
      const cell: Cell = { text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), header: el.tagName === 'TH' }
      const rs = el.rowSpan || 1
      const cs = el.colSpan || 1
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          grid[r + dr] ??= []
          grid[r + dr][c + dc] = cell
        }
      }
      c += cs
    })
  })
  return grid
}

function rowCells(row: Cell[]): Cell[] {
  const seen = new Set<Cell>()
  const out: Cell[] = []
  for (const cell of row) {
    if (cell && !seen.has(cell)) {
      seen.add(cell)
      out.push(cell)
    }
  }
  return out
}

// Noun declension: the nominative column across (singular/plural)×(indefinite/definite).
function nounInflections(grid: Cell[][]): Record<string, string> {
  let nomCol = -1
  grid.forEach((row) =>
    row.forEach((cell, c) => {
      if (cell?.header && cell.text.toLowerCase() === 'nominative') nomCol = c
    }),
  )
  const out: Record<string, string> = {}
  for (const row of grid) {
    if (!row) continue
    const headers = new Set(row.filter((c) => c?.header).map((c) => c.text.toLowerCase()))
    const number = headers.has('singular') ? 'sg' : headers.has('plural') ? 'pl' : null
    const def = headers.has('definite') ? 'def' : headers.has('indefinite') ? 'indef' : null
    if (!number || !def) continue
    const value = (nomCol >= 0 ? row[nomCol]?.text : rowCells(row).find((c) => !c.header)?.text) ?? ''
    if (!value || value === '—') continue
    if (number === 'sg' && def === 'def') out.definiteSingular = value
    else if (number === 'pl' && def === 'indef') out.indefinitePlural = value
    else if (number === 'pl' && def === 'def') out.definitePlural = value
  }
  return out
}

// Adjective: the comparative and superlative columns (invariant in the base form).
function adjInflections(grid: Cell[][]): Record<string, string> {
  let compCol = -1
  let supCol = -1
  grid.forEach((row) =>
    row.forEach((cell, c) => {
      if (!cell?.header) return
      const t = cell.text.toLowerCase().replace(/[0-9].*$/, '').trim()
      if (t === 'comparative') compCol = c
      else if (t === 'superlative') supCol = c
    }),
  )
  const out: Record<string, string> = {}
  for (const row of grid) {
    if (!row) continue
    const comp = compCol >= 0 ? row[compCol] : undefined
    const sup = supCol >= 0 ? row[supCol] : undefined
    if (comp && !comp.header && comp.text && comp.text !== '—') out.komparativ ??= comp.text
    if (sup && !sup.header && sup.text && sup.text !== '—') out.superlativ ??= sup.text
  }
  return out
}

// Verb conjugation: the active (leftmost) value of the supine / imperative / indicative rows.
function verbInflections(grid: Cell[][]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of grid) {
    if (!row) continue
    const cells = rowCells(row)
    const label = cells.find((c) => c.header)?.text.toLowerCase().replace(/[0-9].*$/, '').trim()
    const data = cells.filter((c) => !c.header).map((c) => c.text).filter((t) => t && t !== '—')
    if (!label || data.length === 0) continue
    if (label === 'supine') out.supinum ??= data[0]
    else if (label === 'imperative') out.imperativ ??= data[0]
    else if (label === 'indicative') {
      out.presens ??= data[0]
      if (data[1]) out.preteritum ??= data[1]
    }
  }
  return out
}
