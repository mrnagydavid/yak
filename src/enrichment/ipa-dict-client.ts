import { db } from '../db/schema'

// Runtime IPA lookup via open-dict-data/ipa-dict. The dictionary file is fetched once per
// language and the parsed result cached in Dexie for offline-fast lookups. The commit hash
// is pinned (SPEC §3, §10.1); updating it is a deliberate code change. Recorded in
// data/sources.json.
export const IPA_DICT_COMMIT = '43c3570eb3553bdd19fccd2bd0091534889af023'

const dictUrl = (lang: string) =>
  `https://cdn.jsdelivr.net/gh/open-dict-data/ipa-dict@${IPA_DICT_COMMIT}/data/${lang}.txt`

// Parse the `word⇥/ipa/[, /ipa2/]` format into a lowercased word → first-IPA (no slashes) map.
function parseDict(text: string): Record<string, string> {
  const dict: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const word = line.slice(0, tab).trim().toLowerCase()
    const ipa = line.slice(tab + 1).match(/\/([^/]+)\//)
    if (word && ipa) dict[word] = ipa[1]
  }
  return dict
}

async function loadDict(lang: string): Promise<Record<string, string>> {
  const cached = await db.ipaDicts.get(lang)
  if (cached) return cached.dict
  const res = await fetch(dictUrl(lang))
  if (!res.ok) throw new Error(`ipa-dict HTTP ${res.status}`)
  const dict = parseDict(await res.text())
  await db.ipaDicts.put({ lang, dict, fetchedAt: Date.now() })
  return dict
}

/** IPA for a lemma (without slashes), or undefined. Fail-soft. */
export async function lookupIpa(lang: string, lemma: string): Promise<string | undefined> {
  try {
    const dict = await loadDict(lang)
    return dict[lemma.trim().toLowerCase()]
  } catch {
    return undefined
  }
}
