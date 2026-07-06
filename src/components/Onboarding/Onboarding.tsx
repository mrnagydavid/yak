import { useState } from 'preact/hooks'
import { createProfile } from '../../db/queries'
import { languageName } from '../../lang'
import type { ClaimedLevel } from '../../srs/calibration'
import { Calibration } from '../Calibration/Calibration'
import { SpeakButton } from '../WordActions/WordActions'
import styles from './Onboarding.module.css'

// First-launch flow (SPEC §7.8): welcome → pick language → pick level (or run the assessment) →
// intro → create the profile and land in Practice. Shown by the app shell while no profile exists.

const TARGET_LANG = 'sv' // only option in v1
const LEARNER_LANG = 'en'
const LEVELS: ClaimedLevel[] = ['below-A1', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const LEVEL_LABEL: Record<ClaimedLevel, string> = {
  'below-A1': 'Beginner',
  A1: 'A1',
  A2: 'A2',
  B1: 'B1',
  B2: 'B2',
  C1: 'C1',
  C2: 'C2',
}

type Step = 'welcome' | 'language' | 'level' | 'calibrate' | 'intro'

// Where the back arrow goes from each step. Welcome has no back; the calibrate step steps back via
// its own Skip (→ level).
const BACK: Partial<Record<Step, Step>> = {
  language: 'welcome',
  level: 'language',
  intro: 'level',
}

export function Onboarding() {
  const [step, setStep] = useState<Step>('welcome')
  const [level, setLevel] = useState<ClaimedLevel>('A1')
  // Whether the level came from the quiz vs. being hand-picked — only changes the intro copy.
  const [assessed, setAssessed] = useState(false)

  // Creating the profile flips the app shell's live query, which swaps Onboarding for the tabs,
  // landing on Practice with the first card ready.
  function finish() {
    void createProfile({ learnerLang: LEARNER_LANG, targetLang: TARGET_LANG, claimedLevel: level })
  }

  const back = BACK[step]

  return (
    <div class={styles.screen}>
      {back ? (
        <header class={styles.topbar}>
          <button class={styles.back} aria-label="Back" onClick={() => setStep(back)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        </header>
      ) : null}

      {step === 'calibrate' ? (
        <Calibration
          targetLang={TARGET_LANG}
          onComplete={(lvl) => {
            setLevel(lvl)
            setAssessed(true)
            setStep('intro')
          }}
          onCancel={() => setStep('level')}
        />
      ) : null}

      {step === 'welcome' ? (
        <div class={styles.step}>
          <div class={styles.body}>
            {/* The app's own name shown as a vocabulary card — a taste of what you'll see. */}
            <div class={styles.demoCard}>
              <h1 class={styles.demoWord}>Yak</h1>
              <div class={styles.demoPron}>
                <span class={styles.demoIpa}>/jæk/</span>
                <SpeakButton text="yak" lang="en" />
              </div>
              <div class={styles.demoSenses}>
                <span class={styles.demoGloss}>a shaggy-haired Himalayan ox</span>
                <span class={styles.demoGloss}>to talk informally but persistently; to chatter or prattle</span>
              </div>
            </div>
            <p class={styles.tagline}>
              <span class={styles.taglineLead}>Learn vocabulary the way it sticks.</span>
              <span class={styles.taglineSub}>A few words at a time, every day.</span>
            </p>
          </div>
          <button class={styles.primary} onClick={() => setStep('language')}>
            Get started
          </button>
        </div>
      ) : null}

      {step === 'language' ? (
        <div class={styles.step}>
          <div class={styles.body}>
            <h2 class={styles.heading}>What are you learning?</h2>
            <div class={styles.choice} aria-pressed="true">
              <span class={styles.flag}>🇸🇪</span>
              <span class={styles.choiceName}>{languageName(TARGET_LANG)}</span>
            </div>
            <p class={styles.aside}>More languages coming later — assuming the yak ever gets around to it.</p>
          </div>
          <button class={styles.primary} onClick={() => setStep('level')}>
            Continue
          </button>
        </div>
      ) : null}

      {step === 'level' ? (
        <div class={styles.step}>
          <div class={styles.body}>
            <h2 class={styles.heading}>What's your level?</h2>
            <div class={styles.chips}>
              {LEVELS.map((lvl) => (
                <button
                  key={lvl}
                  class={`${styles.chip} ${level === lvl ? styles.chipOn : ''}`}
                  onClick={() => setLevel(lvl)}
                >
                  {LEVEL_LABEL[lvl]}
                </button>
              ))}
            </div>
            <p class={styles.levelHelp}>
              Pick the level you're already comfortable with — your daily new words come from the level just above.
              Choose B1, for example, and you'll start learning B2 words.
            </p>
            <button class={styles.link} onClick={() => setStep('calibrate')}>
              Not sure? Take a quick assessment
            </button>
          </div>
          <button
            class={styles.primary}
            onClick={() => {
              setAssessed(false)
              setStep('intro')
            }}
          >
            Continue
          </button>
        </div>
      ) : null}

      {step === 'intro' ? (
        <div class={styles.step}>
          <div class={styles.body}>
            <div class={styles.levelDisplay}>
              <span class={styles.levelCaption}>Your level</span>
              <span class={styles.levelBadge}>{LEVEL_LABEL[level]}</span>
            </div>
            <h2 class={styles.heading}>{assessed ? 'Nice work!' : "You're all set"}</h2>
            <p class={styles.lede}>
              {assessed
                ? "Based on your answers, that's where we'll start you — we tailor each day's words to your level. You can change it anytime in your profile."
                : "We'll tailor each day's words to your level. You can change it anytime in your profile."}
            </p>
          </div>
          <button class={styles.primary} onClick={finish}>
            Start practising
          </button>
        </div>
      ) : null}
    </div>
  )
}
