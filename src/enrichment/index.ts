import type { EnrichmentCandidate, EnrichmentResult } from '../db/types'
import { lookupIpa } from './ipa-dict-client'
import { lookupWiktionary } from './wiktionary-client'

/**
 * Best-effort enrichment for a word: IPA (ipa-dict) + a list of POS-candidates (Wiktionary),
 * fetched in parallel. Phrases skip Wiktionary but still try ipa-dict. Fully fail-soft. (SPEC §10)
 */
export async function enrich(lang: string, lemma: string): Promise<EnrichmentResult> {
  const isPhrase = lemma.trim().includes(' ')
  const [ipa, candidates] = await Promise.all([
    lookupIpa(lang, lemma),
    isPhrase ? Promise.resolve<EnrichmentCandidate[]>([]) : lookupWiktionary(lang, lemma),
  ])
  return { ipa, candidates }
}

export { lookupIpa } from './ipa-dict-client'
export { lookupWiktionary } from './wiktionary-client'
