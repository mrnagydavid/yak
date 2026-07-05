import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ActiveDrillSession } from '../db/types'
import { recordDrillAnswer } from './session'
import type { DrillQuestion, DrillRunnerProps } from './types'

// The language-AGNOSTIC drill loop, shared by every runner (en/ett, verb-forms, …). It owns the
// "clear the board" state machine — the working queue, live persistence, the correct→flash→advance /
// wrong→reveal→continue rhythm, monotonic progress, and completion — so each language component only
// has to render its prompt, decide right/wrong, and draw its reveal. The generic `P` is the runner's
// own feedback payload (e.g. the tapped article, or the typed answer) carried back to the reveal.

/** How long a correct answer's green flash lingers before auto-advancing. */
export const CORRECT_FLASH_MS = 700

export interface DrillFeedback<P> {
  correct: boolean
  payload: P
  /** The session AFTER this answer was persisted — used to advance, and to end-early accurately. */
  next: ActiveDrillSession
}

export interface DrillRunner<P> {
  /** The current question, or undefined while a (resumed) already-finished session settles. */
  question: DrillQuestion | undefined
  index: number // cursor — changes on every answer, so it keys a fresh card mount / animation
  cleared: number // words gotten right so far — the monotonic progress numerator
  total: number // distinct words in the batch — the fixed denominator
  startedAt: number // session start (drills seed per-session choices, e.g. verb-forms mode, off this)
  feedback: DrillFeedback<P> | null
  revealing: boolean // feedback is showing AND it was wrong (the reveal + Continue are up)
  /** Record an answer. `correct` is the runner's verdict; `payload` is echoed back on `feedback`. */
  answer: (correct: boolean, payload: P) => Promise<void>
  /** Advance past the current (revealed, wrong) card. No-op unless a wrong answer is showing. */
  proceed: () => void
  /** Exit the session now, counting the answer in progress. */
  endEarly: () => void
}

export function useDrillRunner<P>({ session, questions, onFinish }: DrillRunnerProps): DrillRunner<P> {
  // Local working copy of the session; the cursor only advances via `proceed` (on correct, after the
  // flash; on wrong, when the learner continues). `feedback` freezes the just-answered card on screen.
  const [sess, setSess] = useState(session)
  const [feedback, setFeedback] = useState<DrillFeedback<P> | null>(null)
  const timer = useRef<number | null>(null)
  // Look up questions BY ENTRY ID, not queue position — a re-queued word repeats at a new position but
  // resolves to the same question for free (the batch resolved all distinct words up front).
  const byId = useMemo(() => new Map(questions.map((q) => [q.entry.id, q])), [questions])

  const entryId = sess.queue[sess.index] as string | undefined
  const question = entryId ? byId.get(entryId) : undefined

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // A resumed session that's already past its end (last card answered, left before stats showed)
  // finishes straight away. Mount-only — later transitions go through `advance`.
  useEffect(() => {
    if (!question) onFinish(sess, false)
  }, [])

  function advance(next: ActiveDrillSession) {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setFeedback(null)
    // The board is clear exactly when the cursor reaches the end of the (grown) queue.
    if (next.index >= next.queue.length) onFinish(next, false)
    else setSess(next)
  }

  async function answer(correct: boolean, payload: P) {
    if (feedback || !question) return // ignore input during feedback / after finish
    navigator.vibrate?.(10)
    const next = await recordDrillAnswer(sess, question.entry.id, correct)
    setFeedback({ correct, payload, next })
    // Correct → flash green, then auto-advance. Wrong → wait for the learner to continue.
    if (correct) timer.current = window.setTimeout(() => advance(next), CORRECT_FLASH_MS)
  }

  function endEarly() {
    if (timer.current) clearTimeout(timer.current)
    onFinish(feedback?.next ?? sess, true)
  }

  return {
    question,
    index: sess.index,
    cleared: sess.cleared.length,
    total: sess.initialCount,
    startedAt: sess.startedAt,
    feedback,
    revealing: feedback !== null && !feedback.correct,
    answer,
    proceed: () => {
      if (feedback) advance(feedback.next)
    },
    endEarly,
  }
}
