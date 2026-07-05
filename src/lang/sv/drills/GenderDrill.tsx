import { useEffect, useRef, useState } from 'preact/hooks'
import type { ActiveDrillSession, Entry } from '../../../db/types'
import { recordDrillAnswer } from '../../../drills/session'
import type { DrillRunnerProps } from '../../../drills/types'
import { SpeakButton, WiktionaryLink } from '../../../components/WordActions/WordActions'
import { getRenderer } from '../../index'
import { type Gender, genderAnswer } from './gender'
import styles from './GenderDrill.module.css'

// How long a correct answer's green flash lingers before auto-advancing.
const CORRECT_FLASH_MS = 700

const CHOICES: Gender[] = ['en', 'ett']

/** The noun's declension grid (indefinite/definite × sg/pl), shown on a wrong answer. Uses the
 *  language renderer's table — the same 2×2 the Word Detail / practice reveal draw. */
function GenderMatrix({ entry }: { entry: Entry }) {
  const table = getRenderer(entry.lang).renderInflections(entry).table
  if (!table) return null
  const keep = table.columns.map((_, ci) => table.rows.some((r) => r.cells[ci]))
  const cols = keep.filter(Boolean).length
  if (cols === 0) return null
  return (
    <div class={styles.matrix} style={{ gridTemplateColumns: `repeat(${cols}, auto)` }}>
      {table.rows.flatMap((r) =>
        r.cells.filter((_, ci) => keep[ci]).map((cell, i) => <span key={`${r.label}-${i}`}>{cell}</span>),
      )}
    </div>
  )
}

/**
 * The Swedish en/ett drill screen (language-coupled UI). A bare Swedish noun + its English gloss, two
 * big article buttons, and the feedback flow the design calls for — a correct answer flashes green and
 * auto-advances; a wrong one reveals the word with its article and full declension, with a "Continue"
 * button that replaces the choices. Each answer is persisted live (box + cursor), so leaving mid-drill
 * resumes in place. Self-contained: it uses the agnostic session functions directly.
 */
export function GenderDrill({ session, questions, onFinish }: DrillRunnerProps) {
  // Local working copy of the session; `feedback` holds the just-recorded answer (and the persisted
  // next-state) while the current card stays on screen. The cursor only advances on `proceed`.
  const [sess, setSess] = useState(session)
  const [feedback, setFeedback] = useState<{ chosen: Gender; correct: boolean; next: ActiveDrillSession } | null>(null)
  const timer = useRef<number | null>(null)

  const total = sess.queue.length
  const q = questions[sess.index]

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // A resumed session that's already fully answered (answered its last card, then left before the
  // stats showed) finishes straight away. Runs once on mount — later transitions go through `proceed`.
  useEffect(() => {
    if (!q) onFinish(sess, false)
  }, [])

  if (!q) return <p class={styles.muted}>Finishing…</p>

  function proceed(next: ActiveDrillSession) {
    setFeedback(null)
    if (next.index >= next.queue.length) onFinish(next, false)
    else setSess(next)
  }

  async function answer(choice: Gender) {
    if (feedback) return // ignore taps during feedback
    navigator.vibrate?.(10)
    const correct = genderAnswer(q.entry) === choice
    const next = await recordDrillAnswer(sess, q.entry.id, correct)
    setFeedback({ chosen: choice, correct, next })
    if (correct) timer.current = window.setTimeout(() => proceed(next), CORRECT_FLASH_MS)
    // Wrong answers wait for the Continue button (which replaces the choices below).
  }

  function endEarly() {
    if (timer.current) clearTimeout(timer.current)
    onFinish(feedback?.next ?? sess, true)
  }

  const correctGender = genderAnswer(q.entry)
  const choiceClass = (g: Gender) => {
    if (!feedback) return styles.choice
    if (g === correctGender) return `${styles.choice} ${styles.choiceCorrect}`
    if (g === feedback.chosen) return `${styles.choice} ${styles.choiceWrong}`
    return styles.choice
  }

  const revealing = feedback !== null && !feedback.correct

  return (
    <>
      <div class={styles.drillTop}>
        <div class={styles.track}>
          <div class={styles.fill} style={{ width: `${(sess.index / total) * 100}%` }} />
        </div>
        <span class={styles.count}>
          {sess.index + 1} / {total}
        </span>
        <button type="button" class={styles.end} onClick={endEarly}>
          End
        </button>
      </div>

      {/* Keyed on the cursor so each new question is a fresh mount → the enter animation replays. */}
      <div key={sess.index} class={styles.qArea}>
        <div class={styles.prompt}>
          {/* The bare lemma — the article is the answer, so it's withheld here. */}
          <span class={styles.lemma}>{q.entry.lemma}</span>
          <div class={styles.promptActions}>
            <SpeakButton text={q.entry.lemma} lang={q.entry.lang} />
            <WiktionaryLink lemma={q.entry.lemma} lang={q.entry.lang} />
          </div>
          <span class={styles.gloss}>{q.gloss}</span>
        </div>

        {revealing ? (
          <div class={styles.reveal}>
            <span class={styles.revealLabel}>The correct answer</span>
            <span class={styles.answerLemma}>{getRenderer(q.entry.lang).renderLemma(q.entry)}</span>
            <GenderMatrix entry={q.entry} />
          </div>
        ) : null}
      </div>

      {/* On a wrong answer the reveal is up and the choices are done — Continue takes their place. */}
      {revealing ? (
        <button type="button" class={styles.continue} onClick={() => proceed(feedback!.next)}>
          Continue
        </button>
      ) : (
        <div class={styles.choices}>
          {CHOICES.map((g) => (
            <button key={g} type="button" class={choiceClass(g)} disabled={!!feedback} onClick={() => void answer(g)}>
              {g}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
