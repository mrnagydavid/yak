// Merge the per-batch translation-curator outputs into the single committed pipeline input the seed
// build reads. Keeps only `fix` objects — a reviewed-and-fine entry emits nothing, so the merged file
// stays a lean list of just the changes (like decisions/, but one file). De-dupes by kellyId (a later
// re-run of a batch overrides an earlier one) so partial / repeated passes are safe.
// Output: data/intermediate/translation-decisions.json
// Run: node scripts/seed/merge-translations.mjs   (after the translation-curator pass, before seed:apply)
import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'

const DIR = 'data/intermediate/tr-decisions' // per-batch outputs (gitignored working artifact)
const OUT = 'data/intermediate/translation-decisions.json'

async function main() {
  const files = existsSync(DIR) ? (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort() : []
  const byId = new Map()
  for (const f of files)
    for (const d of JSON.parse(await readFile(`${DIR}/${f}`, 'utf-8'))) if (d.decision === 'fix') byId.set(d.kellyId, d)
  const merged = [...byId.values()]
  await writeFile(OUT, JSON.stringify(merged, null, 2))
  console.log(`merged ${files.length} batch files → ${OUT} (${merged.length} fixes)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
