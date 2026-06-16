import styles from './SeedLoading.module.css'

/** First-launch screen shown while the Swedish seed imports into IndexedDB. */
export function SeedLoading() {
  return (
    <div class={styles.screen}>
      <div class={styles.spinner} />
      <p class={styles.text}>Preparing your Swedish word list…</p>
    </div>
  )
}
