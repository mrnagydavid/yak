import { useEffect, useState } from 'preact/hooks'
import { type CalibrationItem, drawCalibrationItems, seedKnown } from '../../db/queries'
import { languageName } from '../../lang'
import { answer, CALIBRATION, type ClaimedLevel, finalize, startCalibration } from '../../srs/calibration'
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

  // Draw a fresh pool whenever the tested level changes (and on mount).
  useEffect(() => {
    if (state.done) return
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

  // Report the result once the sweep finishes.
  useEffect(() => {
    if (state.done && state.claimed) onComplete(state.claimed)
  }, [state.done, state.claimed])

  // Pool ran out before a verdict (rare — levels have hundreds of words): force the level's result.
  useEffect(() => {
    if (items && index >= items.length && !state.done) setState((s) => finalize(s))
  }, [items, index, state.done])

  if (state.done) return null

  const current = items?.[index]

  function respond(known: boolean) {
    if (!current) return
    if (known) void seedKnown(current.translationId)
    const next = answer(state, known)
    setState(next)
    // Same level → next drawn word; a level change or completion is handled by the effects above.
    if (!next.done && next.level === state.level) setIndex((i) => i + 1)
  }

  return (
    <div class={styles.screen}>
      <header class={styles.bar}>
        <span class={styles.level}>Quick check · {state.level}</span>
        <button type="button" class={styles.skip} onClick={onCancel}>
          Skip
        </button>
      </header>

      <div class={`${styles.card} ${revealed || !current ? '' : styles.tappable}`} onClick={revealed || !current ? undefined : () => setRevealed(true)}>
        {current ? (
          <>
            <span class={styles.prompt}>{current.prompt}</span>
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
