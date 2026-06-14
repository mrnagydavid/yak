import Router, { Route } from 'preact-router'
import { AddFab } from './components/AddSheet/AddFab'
import { BottomNav } from './components/BottomNav/BottomNav'
import { PracticeScreen } from './components/PracticeScreen/PracticeScreen'
import { VocabularyScreen } from './components/VocabularyScreen/VocabularyScreen'
import { WordDetail } from './components/WordDetail/WordDetail'
import { ProfileScreen } from './components/ProfileScreen/ProfileScreen'
import styles from './app.module.css'

export function App() {
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
