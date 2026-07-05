import type { ActiveDrillSession, DrillType, Entry } from '../db/types'

// Shared, language-agnostic drill contracts. The per-language parts — the eligibility rule and the
// UI component — live in that language's module (e.g. src/lang/sv/drills/); everything here is common.

/**
 * Language-agnostic description of a drill: its identity, the copy shown on the hub, and its
 * eligibility rule. Defined in the owning language's module and registered in `drills/registry.ts`.
 */
export interface DrillMeta {
  type: DrillType
  title: string
  description: string
  /** An optional extra tip / fun fact shown under the description. */
  funFact?: string
  /** Whether a word can appear in this drill. `met` = the learner has met the word in normal practice. */
  eligible(entry: Entry, met: boolean): boolean
}

/** A resolved question: the target word to quiz plus its native-language gloss. Drill-agnostic — each
 *  drill's component reads what it needs off the entry (gender, inflections, …). */
export interface DrillQuestion {
  entry: Entry
  gloss: string
}

/** Props every drill's runner component receives. The runner owns its own Q&A interaction and reports
 *  completion via `onFinish`; the shell owns start/resume/stats transitions. */
export interface DrillRunnerProps {
  session: ActiveDrillSession
  questions: DrillQuestion[]
  onFinish: (finalSession: ActiveDrillSession, endedEarly: boolean) => void
}
