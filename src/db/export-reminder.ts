import type { Profile } from './types'

// Cloned from the calorie-counter sibling app (src/db/exportReminder.ts) so both apps nag identically:
// on by default, only on the 1st of the month, dismissable for the rest of that month.

export function currentMonthString(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function shouldShowExportReminder(profile: Profile): boolean {
  // Treat undefined as true (default ON for profiles created before the field existed)
  const enabled = profile.exportReminderEnabled ?? true
  if (!enabled) return false

  // Only show on the 1st of the month
  if (new Date().getDate() !== 1) return false

  // If already dismissed for this month, don't show
  const dismissedUntil = profile.exportReminderDismissedUntil
  if (dismissedUntil && dismissedUntil >= currentMonthString()) return false

  return true
}
