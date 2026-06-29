// Merge the per-batch sense partitions (the sense-partitioner pass over sense-batches/) into the single
// file the seed build reads. The numbered per-batch files are just a parallel-dispatch artifact; this
// merged file is the committed pipeline input (like examples/examples.json).
// Output: data/intermediate/sense-decisions.json
// Run: node scripts/seed/merge-senses.mjs   (after the sense-partitioner pass, before seed:apply)
import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'

const DIR = 'data/intermediate/sense-decisions' // per-batch outputs (gitignored working artifact)
const OUT = 'data/intermediate/sense-decisions.json'

async function main() {
  const files = existsSync(DIR) ? (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort() : []
  const merged = []
  for (const f of files) merged.push(...JSON.parse(await readFile(`${DIR}/${f}`, 'utf-8')))
  await writeFile(OUT, JSON.stringify(merged, null, 2))
  console.log(`merged ${files.length} batch files → ${OUT} (${merged.length} concepts)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
