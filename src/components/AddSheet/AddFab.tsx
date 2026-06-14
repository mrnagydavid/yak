import { useRouter } from 'preact-router'
import { useState } from 'preact/hooks'
import { AddSheet } from './AddSheet'
import styles from './AddFab.module.css'

/** Floating "Add" button — shown on Practice and Vocabulary, opens the Add sheet. (SPEC §7.1) */
export function AddFab() {
  const [routeState] = useRouter()
  const [open, setOpen] = useState(false)

  // Vocabulary only — Practice's bottom is owned by the rating buttons. (SPEC §7.1)
  const path = routeState?.path ?? '/'
  if (!path.startsWith('/vocabulary')) return null

  return (
    <>
      <button class={styles.fab} aria-label="Add a word" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      {open ? <AddSheet onClose={() => setOpen(false)} /> : null}
    </>
  )
}
