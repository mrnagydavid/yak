import type { PracticeCardView } from '../../db/queries'
import type { Entry, EntryOverlay, ExampleSentence } from '../../db/types'
import type { InflectionDisplay } from '../../lang'
import { getRenderer } from '../../lang'
import type { RatingLabel } from '../../srs/fsrs-adapter'
import { SpeakButton, WiktionaryLink } from '../WordActions/WordActions'
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

// The example sentences to render on a card. Seed examples are tagged by meaning: production asks ONE
// meaning, so it passes that `meaningKey` and sees only its own sense's sentences (the "route" card
// must not show the "joint" sentence); recognition is per WORD, so it passes `null` and sees them all.
// The user's own custom examples are word-level and always ride along. Pure + exported so the rule is
// unit-tested without a DOM/DB harness (like promptCue). (per-sense examples, §4.8)
export function cardExamples(seed: ExampleSentence[] | undefined, custom: string[] | undefined, meaningKey: number | null): string[] {
  const seedTexts = (seed ?? []).filter((e) => meaningKey === null || e.meaningKey === meaningKey).map((e) => e.text)
  return [...seedTexts, ...(custom ?? [])]
}

// The production prompt renders the English word ("to link", "a risk", "early") with a sense gloss
// under it to say WHICH sense is asked. The sense pass writes that gloss as the full phrase + a POS
// tag — "to link (verb)", "a risk (noun)", "early (adj)" — which then just repeats the word right
// above it: "to link" over "(to link (verb))". Trim the overlap for display:
//   • a gloss that only restates the prompt + a POS the prompt ALREADY discloses (verbs render
//     "to …", countable nouns "a/an …") adds nothing → drop it entirely ("to link", no gloss);
//   • where the prompt does NOT disclose POS (adj/adv/prep and uncountable nouns all render bare),
//     keep just the POS tag as the disambiguator, dropping the repeated phrase → "early" + "(adj)";
//   • a gloss that says more than the bare phrase (a real semantic sense, "hand (of a clock)") is
//     left untouched.
// Returns the inner text for the "(…)" the caller renders, or undefined to show nothing. Pure +
// exported so the rule is unit-tested without a DOM harness (like promptCue / cardExamples).
const POS_TAG_GLOSS = /^(.*?)\s*\((verb|noun|adj|adv|prep|conj|pron|interj|num|article|determiner)\)$/i
const normPhrase = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

export function productionDisambig(promptWord: string, gloss: string | undefined): string | undefined {
  if (!gloss) return undefined
  const m = gloss.match(POS_TAG_GLOSS)
  if (!m) return gloss // a semantic gloss ("approximately", "of a clock") — keep as-is
  const [, phrase, pos] = m
  if (normPhrase(phrase) !== normPhrase(promptWord)) return gloss // gloss adds detail beyond the prompt
  // Bare "prompt (pos)": the phrase is pure repetition. Drop the POS tag too when the rendered prompt
  // already signals it via its "to "/"a "/"an " particle; otherwise keep the tag as the sole cue.
  return /^(to|an?)\s/i.test(promptWord) ? undefined : pos.toLowerCase()
}

// The production "answer record" for a target word: the word + IPA + audio + inflections, then the
// user's note and examples. Identical whether shown on a solo production card or on one tab of a
// multi-answer group — so a group tab "looks exactly like a no-group card". (SPEC §7.2)
//
// No sub-definitions or meaning cross-links here. On a production card the prompt is the native meaning
// and the answer is the target word, so listing the word's OTHER English senses ("beg, plead"; "also
// means: pray") only clutters the answer — those belong on the recognition reveal, where the prompt IS
// the target word and enumerating its meanings is the point.
function TargetReveal({ target, overlay, meaningKey }: { target: Entry; overlay?: EntryOverlay; meaningKey: number }) {
  const r = getRenderer(target.lang)
  const ipa = r.showIpa ? target.pronunciation.ipa : undefined
  // TTS is suppressed when the lemma is pronounced differently across senses (kort, ton) — browser TTS
  // can't pick the right one; the per-sense IPA still shows.
  const ttsSuppressed = target.pronunciation.ambiguous === true
  // Production asks ONE meaning, so show only that meaning's examples — the "route" card must not show
  // the "joint" sentence (per-sense examples, §4.8).
  const examples = cardExamples(target.examples, overlay?.customExamples, meaningKey)
  return (
    <div class={styles.reveal}>
      <div class={styles.answer}>
        <span class={styles.answerWord}>{r.renderLemma(target)}</span>
        {ipa ? <span class={styles.ipa}>/{ipa}/</span> : null}
        <div class={styles.wordActions}>
          {!ttsSuppressed ? <SpeakButton text={target.lemma} lang={target.lang} /> : null}
          <WiktionaryLink lemma={target.lemma} lang={target.lang} pos={target.pos} />
        </div>
      </div>
      <Inflections display={r.renderInflections(target)} />
      {/* The user's note — their gloss on the word — sits above the examples. */}
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
  ratings,
  onSelectTab,
}: {
  view: PracticeCardView
  revealed: boolean
  activeTab?: number
  ratings?: Map<string, RatingLabel>
  onSelectTab?: (i: number) => void
}) {
  if (view.group) {
    return <GroupCard view={view} revealed={revealed} activeTab={activeTab} ratings={ratings} onSelectTab={onSelectTab} />
  }

  const { card, target, native, overlay, ambiguous, siblingMeanings, productionGloss, meaningKey } = view
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
  // Production: the meaning's gloss disambiguates which sense the prompt is asking for (e.g.
  // "hand (body part)" vs "hand (of a clock)"; a promoted meaning uses its own gloss). Empty for
  // single-sense concepts, so it falls back to the native disambiguator. (§12, Q-polysemy)
  const promptDisambig = isRecognition
    ? target.disambiguator
    : productionDisambig(promptWord, productionGloss || native?.disambiguator)
  // Recognition is per WORD, so it shows all the word's example sentences (every meaning) plus the
  // user's own. Production filters per meaning inside TargetReveal. (per-sense examples, §4.8)
  const examples = cardExamples(target.examples, overlay?.customExamples, null)
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
        {/* Recognition shows the Swedish word on the prompt, so its actions sit here. The Wiktionary
            link is held back until reveal (it would otherwise give the meaning away). */}
        {isRecognition ? (
          <div class={styles.wordActions}>
            {!ttsSuppressed ? <SpeakButton text={target.lemma} lang={target.lang} /> : null}
            {revealed ? <WiktionaryLink lemma={target.lemma} lang={target.lang} pos={target.pos} /> : null}
          </div>
        ) : null}
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
          <>
            {isRecognition ? (
              <div class={styles.reveal}>
                {/* Recognition is asked once per word; each promoted meaning has its own production
                    card, so they stack with the primary as equal main meanings — any of them counts
                    as knowing the word (multi-meaning design). */}
                <div class={styles.answer}>
                  <span class={styles.answerWord}>{translation}</span>
                  {!overlay?.customTranslation
                    ? siblingMeanings.map((m, i) => (
                        <span key={i} class={styles.answerWord}>
                          {m}
                        </span>
                      ))
                    : null}
                </div>
                {/* A saying's word-for-word reading — a quiet line under the meaning (proverbs/idioms). */}
                {target.wordForWord ? <p class={styles.wordForWord}>{target.wordForWord}</p> : null}
                {overlay?.noteText ? <p class={styles.note}>{overlay.noteText}</p> : null}
                {target.subDefinitions?.length ? (
                  <>
                    <div class={styles.orDivider}>also</div>
                    <div class={styles.subdefs}>
                      {target.subDefinitions.map((s, i) => (
                        <div key={i}>{s}</div>
                      ))}
                    </div>
                  </>
                ) : null}
                {examples.length ? (
                  <ul class={styles.examples}>
                    {examples.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              // Production: just the target word's full record (the same block every group tab shows). No
              // cross-link to the word's OTHER meanings here — listing "also means: pray" when the learner
              // was asked to produce this exact sense only clutters the answer. The recognition reveal is
              // where all the word's meanings belong. (multi-meaning design)
              <TargetReveal target={target} overlay={overlay} meaningKey={meaningKey} />
            )}
            {/* New-word moment: relate this word to same-sense synonyms already learned. (Q1) */}
            {card.mode === 'new' && view.senseSummary && view.senseSummary.synonyms.length > 0 ? (
              <p class={styles.alsoKnow}>
                Another way to say this that you already know: {view.senseSummary.synonyms.join(', ')}.
              </p>
            ) : null}
          </>
        ) : (
          <span class={styles.revealHint}>Tap to reveal</span>
        )}
      </div>
    </div>
  )
}

// Dot colour per grade, matching the rating buttons (RatingButtons.module.css). A tab's dot takes the
// colour of the grade given, so re-grading visibly re-colours it.
const DOT_CLASS: Record<RatingLabel, string> = {
  again: styles.dotAgain,
  hard: styles.dotHard,
  good: styles.dotGood,
  easy: styles.dotEasy,
}

// A multi-answer production card: the concept is the fixed prompt; each valid answer lives on its own
// tab at the TOP of the reveal (just under the divider), with the active tab's full record below it.
// Rating buttons + a full-width "Knew all" live in PracticeScreen's footer; rating grades the active tab.
function GroupCard({
  view,
  revealed,
  activeTab,
  ratings,
  onSelectTab,
}: {
  view: PracticeCardView
  revealed: boolean
  activeTab: number
  ratings?: Map<string, RatingLabel>
  onSelectTab?: (i: number) => void
}) {
  const group = view.group!
  const concept = view.native ? getRenderer(view.native.lang).renderLemma(view.native) : '—'
  const active = group.members[activeTab] ?? group.members[0]
  const groupDisambig = productionDisambig(concept, group.gloss)

  return (
    <div class={styles.card}>
      <div class={styles.prompt}>
        <span class={styles.promptWord}>{concept}</span>
        {groupDisambig ? <span class={styles.disambig}>({groupDisambig})</span> : null}
        {/* Cue the learner to recall more than one answer, and how many — without leaking them. */}
        {!revealed ? <span class={styles.waysCue}>{`${group.members.length} ways to say it`}</span> : null}
      </div>

      <div class={`${styles.answerZone} ${styles.answerZoneGrouped}`}>
        {revealed && active ? (
          <>
            {/* Answer tabs at the top of the reveal: one per valid answer, each with a dot coloured by
                its grade; the active tab is underlined. Tapping a tab switches the record shown below. */}
            <div class={styles.tabs} role="tablist">
              {group.members.map((m, i) => {
                const label = ratings?.get(m.translationId)
                return (
                  <button
                    key={m.translationId}
                    type="button"
                    role="tab"
                    aria-selected={i === activeTab}
                    class={`${styles.tab} ${i === activeTab ? styles.tabActive : ''}`}
                    onClick={() => onSelectTab?.(i)}
                  >
                    <span class={`${styles.tabDot} ${label ? DOT_CLASS[label] : ''}`} aria-hidden="true">
                      ●
                    </span>
                    {getRenderer(m.target.lang).renderLemma(m.target)}
                  </button>
                )
              })}
            </div>
            <TargetReveal target={active.target} overlay={active.overlay} meaningKey={active.meaningKey} />
          </>
        ) : (
          <span class={styles.revealHint}>Tap to reveal</span>
        )}
      </div>
    </div>
  )
}
