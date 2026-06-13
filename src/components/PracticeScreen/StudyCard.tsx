import type { PracticeCardView } from '../../db/queries'
import styles from './StudyCard.module.css'

// One study card: prompt at top, reveal area below. Recognition shows the target word and
// reveals the native translation; production shows the native word and reveals the target.
// (SPEC §7.2)
export function StudyCard({ view, revealed }: { view: PracticeCardView; revealed: boolean }) {
  const { card, target, native, overlay } = view
  const isRecognition = card.skill === 'recognize'
  const userOwned = target.source === 'user' || !!overlay

  const promptWord = isRecognition ? target.lemma : (native?.lemma ?? '—')
  const promptDisambig = isRecognition ? target.disambiguator : native?.disambiguator
  const promptIpa = isRecognition ? target.pronunciation.ipa : undefined

  const answer = isRecognition ? (overlay?.customTranslation ?? native?.lemma ?? '—') : target.lemma
  const answerIpa = isRecognition ? undefined : target.pronunciation.ipa

  // Provisional inflection summary until the per-language render module lands (SPEC §5.1).
  // Swedish imperative reads naturally with a capital + "!", e.g. "Spring!".
  const inflections = Object.entries(target.inflections).map(([key, value]) =>
    key === 'imperativ' || key === 'imperative'
      ? `${value.charAt(0).toUpperCase()}${value.slice(1)}!`
      : value,
  )
  const examples = overlay?.customExamples ?? []

  return (
    <div class={`${styles.card} ${userOwned ? styles.userOwned : ''}`}>
      <div class={styles.prompt}>
        <span class={styles.promptWord}>{promptWord}</span>
        {promptDisambig ? <span class={styles.disambig}>({promptDisambig})</span> : null}
        {promptIpa ? <span class={styles.ipa}>/{promptIpa}/</span> : null}
      </div>

      {revealed ? (
        <div class={styles.reveal}>
          <div class={styles.answer}>
            <span class={styles.answerWord}>{answer}</span>
            {answerIpa ? <span class={styles.ipa}>/{answerIpa}/</span> : null}
          </div>

          {target.subDefinitions?.length ? (
            <ul class={styles.subdefs}>
              {target.subDefinitions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : null}

          {inflections.length ? <div class={styles.inflections}>{inflections.join(' · ')}</div> : null}

          {examples.length ? (
            <ul class={styles.examples}>
              {examples.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}

          {overlay?.noteText ? <p class={styles.note}>{overlay.noteText}</p> : null}
        </div>
      ) : (
        <span class={styles.revealHint}>Tap to reveal</span>
      )}
    </div>
  )
}
