import { useState } from 'preact/hooks'
import { createProfile } from '../../db/queries'
import { languageName } from '../../lang'
import type { ClaimedLevel } from '../../srs/calibration'
import { Calibration } from '../Calibration/Calibration'
import styles from './Onboarding.module.css'

// First-launch flow (SPEC §7.8): welcome → pick language → pick level (or run the assessment) →
// intro → create the profile and land in Practice. Shown by the app shell while no profile exists.

const TARGET_LANG = 'sv' // only option in v1
const LEARNER_LANG = 'en'
const LEVELS: ClaimedLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

type Step = 'welcome' | 'language' | 'level' | 'calibrate' | 'intro'

export function Onboarding() {
  const [step, setStep] = useState<Step>('welcome')
  const [level, setLevel] = useState<ClaimedLevel>('A1')

  // Creating the profile flips the app shell's live query, which swaps Onboarding for the tabs,
  // landing on Practice with the first card ready.
  function finish() {
    void createProfile({ learnerLang: LEARNER_LANG, targetLang: TARGET_LANG, claimedLevel: level })
  }

  return (
    <div class={styles.screen}>
      {step === 'calibrate' ? (
        <Calibration
          targetLang={TARGET_LANG}
          onComplete={(lvl) => {
            setLevel(lvl)
            setStep('intro')
          }}
          onCancel={() => setStep('level')}
        />
      ) : null}

      {step === 'welcome' ? (
        <div class={styles.step}>
          <div class={styles.body}>
            <h1 class={styles.title}>Yak</h1>
            <p class={styles.lede}>Learn vocabulary the way it sticks — a few words at a time, every day.</p>
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
              {languageName(TARGET_LANG)}
              <span class={styles.choiceNote}>More languages coming later</span>
            </div>
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
                  {lvl}
                </button>
              ))}
            </div>
            <button class={styles.link} onClick={() => setStep('calibrate')}>
              Not sure? Take a quick assessment
            </button>
          </div>
          <button class={styles.primary} onClick={() => setStep('intro')}>
            Continue
          </button>
        </div>
      ) : null}

      {step === 'intro' ? (
        <div class={styles.step}>
          <div class={styles.body}>
            <h2 class={styles.heading}>You're all set</h2>
            <p class={styles.lede}>Open the app anytime to practice. Tap + to add your own words.</p>
          </div>
          <button class={styles.primary} onClick={finish}>
            Start practising
          </button>
        </div>
      ) : null}
    </div>
  )
}
