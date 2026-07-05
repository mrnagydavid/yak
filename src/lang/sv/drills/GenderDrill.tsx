import type { Entry } from '../../../db/types'
import { useDrillRunner } from '../../../drills/useDrillRunner'
import type { DrillRunnerProps } from '../../../drills/types'
import { DrillTopBar } from '../../../components/PracticePlus/DrillTopBar'
import { SpeakButton, WiktionaryLink } from '../../../components/WordActions/WordActions'
import { getRenderer } from '../../index'
import { type Gender, genderAnswer } from './gender'
import styles from './GenderDrill.module.css'

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
 * button that replaces the choices. The shared `useDrillRunner` owns the queue, live persistence,
 * progress, and the re-queue-until-cleared loop; this component just renders and decides right/wrong.
 */
export function GenderDrill(props: DrillRunnerProps) {
  const { question: q, index, cleared, total, feedback, revealing, answer, proceed, endEarly } =
    useDrillRunner<Gender>(props)

  if (!q) return <p class={styles.muted}>Finishing…</p>

  const correctGender = genderAnswer(q.entry)
  const choiceClass = (g: Gender) => {
    if (!feedback) return styles.choice
    if (g === correctGender) return `${styles.choice} ${styles.choiceCorrect}`
    if (g === feedback.payload) return `${styles.choice} ${styles.choiceWrong}`
    return styles.choice
  }

  return (
    <>
      <DrillTopBar cleared={cleared} total={total} onEnd={endEarly} />

      {/* Keyed on the cursor so each new question is a fresh mount → the enter animation replays. */}
      <div key={index} class={styles.qArea}>
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
        <button type="button" class={styles.continue} onClick={proceed}>
          Continue
        </button>
      ) : (
        <div class={styles.choices}>
          {CHOICES.map((g) => (
            <button
              key={g}
              type="button"
              class={choiceClass(g)}
              disabled={!!feedback}
              onClick={() => void answer(correctGender === g, g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
