import styles from './ProfileScreen.module.css'

export function ProfileScreen() {
  return (
    <div class={styles.screen}>
      <h1 class={styles.title}>Profile</h1>
      <p class={styles.placeholder}>Language, level, and settings will live here.</p>
      <p class={styles.version}>build {__COMMIT_HASH__}</p>
    </div>
  )
}
