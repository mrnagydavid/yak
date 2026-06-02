import Router, { Route } from 'preact-router'
import { BottomNav } from './components/BottomNav/BottomNav'
import { PracticeScreen } from './components/PracticeScreen/PracticeScreen'
import { VocabularyScreen } from './components/VocabularyScreen/VocabularyScreen'
import { ProfileScreen } from './components/ProfileScreen/ProfileScreen'
import styles from './app.module.css'

export function App() {
  return (
    <>
      <main class={styles.page}>
        <Router>
          <Route path="/" component={PracticeScreen} />
          <Route path="/vocabulary" component={VocabularyScreen} />
          <Route path="/profile" component={ProfileScreen} />
        </Router>
      </main>
      <BottomNav />
    </>
  )
}
