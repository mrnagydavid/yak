// Review artifact for the gloss sweep, at the level of what the LEARNER ACTUALLY SEES.
//
// It simulates the production cards: producers that share a senseKey collapse into ONE multi-answer
// card ("N ways to say it", per session-composer.ts); everything else is a solo card. Each card shows
// as its rendered prompt + gloss. The real correctness question — the one you'd otherwise ask per group
// — is then mechanical: DO ANY TWO CARDS RENDER IDENTICALLY (same prompt + same gloss)? If yes, the
// learner cannot tell them apart (a real clash). If no, every card is uniquely identifiable, whether by
// its article/"to", its gloss, or by being a group.
//
//   ⚠ CLASH = two distinct cards render to the same prompt+gloss (needs a fix: sharpen a gloss or merge)
//   ✓        = every card is distinguishable (article / gloss / grouping resolves it)
//
// Shows every bare-token neighborhood the sweep touched, plus a GLOBAL clash count over the whole seed.
// Run: node scripts/seed/review-ambiguous.mjs [gitRef]   → data/scratch/sv/ambiguous-review.txt
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { SCRATCH_DIR, SEED_DIR } from './lib/layers.mjs'
import { articleizeToken } from './lib/glossModel.mjs'

const WORDLIST = `${SEED_DIR}/wordlist.json`
const OUT = `${SCRATCH_DIR}/ambiguous-review.txt`

const renderEnglish = (tr, pos, unc, proper) =>
  tr.split(';').map((s) => s.trim()).filter(Boolean).map((s) => articleizeToken(s, pos, unc, proper)).join('; ')
function renderSwedish(e) {
  if (e.pos === 'verb') return `att ${e.lemma}`
  if (e.pos === 'noun') {
    if (e.svProper === true) return e.lemma
    if (e.svUncountable === true) return e.gender ? `(${e.gender}) ${e.lemma}` : e.lemma
    return e.gender ? `${e.gender} ${e.lemma}` : e.lemma
  }
  return e.lemma
}
const bare = (s) => s.trim().toLowerCase().replace(/^(an?|the|to)\s+/, '')
const bareTokens = (tr) => new Set(tr.split(/[;,]/).map(bare).filter(Boolean))

function slotsOf(entries) {
  const out = []
  for (const e of entries) {
    if (e.translation) out.push({ seedKey: e.seedKey, meaningKey: 0, lemma: e.lemma, sv: renderSwedish(e), prompt: renderEnglish(e.translation, e.pos, e.enUncountable === true, e.enProper === true), senseKey: e.sense?.key ?? null, gloss: (e.sense?.gloss ?? '').trim(), bt: bareTokens(e.translation) })
    for (const m of e.altMeanings ?? []) out.push({ seedKey: e.seedKey, meaningKey: m.key, lemma: `${e.lemma}*`, sv: renderSwedish(e), prompt: renderEnglish(m.translation, e.pos, m.enUncountable === true, m.enProper === true), senseKey: m.senseKey ?? null, gloss: (m.gloss ?? '').trim(), bt: bareTokens(m.translation) })
  }
  return out
}

// Collapse producers into the cards the learner sees: ≥2 producers sharing a senseKey → one group card;
// a keyless producer → its own solo card. rep = lowest-seedKey member (drives the shown prompt/gloss).
function buildCards(slots) {
  const bySense = new Map()
  const cards = []
  for (const s of slots) {
    if (!s.senseKey) { cards.push({ id: `solo:${s.seedKey}:${s.meaningKey}`, members: [s] }); continue }
    if (!bySense.has(s.senseKey)) { const c = { id: s.senseKey, members: [] }; bySense.set(s.senseKey, c); cards.push(c) }
    bySense.get(s.senseKey).members.push(s)
  }
  for (const c of cards) {
    c.members.sort((a, b) => a.seedKey - b.seedKey)
    const rep = c.members[0]
    c.prompt = rep.prompt
    c.gloss = rep.gloss
    c.face = `${rep.prompt.toLowerCase()}||${rep.gloss.toLowerCase()}` // what the learner sees → clash key
    c.group = c.members.length > 1
  }
  return cards
}

async function main() {
  const ref = process.argv[2] ?? 'HEAD'
  const oldEntries = JSON.parse(execFileSync('git', ['show', `${ref}:${WORDLIST}`], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }))
  const newEntries = JSON.parse(await readFile(WORDLIST, 'utf-8'))
  const newSlots = slotsOf(newEntries)
  const oldGloss = new Map()
  for (const s of slotsOf(oldEntries)) oldGloss.set(`${s.seedKey}:${s.meaningKey}`, s.gloss)

  const cards = buildCards(newSlots)
  // GLOBAL clash: two distinct cards with an identical face (prompt+gloss).
  const byFace = new Map()
  for (const c of cards) { if (!byFace.has(c.face)) byFace.set(c.face, []); byFace.get(c.face).push(c) }
  const clashFaces = new Set([...byFace].filter(([, cs]) => cs.length > 1).map(([f]) => f))

  // Neighborhoods to display: bare-token groups with ≥2 producers where ≥1 gloss was removed this sweep.
  const removed = (s) => oldGloss.get(`${s.seedKey}:${s.meaningKey}`) && !s.gloss
  const cardOfSlot = new Map()
  for (const c of cards) for (const m of c.members) cardOfSlot.set(`${m.seedKey}:${m.meaningKey}`, c)
  const byToken = new Map()
  for (const s of newSlots) for (const t of s.bt) { if (!byToken.has(t)) byToken.set(t, new Set()); byToken.get(t).add(s) }

  const groups = []
  const seen = new Set()
  for (const [token, slotSet] of byToken) {
    const slots = [...slotSet]
    if (slots.length < 2 || !slots.some(removed)) continue
    const groupCards = [...new Set(slots.map((s) => cardOfSlot.get(`${s.seedKey}:${s.meaningKey}`)))]
    const sig = groupCards.map((c) => c.id).sort().join('|')
    if (seen.has(`${token}#${sig}`)) continue
    seen.add(`${token}#${sig}`)
    const clash = groupCards.some((c) => clashFaces.has(c.face))
    groups.push({ token, cards: groupCards, clash })
  }
  groups.sort((a, b) => (a.clash === b.clash ? a.token.localeCompare(b.token) : a.clash ? -1 : 1))

  const change = (m) => {
    const o = oldGloss.get(`${m.seedKey}:${m.meaningKey}`) || ''
    const n = m.gloss || ''
    return o && !n ? `"${o}" → ✗` : o && n && o === n ? `"${o}" → kept` : o && n ? `"${o}" → "${n}"` : !o && n ? `— → "${n}"` : '—'
  }
  const L = [
    `AMBIGUOUS-CARD REVIEW — what the learner sees, per group with a gloss removed this sweep (vs ${ref})`,
    `A card = producers that share a senseKey (grouped as "N ways to say it") or a lone producer. A group`,
    `is shown as one card; its members are self-graded separately in the app.`,
    `⚠ CLASH = two cards render to the SAME prompt+gloss (learner can't tell them apart) · ✓ = distinguishable`,
    ``,
    `GLOBAL: ${clashFaces.size} clash face(s) across the whole seed (${cards.length} cards).`,
  ]
  if (clashFaces.size) {
    L.push(`Clashing faces (two+ cards render identically — real ambiguity):`)
    for (const f of clashFaces) {
      const cs = byFace.get(f)
      L.push(`  ⚠ "${cs[0].prompt}${cs[0].gloss ? ` (${cs[0].gloss})` : ''}"  ← ${cs.map((c) => c.members.map((m) => m.sv).join('/')).join('   VS   ')}`)
    }
  }
  L.push('', `── touched neighborhoods (${groups.length}: ⚠ ${groups.filter((g) => g.clash).length} · ✓ ${groups.filter((g) => !g.clash).length}) ──`)
  for (const g of groups) {
    L.push('', `${g.clash ? '⚠' : '✓'}  "${g.token}"`)
    const cs = g.cards.slice().sort((a, b) => a.prompt.localeCompare(b.prompt))
    const wS = Math.max(...cs.flatMap((c) => c.members.map((m) => m.sv.length)))
    for (const c of cs) {
      const face = `"${c.prompt}${c.gloss ? ` (${c.gloss})` : ''}"`
      L.push(`  ${face}${c.group ? `   — ${c.members.length} ways to say it` : ''}${clashFaces.has(c.face) ? '   ⚠ CLASH' : ''}`)
      for (const m of c.members) L.push(`      ${m.sv.padEnd(wS)}  ${change(m)}`)
    }
  }
  await mkdir(SCRATCH_DIR, { recursive: true })
  await writeFile(OUT, `${L.join('\n')}\n`)
  console.log(`wrote ${OUT}`)
  console.log(`global clashes: ${clashFaces.size} · touched neighborhoods: ${groups.length} (⚠ ${groups.filter((g) => g.clash).length}, ✓ ${groups.filter((g) => !g.clash).length})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
