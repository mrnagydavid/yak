// Swedish verb IPA from the open-dict-data ipa-dict fallback is frequently the *present-tense*
// pronunciation (ending in -r / -ɛr) keyed under the infinitive headword — e.g. `riva` → /rˈiːvɛr/
// (that's "river", "runs"). This rewrites such a transcription to the infinitive, using the
// infinitive spelling (`lemma`) and the present spelling (`presens`) to pick the right rule.
//
// Only acts on transcriptions ending in `r` (the bug signature; a correct infinitive ends in a
// vowel). Returns the corrected IPA, the original unchanged when it's already infinitive, or
// `undefined` when the form can't be reconstructed (better blank than a wrong conjugated form).
//
// NOTE: keep in sync with the mirrored copy in scripts/seed/join.mjs — build scripts are plain
// .mjs and cannot import this TS module.
export function infinitivizeVerbIpa(ipa: string, lemma: string, presens?: string): string | undefined {
  if (!ipa.endsWith('r')) return ipa // already infinitive (ends in a vowel)
  if (presens) {
    // group 1 (-ar) and vowel-stems: starta→startar, gå→går, be→ber → drop the trailing r
    if (presens === `${lemma}r`) return ipa.slice(0, -1)
    // group 2/4 (-er): riva→river, sätta→sätter, läsa→läser → present ending -ɛr/-er becomes -a
    if (lemma.endsWith('a') && presens === `${lemma.slice(0, -1)}er`) return ipa.replace(/ɛ?r$/, 'a')
    // strong stem-present: bära→bär, föra→för, jämföra→jämför → the infinitive adds an -a syllable
    if (lemma === `${presens}a`) return `${ipa}a`
  }
  return undefined // can't reconstruct — drop rather than show the present form
}
