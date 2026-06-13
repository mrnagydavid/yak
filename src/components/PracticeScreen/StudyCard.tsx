import type { PracticeCardView } from '../../db/queries'
import { getRenderer } from '../../lang'
import type { InflectionDisplay } from '../../lang'
import styles from './StudyCard.module.css'

// The inflection block (verb principal parts as a one-liner, noun declension as a 2×2 grid).
// Always describes the target word, so it renders next to the target word wherever it sits.
function Inflections({ display }: { display: InflectionDisplay }) {
  if (display.table) {
    const { columns, rows } = display.table
    // Just the cell grid — no row/column headers (self-explanatory, like the verb line).
    return (
      <div class={styles.declension} style={{ gridTemplateColumns: `repeat(${columns.length}, auto)` }}>
        {rows.flatMap((r) => r.cells.map((cell, i) => <span key={`${r.label}-${i}`}>{cell}</span>))}
      </div>
    )
  }
  return display.summary ? <div class={styles.inflections}>{display.summary}</div> : null
}

// One study card: prompt at top, reveal area below. Recognition shows the target word and
// reveals the native translation; production shows the native word and reveals the target.
// (SPEC §7.2). Lemmas and inflections go through the per-language render module (§5.1).
export function StudyCard({ view, revealed }: { view: PracticeCardView; revealed: boolean }) {
  const { card, target, native, overlay } = view
  const isRecognition = card.skill === 'recognize'
  const userOwned = target.source === 'user' || !!overlay

  const targetRenderer = getRenderer(target.lang)
  const targetLemma = targetRenderer.renderLemma(target)
  const targetIpa = targetRenderer.showIpa ? target.pronunciation.ipa : undefined
  const inflections = targetRenderer.renderInflections(target)

  const nativeLemma = native ? getRenderer(native.lang).renderLemma(native) : '—'
  const translation = overlay?.customTranslation ?? nativeLemma

  // Prompt = target in recognition, native in production. The target's forms/IPA always
  // travel with the target word (under the prompt in recognition, the answer in production).
  const promptWord = isRecognition ? targetLemma : nativeLemma
  const promptDisambig = isRecognition ? target.disambiguator : native?.disambiguator
  const answerWord = isRecognition ? translation : targetLemma
  const examples = overlay?.customExamples ?? []

  return (
    <div class={`${styles.card} ${userOwned ? styles.userOwned : ''}`}>
      {card.mode === 'new' ? <span class={styles.newBadge}>New word</span> : null}
      <div class={styles.prompt}>
        <span class={styles.promptWord}>{promptWord}</span>
        {promptDisambig ? <span class={styles.disambig}>({promptDisambig})</span> : null}
        {isRecognition && targetIpa ? <span class={styles.ipa}>/{targetIpa}/</span> : null}
        {/* Recognition: target's forms sit under the (target) prompt, once revealed. */}
        {isRecognition && revealed ? <Inflections display={inflections} /> : null}
      </div>

      {revealed ? (
        <div class={styles.reveal}>
          <div class={styles.answer}>
            <span class={styles.answerWord}>{answerWord}</span>
            {!isRecognition && targetIpa ? <span class={styles.ipa}>/{targetIpa}/</span> : null}
          </div>

          {/* Production: target's forms sit under the (target) answer. */}
          {!isRecognition ? <Inflections display={inflections} /> : null}

          {target.subDefinitions?.length ? (
            <ul class={styles.subdefs}>
              {target.subDefinitions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : null}

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
