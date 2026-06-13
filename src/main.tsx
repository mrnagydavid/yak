import { render } from 'preact'
import { App } from './app'
import { db } from './db/schema'
import { seedDevData } from './db/seed-dev'
import './styles/global.css'

// Request persistent storage so the browser won't evict IndexedDB data
navigator.storage?.persist?.()

// Dev-only: `resetYak()` from the console wipes the DB and reloads, re-running the seed.
// Stripped from production builds. (Temporary while developing.)
if (import.meta.env.DEV) {
  ;(window as Window & { resetYak?: () => Promise<void> }).resetYak = async () => {
    await db.delete()
    location.reload()
  }
}

// Temporary: seed sample data on first run so the screens aren't empty, then render.
// Awaiting guarantees data exists before any screen composes a session. (The real seed
// pipeline will replace this with a proper loading flow — SPEC §13.)
seedDevData().finally(() => {
  render(<App />, document.getElementById('app')!)
})
