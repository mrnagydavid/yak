import { useEffect, useRef, useState } from 'preact/hooks'
import { DrillTopBar } from '../../../components/PracticePlus/DrillTopBar'
import { SpeakButton, WiktionaryLink } from '../../../components/WordActions/WordActions'
import { db } from '../../../db/schema'
import type { Entry } from '../../../db/types'
import type { DrillFeedback } from '../../../drills/useDrillRunner'
import { useDrillRunner } from '../../../drills/useDrillRunner'
import type { DrillRunnerProps } from '../../../drills/types'
import { getRenderer } from '../../index'
import {
  buildFormIndex,
  checkAnswer,
  decodeAccepts,
  isAmbiguousForm,
  normalizeAnswer,
  pickMode,
  promptFor,
  type AdjMode,
} from './adjForms'
import styles from './AdjFormsDrill.module.css'

interface Payload {
  typed: string
}

// The word's base form + a link out — shown next to the cue in produce mode (the base is already on
// screen) and in the reveal for decode (post-answer, so it can't hand over the base form).
function LemmaActions({ entry }: { entry: Entry }) {
  return (
    <div class={styles.actions}>
      <SpeakButton text={entry.lemma} lang={entry.lang} />
      <WiktionaryLink lemma={entry.lemma} lang={entry.lang} />
    </div>
  )
}

// The three degrees of comparison on one line (base · comparative · superlative) — the whole point of
// the drill, so the reveal shows them together rather than the renderer's agreement+comparison summary.
function principalPartsOf(entry: Entry): string {
  return [entry.lemma, entry.inflections.komparativ, entry.inflections.superlativ].filter(Boolean).join(' · ')
}

/**
 * One adjective card: a natural-language question ("What is the comparative of: stor?"), a single
 * autofocused input, and — on a miss — a split reveal. Keyed on the cursor by the parent, so every new
 * question REMOUNTS this (resetting the typed value and refocusing for free). Keyboard-first: Enter
 * checks, then Enter continues, so the on-screen keyboard never has to dismiss.
 *
 * Pedagogy: in the DECODE direction (form → base word) the English is withheld — seeing the meaning
 * would hand over the base word — UNLESS the shown form is ambiguous (shared by >1 adjective, e.g.
 * minst ← liten/få), where the meaning is genuinely needed to choose. On a miss, the reveal splits: the
 * specific correct answer sits on its own below the input, while the English + all three degrees appear
 * under the question.
 */
function AdjCard({
  entry,
  gloss,
  mode,
  formIndex,
  feedback,
  revealing,
  onAnswer,
  onProceed,
}: {
  entry: Entry
  gloss: string
  mode: AdjMode
  formIndex: Map<string, Set<string>> | null
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
  const prompt = promptFor(mode)
  const cueForm = entry.inflections[prompt.slot] ?? ''
  const cueText = prompt.decode ? cueForm : renderer.renderLemma(entry)
  const principalParts = principalPartsOf(entry)
  // What they should have typed: the base form (decode) or the specific degree asked for (produce).
  const correctText = prompt.decode ? renderer.renderLemma(entry) : cueForm
  const ambiguous = prompt.decode && !!formIndex && isAmbiguousForm(formIndex, cueForm)

  async function submit() {
    if (feedback || !normalizeAnswer(value)) return
    let correct = checkAnswer(mode, entry, value)
    // Decode: also accept any OTHER base form that yields the shown surface form (shared forms).
    if (!correct && prompt.decode && formIndex) correct = decodeAccepts(formIndex, cueForm, value)
    void onAnswer(correct, { typed: value })
  }

  const inputState = !feedback ? '' : feedback.correct ? styles.inputCorrect : styles.inputWrong

  return (
    <div class={styles.qArea}>
      <div class={styles.prompt}>
        <span class={styles.question}>
          What is the <strong class={styles.target}>{prompt.targetName}</strong> of:
        </span>
        <span class={styles.cue}>{cueText}</span>
        {/* Produce: the cue IS the base form, so its actions can't leak the answer. */}
        {!prompt.decode ? <LemmaActions entry={entry} /> : null}
      </div>

      {/* Between question and input. Pre-answer: English only when the form is ambiguous. On a miss:
          English + all three degrees (and, for decode, the word's actions now that the answer is out). */}
      {revealing ? (
        <div class={styles.context}>
          {gloss ? <span class={styles.gloss}>{gloss}</span> : null}
          <span class={styles.forms}>{principalParts}</span>
          {prompt.decode ? <LemmaActions entry={entry} /> : null}
        </div>
      ) : ambiguous && gloss ? (
        <span class={styles.gloss}>{gloss}</span>
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

      {/* The one correct answer, on its own — no hunting through the forms line for it. */}
      {revealing ? (
        <div class={styles.reveal}>
          <span class={styles.revealLabel}>The correct answer</span>
          <span class={styles.answer}>{correctText}</span>
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
 * The Swedish irregular-adjective drill (language-coupled UI). The shared `useDrillRunner` owns the
 * queue, live persistence, progress, and the re-queue-until-cleared loop; this shell loads the form
 * index once (for ambiguity + decode acceptance), picks each word's mode, and renders a fresh keyed card.
 */
export function AdjFormsDrill(props: DrillRunnerProps) {
  const { question: q, index, cleared, total, startedAt, feedback, revealing, answer, proceed, endEarly } =
    useDrillRunner<Payload>(props)
  // One-time: index every Swedish adjective's comparison forms → base forms (see adjForms.buildFormIndex).
  const [formIndex, setFormIndex] = useState<Map<string, Set<string>> | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      const adjectives = (await db.entries.where('pos').equals('adj').toArray()).filter((a) => a.lang === 'sv')
      if (alive) setFormIndex(buildFormIndex(adjectives))
    })()
    return () => {
      alive = false
    }
  }, [])

  if (!q) return <p class={styles.muted}>Finishing…</p>

  return (
    <>
      <DrillTopBar cleared={cleared} total={total} onEnd={endEarly} />
      <AdjCard
        key={index}
        entry={q.entry}
        gloss={q.gloss}
        mode={pickMode(q.entry.id, startedAt)}
        formIndex={formIndex}
        feedback={feedback}
        revealing={revealing}
        onAnswer={answer}
        onProceed={proceed}
      />
    </>
  )
}
