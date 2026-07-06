import { useEffect, useRef, useState } from 'preact/hooks'
import { type CalibrationItem, drawCalibrationItems, seedKnown } from '../../db/queries'
import { languageName } from '../../lang'
import { answer, CALIBRATION, type CalibrationState, type ClaimedLevel, finalize, startCalibration } from '../../srs/calibration'
import styles from './Calibration.module.css'

// The explicit calibration sweep (SPEC §6.4, with reveal): show the meaning, the learner recalls
// the target word, taps to reveal the answer to verify, then rates Know / Don't-know — the same
// prompt→reveal→rate shape as a practice card. It tests PRODUCTION (the level that gates practice,
// since recognition over-places). Knowns seed both skills as Good; the band-advance verdict lives in
// the pure `../../srs/calibration` module. Reused by onboarding and the Profile screen.
export function Calibration({
  targetLang,
  onComplete,
  onCancel,
}: {
  targetLang: string
  onComplete: (level: ClaimedLevel) => void
  onCancel: () => void
}) {
  const [state, setState] = useState(startCalibration)
  const [items, setItems] = useState<CalibrationItem[] | null>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  // An intro screen sets expectations before the sweep begins (it can run long for advanced users).
  // The pool preloads in the background meanwhile, so the first word is ready the moment they start.
  const [started, setStarted] = useState(false)

  // Undo support. Each answer pushes a snapshot of everything it changes (state + pool + cursor +
  // the accumulated knowns); Back pops it, restoring the exact word shown — even across a level jump.
  type Snapshot = { state: CalibrationState; items: CalibrationItem[] | null; index: number; known: string[] }
  const [history, setHistory] = useState<Snapshot[]>([])
  // Words the learner produced. We seed SRS state (both skills) once at the end rather than per answer,
  // so undo is a pure in-memory revert with nothing to un-write. (SPEC §6.4)
  const known = useRef<Set<string>>(new Set())
  // When an undo restores a *different* level, the redraw effect below would fire and clobber the
  // restored pool with a fresh draw — this tells it to skip that one run.
  const restoring = useRef(false)

  // Draw a fresh pool whenever the tested level changes (and on mount) — unless we're mid-undo and
  // have just restored the previous level's pool ourselves.
  useEffect(() => {
    if (state.done) return
    if (restoring.current) {
      restoring.current = false
      return
    }
    let cancelled = false
    setItems(null)
    void drawCalibrationItems(targetLang, state.level, CALIBRATION.maxItems).then((drawn) => {
      if (cancelled) return
      setItems(drawn)
      setIndex(0)
    })
    return () => {
      cancelled = true
    }
  }, [targetLang, state.level, state.done])

  // Each new word starts collapsed.
  useEffect(() => setRevealed(false), [index, items])

  // Report the result once the sweep finishes, seeding everything the learner knew first.
  useEffect(() => {
    if (state.done && state.claimed) {
      for (const id of known.current) void seedKnown(id)
      onComplete(state.claimed)
    }
  }, [state.done, state.claimed])

  // Pool ran out before a verdict (rare — levels have hundreds of words): force the level's result.
  useEffect(() => {
    if (items && index >= items.length && !state.done) setState((s) => finalize(s))
  }, [items, index, state.done])

  if (state.done) return null

  if (!started) {
    return (
      <div class={styles.screen}>
        <div class={styles.intro}>
          <h2 class={styles.introTitle}>Let's find your level</h2>
          <p class={styles.introText}>
            We'll show you words one level at a time — easy at first, then gradually harder. For each one, try to recall it
            in {languageName(targetLang)}, then tell us whether you knew it.
          </p>
          <p class={styles.introText}>
            When a level gets too tricky, we'll stop there — and that's your level. The more you know, the longer it runs, so
            it can take a few minutes if you're already advanced. Not up for it right now? You can skip and pick your level by hand instead.
          </p>
        </div>
        <div class={styles.buttons}>
          <button type="button" class={styles.dunno} onClick={onCancel}>
            Not now
          </button>
          <button type="button" class={styles.know} onClick={() => setStarted(true)}>
            I'm ready
          </button>
        </div>
      </div>
    )
  }

  const current = items?.[index]

  function respond(knew: boolean) {
    if (!current) return
    // Snapshot before mutating so Back can restore this exact word (and un-mark it if needed).
    setHistory((h) => [...h, { state, items, index, known: [...known.current] }])
    if (knew) known.current.add(current.translationId)
    const next = answer(state, knew)
    setState(next)
    // Same level → next drawn word; a level change or completion is handled by the effects above.
    if (!next.done && next.level === state.level) setIndex((i) => i + 1)
  }

  function undo() {
    const prev = history[history.length - 1]
    if (!prev) return
    // A restore that changes the level must stop the redraw effect from clobbering the pool.
    if (prev.state.level !== state.level) restoring.current = true
    known.current = new Set(prev.known)
    setHistory((h) => h.slice(0, -1))
    setItems(prev.items)
    setIndex(prev.index)
    setState(prev.state)
  }

  return (
    <div class={styles.screen}>
      <header class={styles.bar}>
        <div class={styles.barLeft}>
          {history.length > 0 ? (
            <button type="button" class={styles.back} aria-label="Back" onClick={undo}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          ) : null}
          <span class={styles.level}>Quick check · {state.level}</span>
        </div>
        <button type="button" class={styles.skip} onClick={onCancel}>
          Skip
        </button>
      </header>

      <div class={`${styles.card} ${revealed || !current ? '' : styles.tappable}`} onClick={revealed || !current ? undefined : () => setRevealed(true)}>
        {current ? (
          <>
            <div class={styles.promptBlock}>
              <span class={styles.prompt}>{current.prompt}</span>
              {current.gloss ? <span class={styles.gloss}>{current.gloss}</span> : null}
            </div>
            {revealed ? (
              <div class={styles.reveal}>
                <span class={styles.answerWord}>{current.answer}</span>
                {current.ipa ? <span class={styles.ipa}>/{current.ipa}/</span> : null}
              </div>
            ) : (
              <span class={styles.revealHint}>Tap to reveal</span>
            )}
          </>
        ) : (
          <span class={styles.spinner} aria-label="Loading" />
        )}
      </div>

      <p class={styles.hint}>
        {revealed ? `Could you say it in ${languageName(targetLang)}?` : `Recall it in ${languageName(targetLang)}, then check.`}
      </p>
      <div class={styles.buttons}>
        <button type="button" class={styles.dunno} disabled={!current} onClick={() => respond(false)}>
          Don't know
        </button>
        <button type="button" class={styles.know} disabled={!current} onClick={() => respond(true)}>
          Know it
        </button>
      </div>
    </div>
  )
}
