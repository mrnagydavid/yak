import styles from './Loading.module.css'

const thinkingYak = `${import.meta.env.BASE_URL}assets/thinking-yak.webp`

interface LoadingProps {
  /** Short reassuring line under the mascot (first-launch seed import uses this). */
  caption?: string
  /** Sits inside a taller screen (e.g. below the Vocabulary filters) rather than filling it. */
  compact?: boolean
}

/**
 * The app's one loading indicator: the thinking-yak mascot, gently bobbing over a soft
 * pulsing halo. Replaces the old spinners and bare "Loading…" text everywhere a screen is
 * waiting on data. The "…" in the mascot's thought bubble already reads as "thinking", so
 * no spinner is needed. Holds still under prefers-reduced-motion.
 */
export function Loading({ caption, compact }: LoadingProps) {
  return (
    <div
      class={`${styles.screen} ${compact ? styles.compact : styles.full}`}
      role="status"
      aria-live="polite"
      aria-label={caption ?? 'Loading'}
    >
      <div class={styles.wrap}>
        <img class={styles.yak} src={thinkingYak} alt="" width="140" height="140" />
      </div>
      {caption ? <p class={styles.caption}>{caption}</p> : null}
    </div>
  )
}
