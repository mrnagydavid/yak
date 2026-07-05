import styles from './ProfileScreen.module.css'

// iOS Safari clears a website's on-device storage after about a week of not opening it, which would wipe
// all of Yak's words and progress. Web apps added to the Home Screen are exempt (they're not "Safari" and
// keep their own use counter), so installing is both nicer and the fix. We show this only to iOS users:
// the eviction is iOS-specific, and iOS fires no `beforeinstallprompt`, so the install has to be spelled
// out by hand (Share -> Add to Home Screen) rather than offered as a button.
const isIOS =
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS 13+ reports itself as a Mac; disambiguate by touch support.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  // Safari's non-standard flag, set for Home-Screen web apps.
  (navigator as Navigator & { standalone?: boolean }).standalone === true

/** The iOS share glyph (a box with an up arrow) so "the Share button" has a visual anchor in the steps. */
function ShareIcon() {
  return (
    <svg
      class={styles.iosShare}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 3v11M12 3 8.5 6.5M12 3l3.5 3.5"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M7.5 10H6a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 18 10h-1.5"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

/** iOS-only note above the Legal section: how to install to the Home Screen and why it matters (data). */
export function IosInstallNote() {
  if (!isIOS) return null

  return (
    <section class={styles.section}>
      <h2 class={styles.sectionTitle}>On an iPhone or iPad?</h2>
      <div class={styles.iosNote}>
        {isStandalone ? (
          <p>
            Yak's on your Home Screen, so your words are safe from Safari's weekly storage cleanup. It's
            still worth tapping <strong>Export all data</strong> above once in a while — belt and braces.
          </p>
        ) : (
          <>
            <p>Add Yak to your Home Screen so it opens full-screen like a real app:</p>
            <ol class={styles.iosSteps}>
              <li>
                Tap the <strong>Share</strong> button <ShareIcon /> in Safari's toolbar.
              </li>
              <li>
                Scroll down and choose <strong>Add to Home Screen</strong>.
              </li>
            </ol>
            <p>
              It's not just for the full-screen look — it protects your words. Safari wipes a website's
              stored data after about a week of not opening it, and since Yak keeps everything on your
              device, that would take your progress with it. A Home-Screen app gets its own storage that
              Safari leaves alone.
            </p>
            <p>
              Either way, tap <strong>Export all data</strong> above now and then for a backup.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
