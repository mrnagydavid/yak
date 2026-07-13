import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'preact/hooks'
import type { DrillType } from '../../db/types'
import { type DrillHubItem, getDrillHub } from '../../drills/session'
import styles from './PracticePlus.module.css'
import { Loading } from '../Loading/Loading'

// Last computed hub, kept at module scope so it survives a tab switch (DrillHub unmounts on leave and
// remounts on return). Same idea as the Profile screen's progress cache: on return we keep showing the
// previous boxes — which then update to fresh stats — instead of flashing "Loading…" and popping the
// layout. One slot is enough: v1 has a single target language.
let hubCache: DrillHubItem[] | undefined

/** The Practice+ picker: one box per drill the active target language offers, with its mastery +
 *  recent form and a Start button. Drill list comes from the registry, so it's language-agnostic. */
export function DrillHub({ onStart }: { onStart: (type: DrillType) => void }) {
  const live = useLiveQuery(() => getDrillHub(), [])
  useEffect(() => {
    if (live) hubCache = live
  }, [live])
  // Fresh result if ready, else the cached boxes from before the last tab switch, else undefined (first run).
  const items = live ?? hubCache

  return (
    <div class={styles.hub}>
      <h1 class={styles.hubTitle}>Practice+</h1>
      <p class={styles.hubIntro}>
        Extra drills that only use words you're already learning in Practice — they don't affect your
        normal practice. A word becomes <strong>mastered</strong> once you've answered it right a few
        times in a row, and mastered words then come up less often.
      </p>

      {items === undefined ? (
        <Loading compact />
      ) : items.length === 0 ? (
        <p class={styles.muted}>No extra drills for this language yet.</p>
      ) : (
        items.map(({ meta, overview }) => (
          <section key={meta.type} class={styles.drillBox}>
            <h2 class={styles.boxTitle}>{meta.title}</h2>
            <p class={styles.desc}>{meta.description}</p>
            {meta.funFact ? <p class={styles.funFact}>{meta.funFact}</p> : null}
            {overview.eligible > 0 ? (
              <>
                {/* Only show progress once there's something to show — no "0 of N" before a first run. */}
                {overview.seen > 0 ? (
                  <div class={styles.stats}>
                    <span>
                      {overview.solid} of {overview.eligible} mastered
                    </span>
                    {overview.lastSession && overview.lastSession.words > 0 ? (
                      <span>
                        Last session: {overview.lastSession.firstTry} of {overview.lastSession.words} on
                        the first try
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <button type="button" class={styles.start} onClick={() => onStart(meta.type)}>
                  Start
                </button>
              </>
            ) : (
              <p class={styles.locked}>Learn some words in Practice first to unlock this.</p>
            )}
          </section>
        ))
      )}
    </div>
  )
}
