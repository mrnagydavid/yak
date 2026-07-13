import type { DrillType } from '../db/types'
import { adjFormsDrillMeta } from '../lang/sv/drills/adjForms'
import { genderDrillMeta } from '../lang/sv/drills/gender'
import { nounPluralDrillMeta } from '../lang/sv/drills/nounPlural'
import { verbFormsDrillMeta } from '../lang/sv/drills/verbForms'
import type { DrillMeta } from './types'

// Which drills each TARGET language offers. Assembled here (agnostic core) from the per-language
// modules, so the session lifecycle and hub stay language-independent — adding a language's drills is
// one import + one array entry. UI components are resolved separately, in the Practice+ shell.
const DRILLS_BY_LANG: Record<string, DrillMeta[]> = {
  sv: [genderDrillMeta, verbFormsDrillMeta, adjFormsDrillMeta, nounPluralDrillMeta],
}

/** The drills available for a target language (empty if none defined yet). */
export function drillsForLanguage(targetLang: string): DrillMeta[] {
  return DRILLS_BY_LANG[targetLang] ?? []
}

/** Look up one drill's metadata by its type. */
export function getDrillMeta(type: DrillType): DrillMeta | undefined {
  for (const metas of Object.values(DRILLS_BY_LANG)) {
    const found = metas.find((d) => d.type === type)
    if (found) return found
  }
  return undefined
}
