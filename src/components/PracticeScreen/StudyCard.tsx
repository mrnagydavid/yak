import type { PracticeCardView } from '../../db/queries'
import type { Entry, EntryOverlay } from '../../db/types'
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

// The production "answer record" for a target word: the word + IPA + audio + inflections, then its
// sub-definitions, the user's note, and examples. Identical whether shown on a solo production card or
// on one tab of a multi-answer group — so a group tab "looks exactly like a no-group card". (SPEC §7.2)
function TargetReveal({ target, overlay }: { target: Entry; overlay?: EntryOverlay }) {
  const r = getRenderer(target.lang)
  const ipa = r.showIpa ? target.pronunciation.ipa : undefined
  // TTS is suppressed when the lemma is pronounced differently across senses (kort, ton) — browser TTS
  // can't pick the right one; the per-sense IPA still shows.
  const ttsSuppressed = target.pronunciation.ambiguous === true
  const examples = [...(target.examples ?? []), ...(overlay?.customExamples ?? [])]
  return (
    <div class={styles.reveal}>
      <div class={styles.answer}>
        <span class={styles.answerWord}>{r.renderLemma(target)}</span>
        {ipa ? <span class={styles.ipa}>/{ipa}/</span> : null}
        {!ttsSuppressed ? <SpeakButton text={target.lemma} lang={target.lang} /> : null}
      </div>
      <Inflections display={r.renderInflections(target)} />
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
  )
}

// One study card: prompt at top, reveal area below. Recognition shows the target word and reveals the
// native translation; production shows the native word and reveals the target's full record (SPEC §7.2,
// §5.1). A multi-answer production card (view.group) renders the tabbed group layout — one answer per
// tab, each its own full record; PracticeScreen owns the tab bar, rating, and "Knew all".
export function StudyCard({
  view,
  revealed,
  activeTab = 0,
}: {
  view: PracticeCardView
  revealed: boolean
  activeTab?: number
}) {
  if (view.group) {
    return <GroupCard view={view} revealed={revealed} activeTab={activeTab} />
  }

  const { card, target, native, overlay, ambiguous } = view
  const isRecognition = card.skill === 'recognize'

  const targetRenderer = getRenderer(target.lang)
  const targetLemma = targetRenderer.renderLemma(target)
  const targetIpa = targetRenderer.showIpa ? target.pronunciation.ipa : undefined
  const ttsSuppressed = target.pronunciation.ambiguous === true
  const inflections = targetRenderer.renderInflections(target)

  const nativeLemma = native ? getRenderer(native.lang).renderLemma(native) : '—'
  const translation = overlay?.customTranslation ?? nativeLemma

  // Prompt = target in recognition, native in production. The target's forms/IPA always travel with
  // the target word (under the prompt in recognition, the answer in production).
  const promptWord = isRecognition ? targetLemma : nativeLemma
  const promptDisambig = isRecognition ? target.disambiguator : native?.disambiguator
  const examples = [...(target.examples ?? []), ...(overlay?.customExamples ?? [])]
  // For an ambiguous word in recognition, the first example sits on the prompt as a sense cue (e.g.
  // fast conj vs adj). Pre-reveal only — once revealed, the full list renders in its normal place.
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
        {/* In recognition the Swedish word is the prompt, so its forms enrich it right here — shown on
            reveal so the card stays clean until then. */}
        {isRecognition && revealed ? (
          <div class={styles.promptForms}>
            <Inflections display={inflections} />
          </div>
        ) : null}
        {/* Sense cue for homonyms — disambiguates which meaning is asked. Pre-reveal only. */}
        {cue && !revealed ? <span class={styles.promptExample}>{cue}</span> : null}
      </div>

      {/* Persistent divider + revealable zone below it. */}
      <div class={styles.answerZone}>
        {revealed ? (
          isRecognition ? (
            <div class={styles.reveal}>
              <div class={styles.answer}>
                <span class={styles.answerWord}>{translation}</span>
              </div>
              {target.subDefinitions?.length ? (
                <ul class={styles.subdefs}>
                  {target.subDefinitions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : null}
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
            // Production: the target word's full record (the same block every group tab shows).
            <TargetReveal target={target} overlay={overlay} />
          )
        ) : (
          <span class={styles.revealHint}>Tap to reveal</span>
        )}
      </div>
    </div>
  )
}

// A multi-answer production card: the concept is the fixed prompt; each valid answer lives on its own
// tab, revealed as a full record (TargetReveal). The tab bar, rating buttons, and "Knew all" live in
// PracticeScreen's footer — this just renders the active answer.
function GroupCard({
  view,
  revealed,
  activeTab,
}: {
  view: PracticeCardView
  revealed: boolean
  activeTab: number
}) {
  const group = view.group!
  const concept = view.native ? getRenderer(view.native.lang).renderLemma(view.native) : '—'
  const active = group.members[activeTab] ?? group.members[0]

  return (
    <div class={styles.card}>
      <div class={styles.prompt}>
        <span class={styles.promptWord}>{concept}</span>
        {group.gloss ? <span class={styles.disambig}>({group.gloss})</span> : null}
        {/* Cue the learner to recall more than one answer, and how many — without leaking them. */}
        {!revealed ? <span class={styles.waysCue}>{`${group.members.length} ways to say it`}</span> : null}
      </div>

      <div class={styles.answerZone}>
        {revealed && active ? (
          <TargetReveal target={active.target} overlay={active.overlay} />
        ) : (
          <span class={styles.revealHint}>Tap to reveal</span>
        )}
      </div>
    </div>
  )
}
