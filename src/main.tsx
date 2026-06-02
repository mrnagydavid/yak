import { render } from 'preact'
import { App } from './app'
import { seedDevData } from './db/seed-dev'
import './styles/global.css'

// Request persistent storage so the browser won't evict IndexedDB data
navigator.storage?.persist?.()

// Temporary: seed sample data on first run so the screens aren't empty.
// Reactive via useLiveQuery, so no need to block render on it.
void seedDevData()

render(<App />, document.getElementById('app')!)
