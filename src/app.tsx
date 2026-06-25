import { useLiveQuery } from 'dexie-react-hooks'
import Router, { Route } from 'preact-router'
import { AddFab } from './components/AddSheet/AddFab'
import { BottomNav } from './components/BottomNav/BottomNav'
import { Onboarding } from './components/Onboarding/Onboarding'
import { PracticeScreen } from './components/PracticeScreen/PracticeScreen'
import { ProfileScreen } from './components/ProfileScreen/ProfileScreen'
import { VocabularyScreen } from './components/VocabularyScreen/VocabularyScreen'
import { WordDetail } from './components/WordDetail/WordDetail'
import { getActiveProfile } from './db/queries'
import styles from './app.module.css'

export function App() {
  // No profile yet → first launch: run onboarding (full screen, no tabs). Creating the profile at
  // the end flips this query and swaps in the tabs, landing on Practice. (SPEC §7.8)
  const data = useLiveQuery(async () => ({ profile: await getActiveProfile() }), [])
  if (data === undefined) return null // profile query still resolving
  if (!data.profile) return <Onboarding />

  return (
    <>
      <main class={styles.page}>
        <Router>
          <Route path="/" component={PracticeScreen} />
          <Route path="/vocabulary" component={VocabularyScreen} />
          <Route path="/word/:id" component={WordDetail} />
          <Route path="/profile" component={ProfileScreen} />
        </Router>
      </main>
      <AddFab />
      <BottomNav />
    </>
  )
}
