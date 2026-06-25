import { useEffect, useState } from 'preact/hooks'
import { wiktionaryUrl } from '../../lang'
import { hasVoiceFor, speak } from '../../lang/speech'
import styles from './WordActions.module.css'

/** Whether the device has a TTS voice for `lang`. Voices can load asynchronously, so this also
 *  re-checks on the `voiceschanged` event. */
function useHasVoice(lang: string): boolean {
  const [available, setAvailable] = useState(() => hasVoiceFor(lang))
  useEffect(() => {
    const s = typeof window !== 'undefined' ? window.speechSynthesis : undefined
    if (!s) return
    const update = () => setAvailable(hasVoiceFor(lang))
    update()
    s.addEventListener('voiceschanged', update)
    return () => s.removeEventListener('voiceschanged', update)
  }, [lang])
  return available
}

/** 🔊 button that speaks `text` in `lang`. Renders nothing when no matching voice is installed, so
 *  we never mispronounce the word with a wrong-language voice. `stopPropagation` keeps a tap from
 *  also revealing the practice card / navigating a list row. */
export function SpeakButton({ text, lang, class: className }: { text: string; lang: string; class?: string }) {
  const available = useHasVoice(lang)
  if (!available) return null
  return (
    <button
      type="button"
      class={`${styles.speak} ${className ?? ''}`}
      aria-label="Listen to pronunciation"
      title="Listen"
      onClick={(e) => {
        e.stopPropagation()
        speak(text, lang)
      }}
    >
      🔊
    </button>
  )
}

/** Link to the word's Wiktionary page (opens in a new tab), as a 📖 icon that mirrors the 🔊 button.
 *  The label lives in aria-label/title since there's no visible text. */
export function WiktionaryLink({ lemma, lang, class: className }: { lemma: string; lang: string; class?: string }) {
  return (
    <a
      class={`${styles.wikt} ${className ?? ''}`}
      href={wiktionaryUrl(lemma, lang)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open in Wiktionary"
      title="Open in Wiktionary"
      onClick={(e) => e.stopPropagation()}
    >
      📖
    </a>
  )
}
