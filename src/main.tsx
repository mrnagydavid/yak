import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { App } from './app'
import { SeedLoading } from './components/SeedLoading/SeedLoading'
import { db } from './db/schema'
import { loadSeedIfEmpty } from './db/seed'
import './styles/global.css'

// Request persistent storage so the browser won't evict IndexedDB data
navigator.storage?.persist?.()

// Dev-only: `resetYak()` from the console wipes the DB and reloads, re-importing the seed.
// Stripped from production builds.
if (import.meta.env.DEV) {
  ;(window as Window & { resetYak?: () => Promise<void> }).resetYak = async () => {
    await db.delete()
    location.reload()
  }
}

// Import the Swedish seed on first launch (shows a loading screen), then render the app.
function Root() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void loadSeedIfEmpty().finally(() => setReady(true))
  }, [])
  return ready ? <App /> : <SeedLoading />
}

render(<Root />, document.getElementById('app')!)
