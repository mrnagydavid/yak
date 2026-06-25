// Text-to-speech for word pronunciation, via the browser's Web Speech API (no dependency, uses the
// OS voices). All access is guarded so importing this in a non-DOM context (tests) is safe.

function synth(): SpeechSynthesis | undefined {
  return typeof window !== 'undefined' ? window.speechSynthesis : undefined
}

/** The best installed voice for an app language code ('sv', 'en', …). Voice `lang` is BCP-47
 *  ('sv-SE'), so a prefix match on the bare code is enough. */
function pickVoice(s: SpeechSynthesis, lang: string): SpeechSynthesisVoice | undefined {
  const prefix = lang.toLowerCase()
  return s.getVoices().find((v) => v.lang.toLowerCase().startsWith(prefix))
}

/** Whether the device can pronounce this language. Used to hide the audio button rather than read
 *  e.g. Swedish text with an English voice (SPEC §13). */
export function hasVoiceFor(lang: string): boolean {
  const s = synth()
  return s ? pickVoice(s, lang) !== undefined : false
}

/** Speak `text` in `lang`, cancelling anything already playing. No-op when speech is unavailable. */
export function speak(text: string, lang: string): void {
  const s = synth()
  if (!s) return
  s.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  const voice = pickVoice(s, lang)
  if (voice) utterance.voice = voice
  utterance.lang = voice?.lang ?? lang
  s.speak(utterance)
}
