import type { PracticeCardView } from '../../db/queries'
import { getRenderer } from '../../lang'
import type { InflectionDisplay } from '../../lang'
import { SpeakButton } from '../WordActions/WordActions'
import styles from './StudyCard.module.css'

// The inflection block (verb principal parts as a one-liner, noun declension as a 2×2 grid).
// Always describes the target word, so it renders next to the target word wherever it sits.
function Inflections({ display }: { display: InflectionDisplay }) {
  if (display.table) {
    const { columns, rows } = display.table
    // Just the cell grid — no row/column headers (self-explanatory, like the verb line).
    // Drop columns with no values (e.g. plural for uncountable nouns) to avoid blank gaps.
    const keep = columns.map((_, ci) => rows.some((r) => r.cells[ci]))
    return (
      <div class={styles.declension} style={{ gridTemplateColumns: `repeat(${keep.filter(Boolean).length}, auto)` }}>
        {rows.flatMap((r) =>
          r.cells.filter((_, ci) => keep[ci]).map((cell, i) => <span key={`${r.label}-${i}`}>{cell}</span>),
        )}
      </div>
    )
  }
  // One line per grammatical dimension (adjectives split agreement from comparison; others = 1 line).
  return display.summary.length ? (
    <div class={styles.inflections}>
      {display.summary.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  ) : null
}

// The sense cue shown on the prompt of an ambiguous word in recognition (the first example) so the
// learner knows which homonym is being asked. It's only a pre-reveal hint — after reveal the full
// example list renders in its normal place, so a revealed card looks like any other. Pure +
// exported so the rule is unit-tested without a DOM/DB harness.
export function promptCue(examples: string[], ambiguous: boolean, isRecognition: boolean): string | undefined {
  return ambiguous && isRecognition && examples.length > 0 ? examples[0] : undefined
}

// One study card: prompt at top, reveal area below. Recognition shows the target word and
// reveals the native translation; production shows the native word and reveals the target.
// (SPEC §7.2). Lemmas and inflections go through the per-language render module (§5.1).
export function StudyCard({ view, revealed }: { view: PracticeCardView; revealed: boolean }) {
  const { card, target, native, overlay, ambiguous } = view
  const isRecognition = card.skill === 'recognize'

  const targetRenderer = getRenderer(target.lang)
  const targetLemma = targetRenderer.renderLemma(target)
  const targetIpa = targetRenderer.showIpa ? target.pronunciation.ipa : undefined
  // Suppress the audio button when the lemma is pronounced differently across senses (kort, ton):
  // browser TTS can't pick the right one. The per-sense IPA above still shows.
  const ttsSuppressed = target.pronunciation.ambiguous === true
  const inflections = targetRenderer.renderInflections(target)

  const nativeLemma = native ? getRenderer(native.lang).renderLemma(native) : '—'
  const translation = overlay?.customTranslation ?? nativeLemma

  // Prompt = target in recognition, native in production. The target's forms/IPA always
  // travel with the target word (under the prompt in recognition, the answer in production).
  const promptWord = isRecognition ? targetLemma : nativeLemma
  const promptDisambig = isRecognition ? target.disambiguator : native?.disambiguator
  const answerWord = isRecognition ? translation : targetLemma
  const examples = [...(target.examples ?? []), ...(overlay?.customExamples ?? [])]
  // For an ambiguous word in recognition, the first example sits on the prompt as a sense cue
  // (e.g. fast conj vs adj). It's pre-reveal only — once revealed, the full list renders in its
  // normal place under the translation, so the card matches every other revealed card.
  const cue = promptCue(examples, ambiguous, isRecognition)

  return (
    <div class={styles.card}>
      {card.mode === 'new' ? <span class={styles.newBadge}>New word</span> : null}
      {/* Prompt is anchored at the top: in production it's unchanged on reveal (only the answer zone
          below fills in). In recognition the Swedish word lives here, so its forms join it on reveal
          and the centered group nudges to fit them — the only thing that moves up top. */}
      <div class={styles.prompt}>
        <span class={styles.promptWord}>{promptWord}</span>
        {promptDisambig ? <span class={styles.disambig}>({promptDisambig})</span> : null}
        {isRecognition && targetIpa ? <span class={styles.ipa}>/{targetIpa}/</span> : null}
        {/* Recognition shows the Swedish word on the prompt, so its pronunciation is available
            immediately. (Production keeps it in the reveal, so it can't leak the answer.) */}
        {isRecognition && !ttsSuppressed ? <SpeakButton text={target.lemma} lang={target.lang} /> : null}
        {/* In recognition the Swedish word is the prompt, so its forms enrich it right here — shown
            on reveal so the card stays clean until then. (In production the Swedish word is the
            revealed answer, so its forms sit with it down in the reveal zone instead.) */}
        {isRecognition && revealed ? (
          <div class={styles.promptForms}>
            <Inflections display={inflections} />
          </div>
        ) : null}
        {/* Sense cue for homonyms — disambiguates which meaning is asked. Pre-reveal only. */}
        {cue && !revealed ? <span class={styles.promptExample}>{cue}</span> : null}
      </div>

      {/* Persistent divider + revealable zone below it. All revealed content lives here (so it
          appears in one place and fades in together) and the prompt above stays put. */}
      <div class={styles.answerZone}>
        {revealed ? (
          <div class={styles.reveal}>
            <div class={styles.answer}>
              <span class={styles.answerWord}>{answerWord}</span>
              {!isRecognition && targetIpa ? <span class={styles.ipa}>/{targetIpa}/</span> : null}
              {/* Production reveals the Swedish word here, so its pronunciation lives with the answer. */}
              {!isRecognition && !ttsSuppressed ? <SpeakButton text={target.lemma} lang={target.lang} /> : null}
            </div>

            {/* The target word's forms (renders nothing when it has none). Production only — in
                recognition the Swedish word is on the prompt, so its forms ride along up there. */}
            {!isRecognition ? <Inflections display={inflections} /> : null}

            {target.subDefinitions?.length ? (
              <ul class={styles.subdefs}>
                {target.subDefinitions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            ) : null}

            {/* The user's note — their gloss on the word — sits under the meanings, above examples. */}
            {overlay?.noteText ? <p class={styles.note}>{overlay.noteText}</p> : null}

            {examples.length ? (
              <ul class={styles.examples}>
                {examples.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <span class={styles.revealHint}>Tap to reveal</span>
        )}
      </div>
    </div>
  )
}
