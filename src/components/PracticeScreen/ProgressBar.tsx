import styles from './ProgressBar.module.css'

/** Thin session progress bar — fills as the session proceeds, no numbers. (SPEC §7.2) */
export function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <div class={styles.track}>
      <div class={styles.fill} style={{ width: `${pct}%` }} />
    </div>
  )
}
