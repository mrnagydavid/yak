import { route } from 'preact-router'
import { shouldShowExportReminder, currentMonthString } from '../../db/export-reminder'
import { updateProfile } from '../../db/queries'
import type { Profile } from '../../db/types'
import styles from './ExportReminderBanner.module.css'

// Cloned from the calorie-counter sibling app (components/ExportReminderBanner.tsx) — same trigger, copy,
// and buttons, so the two apps feel like they come from the same developer. "Go to Export" heads to the
// Profile tab, where Yak's "Export all data" lives.
export function ExportReminderBanner({ profile }: { profile: Profile }) {
  if (!shouldShowExportReminder(profile)) return null

  const dismiss = () => {
    void updateProfile(profile.id, { exportReminderDismissedUntil: currentMonthString() })
  }

  return (
    <div class={styles.banner}>
      <div class={styles.message}>It's a new month — back up your data so you don't lose it.</div>
      <div class={styles.actions}>
        <button class={styles.dismissButton} onClick={dismiss}>
          Dismiss
        </button>
        <button class={styles.exportButton} onClick={() => route('/profile')}>
          Go to Export
        </button>
      </div>
    </div>
  )
}
