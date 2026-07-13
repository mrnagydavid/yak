import type { FunctionComponent } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { ActiveDrillSession, DrillSessionLog, DrillType } from '../../db/types'
import {
  endDrillSession,
  getActiveDrillSession,
  resolveDrillQuestions,
  startDrillSession,
} from '../../drills/session'
import type { DrillQuestion, DrillRunnerProps } from '../../drills/types'
import { GenderDrill } from '../../lang/sv/drills/GenderDrill'
import { VerbFormsDrill } from '../../lang/sv/drills/VerbFormsDrill'
import { DrillHub } from './DrillHub'
import { DrillStats } from './DrillStats'
import styles from './PracticePlus.module.css'
import { Loading } from '../Loading/Loading'

// Which component runs each drill type. The runners are language-coupled (they live in the language's
// module); the shell just dispatches to the right one by the active session's drill type.
const RUNNERS: Partial<Record<DrillType, FunctionComponent<DrillRunnerProps>>> = {
  'sv:gender': GenderDrill,
  'sv:verbForms': VerbFormsDrill,
}

type Phase = 'loading' | 'hub' | 'session' | 'stats'
type Finished = { log: DrillSessionLog; missed: DrillQuestion[] }

// The phase at the last unmount, kept at module scope to skip the full-screen "Loading…" on every
// return to the tab. A drill session can only be started from here (handleStart), so if we last left
// on the hub there's nothing to resume — render the hub straight away. We still probe once per app load
// (lastPhase undefined) and when resuming a live session (lastPhase 'session'), since a sticky session
// survives refreshes; the mount effect below stays authoritative and corrects any optimistic guess.
let lastPhase: Phase | undefined

/**
 * The Practice+ tab. Owns the top-level state machine: resume a sticky drill if one is running, else
 * show the hub; a running drill takes over the whole tab until it's finished, which lands on stats and
 * then back at the hub. Screens are self-contained components — the drill runner (language-coupled) and
 * the hub/stats (agnostic).
 */
export function PracticePlusScreen() {
  const [phase, setPhase] = useState<Phase>(
    lastPhase === undefined || lastPhase === 'session' ? 'loading' : 'hub',
  )
  const [session, setSession] = useState<ActiveDrillSession | null>(null)
  const [questions, setQuestions] = useState<DrillQuestion[]>([])
  const [finished, setFinished] = useState<Finished | null>(null)

  // Remember the phase across unmounts so the next return to the tab can skip the loading blink.
  useEffect(() => {
    lastPhase = phase
  }, [phase])

  // On mount, resume a sticky session if there is one (it survives refreshes and day changes).
  useEffect(() => {
    void (async () => {
      const active = await getActiveDrillSession()
      if (active) {
        setSession(active)
        setQuestions(await resolveDrillQuestions(active.queue))
        setPhase('session')
      } else {
        setPhase('hub')
      }
    })()
  }, [])

  async function handleStart(type: DrillType) {
    const active = await startDrillSession(type)
    if (!active) return // nothing eligible (Start is hidden in that case, but guard anyway)
    setSession(active)
    setQuestions(await resolveDrillQuestions(active.queue))
    setPhase('session')
  }

  async function handleFinish(finalSession: ActiveDrillSession, endedEarly: boolean) {
    const log = await endDrillSession(finalSession, endedEarly)
    const missedIds = new Set(finalSession.missed)
    setFinished({ log, missed: questions.filter((q) => missedIds.has(q.entry.id)) })
    setSession(null)
    setPhase('stats')
  }

  if (phase === 'loading') {
    return <Loading />
  }

  if (phase === 'stats' && finished) {
    return (
      <div class={styles.screen}>
        <DrillStats
          log={finished.log}
          missed={finished.missed}
          onDone={() => {
            setFinished(null)
            setPhase('hub')
          }}
        />
      </div>
    )
  }

  if (phase === 'session' && session) {
    const Runner = RUNNERS[session.drill]
    if (Runner) {
      return (
        <div class={styles.screen}>
          <Runner session={session} questions={questions} onFinish={(s, early) => void handleFinish(s, early)} />
        </div>
      )
    }
    // Unknown drill type (shouldn't happen) — fall through to the hub.
  }

  return (
    <div class={styles.screen}>
      <DrillHub onStart={(type) => void handleStart(type)} />
    </div>
  )
}
