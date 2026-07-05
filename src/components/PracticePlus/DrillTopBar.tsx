import styles from './PracticePlus.module.css'

// Shared chrome for every drill runner: a progress bar + count + End button. Progress is words CLEARED
// out of the batch (not cursor position), so it only ever moves forward — a re-shown word never rewinds
// it. Language-agnostic, so en/ett and verb-forms look and behave identically up top.
export function DrillTopBar({ cleared, total, onEnd }: { cleared: number; total: number; onEnd: () => void }) {
  const pct = total > 0 ? (cleared / total) * 100 : 0
  return (
    <div class={styles.drillTop}>
      <div class={styles.track}>
        <div class={styles.fill} style={{ width: `${pct}%` }} />
      </div>
      <span class={styles.count}>
        {cleared} / {total}
      </span>
      <button type="button" class={styles.end} onClick={onEnd}>
        End
      </button>
    </div>
  )
}
