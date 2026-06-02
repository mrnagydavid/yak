import { useRouter } from 'preact-router'
import styles from './BottomNav.module.css'

const TABS = [
  { href: '/', label: 'Practice', icon: '🗣️' },
  { href: '/vocabulary', label: 'Vocabulary', icon: '📖' },
  { href: '/profile', label: 'Profile', icon: '⚙️' },
]

export function BottomNav() {
  const [routeState] = useRouter()
  const currentPath = routeState?.path ?? '/'

  const tabClass = (href: string) => {
    const isActive = href === '/' ? currentPath === '/' : currentPath.startsWith(href)
    return `${styles.tab} ${isActive ? styles.active : ''}`
  }

  return (
    <nav class={styles.nav}>
      {TABS.map((tab) => (
        <a key={tab.href} href={tab.href} class={tabClass(tab.href)}>
          <span class={styles.icon}>{tab.icon}</span>
          <span class={styles.label}>{tab.label}</span>
        </a>
      ))}
    </nav>
  )
}
