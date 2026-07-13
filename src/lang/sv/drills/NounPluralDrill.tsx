import { useEffect, useRef, useState } from 'preact/hooks'
import { DrillTopBar } from '../../../components/PracticePlus/DrillTopBar'
import { SpeakButton, WiktionaryLink } from '../../../components/WordActions/WordActions'
import type { Entry } from '../../../db/types'
import type { DrillFeedback } from '../../../drills/useDrillRunner'
import { useDrillRunner } from '../../../drills/useDrillRunner'
import type { DrillRunnerProps } from '../../../drills/types'
import { getRenderer } from '../../index'
import { checkAnswer, normalizeAnswer } from './nounPlural'
import styles from './NounPluralDrill.module.css'

interface Payload {
  typed: string
}

// The word's dictionary form (with its en/ett article) + a link out. The singular is the cue here, so
// its actions can't leak the answer (the plural).
function LemmaActions({ entry }: { entry: Entry }) {
  return (
    <div class={styles.actions}>
      <SpeakButton text={entry.lemma} lang={entry.lang} />
      <WiktionaryLink lemma={entry.lemma} lang={entry.lang} />
    </div>
  )
}

// The noun's key forms on one line (en bil · bilar · bilarna) — shown on a miss so the whole declension
// is visible, not just the one form asked for.
function principalPartsOf(entry: Entry, singularWithArticle: string): string {
  return [singularWithArticle, entry.inflections.indefinitePlural, entry.inflections.definitePlural]
    .filter(Boolean)
    .join(' · ')
}

/**
 * One noun card: a natural-language question ("What is the plural of: en bil?"), a single autofocused
 * input, and — on a miss — a split reveal. Keyed on the cursor by the parent, so every new question
 * REMOUNTS this (resetting the typed value and refocusing for free). Keyboard-first: Enter checks, then
 * Enter continues, so the on-screen keyboard never has to dismiss. On a miss the reveal splits: the
 * correct plural sits on its own below the input, while the English + all forms appear under the question.
 */
function NounCard({
  entry,
  gloss,
  feedback,
  revealing,
  onAnswer,
  onProceed,
}: {
  entry: Entry
  gloss: string
  feedback: DrillFeedback<Payload> | null
  revealing: boolean
  onAnswer: (correct: boolean, payload: Payload) => Promise<void>
  onProceed: () => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const renderer = getRenderer(entry.lang)
  const singular = renderer.renderLemma(entry) // "en bil" / "ett hus"
  const plural = entry.inflections.indefinitePlural ?? ''
  const principalParts = principalPartsOf(entry, singular)

  async function submit() {
    if (feedback || !normalizeAnswer(value)) return
    void onAnswer(checkAnswer(entry, value), { typed: value })
  }

  const inputState = !feedback ? '' : feedback.correct ? styles.inputCorrect : styles.inputWrong

  return (
    <div class={styles.qArea}>
      <div class={styles.prompt}>
        <span class={styles.question}>
          What is the <strong class={styles.target}>plural</strong> of:
        </span>
        <span class={styles.cue}>{singular}</span>
        <LemmaActions entry={entry} />
      </div>

      {/* On a miss: the English + all forms under the question. */}
      {revealing ? (
        <div class={styles.context}>
          {gloss ? <span class={styles.gloss}>{gloss}</span> : null}
          <span class={styles.forms}>{principalParts}</span>
        </div>
      ) : null}

      <div class={styles.inputWrap}>
        <input
          ref={inputRef}
          class={`${styles.input} ${inputState}`}
          type="text"
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (revealing) onProceed()
            else if (!feedback) void submit()
          }}
          autofocus
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          enterkeyhint={revealing ? 'next' : 'go'}
          lang={entry.lang}
        />
      </div>

      {/* The correct plural, on its own line below the input (no hunting through the forms). */}
      {revealing ? (
        <div class={styles.reveal}>
          <span class={styles.revealLabel}>The correct answer</span>
          <span class={styles.answer}>{plural}</span>
        </div>
      ) : null}

      {revealing ? (
        <button type="button" class={styles.continue} onClick={onProceed}>
          Continue
        </button>
      ) : (
        <button type="button" class={styles.submit} disabled={!!feedback} onClick={() => void submit()}>
          Check
        </button>
      )}
      <p class={styles.hint}>{revealing ? 'Press Enter to continue' : 'Press Enter to check'}</p>
    </div>
  )
}

/**
 * The Swedish noun-plural drill (language-coupled UI). The shared `useDrillRunner` owns the queue, live
 * persistence, progress, and the re-queue-until-cleared loop; this shell just renders a fresh keyed card
 * asking for each noun's plural.
 */
export function NounPluralDrill(props: DrillRunnerProps) {
  const { question: q, index, cleared, total, feedback, revealing, answer, proceed, endEarly } =
    useDrillRunner<Payload>(props)

  if (!q) return <p class={styles.muted}>Finishing…</p>

  return (
    <>
      <DrillTopBar cleared={cleared} total={total} onEnd={endEarly} />
      <NounCard
        key={index}
        entry={q.entry}
        gloss={q.gloss}
        feedback={feedback}
        revealing={revealing}
        onAnswer={answer}
        onProceed={proceed}
      />
    </>
  )
}
