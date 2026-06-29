import { useEffect, useRef, useState } from 'preact/hooks'
import { getPracticeCardView, type PracticeCardView, type PracticeGroupMember } from '../../db/queries'
import type { RatingLabel } from '../../srs/fsrs-adapter'
import {
  composeSession,
  type GroupReviewUndo,
  recordGroupReview,
  recordReview,
  type ReviewUndo,
  undoGroupReview,
  undoReview,
} from '../../srs/session-composer'
import { EntryEditor } from '../EntryEditor/EntryEditor'
import { WiktionaryLink } from '../WordActions/WordActions'
import { ProgressBar } from './ProgressBar'
import { RatingButtons } from './RatingButtons'
import {
  dayKey,
  loadPersistedSession,
  persistIndex,
  persistSession,
  resumableSession,
  saveSession,
  setSessionIndex,
  setSessionViews,
} from './session-store'
import { StudyCard } from './StudyCard'
import styles from './PracticeScreen.module.css'

// One reversible action this sitting: a single-card rating or a multi-answer group rating. Undo
// dispatches on the kind. (In-memory only — gone after a refresh or tab switch, SPEC §6.5.)
type UndoEntry = { kind: 'single'; token: ReviewUndo } | { kind: 'group'; token: GroupReviewUndo }

export function PracticeScreen() {
  // The session is composed once per day and kept alive across navigation/refresh (SPEC §7.2):
  // the in-memory store resumes instantly on a tab switch; the persisted record resumes after a
  // page refresh. Only when neither has a session for today do we compose a fresh one.
  const [resumed] = useState(() => resumableSession())
  const [views, setViews] = useState<PracticeCardView[] | null>(resumed?.views ?? null)
  const [index, setIndex] = useState(resumed?.index ?? 0)
  const [revealed, setRevealed] = useState(false)
  // False once a "Push further" yields nothing more, so the button stops being a no-op.
  const [canPushFurther, setCanPushFurther] = useState(resumed?.canPushFurther ?? true)
  const [editing, setEditing] = useState(false)
  // One undo token per rating made this sitting; lets the user take back accidental taps,
  // card by card. In-memory only — it's gone after a refresh or tab switch (SPEC §6.5).
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  // Per-tab state for the current multi-answer card: which answer tab is active, and the grade given to
  // each answer so far. Both reset as each card resolves. (plan)
  const [activeTab, setActiveTab] = useState(0)
  const [ratings, setRatings] = useState<Map<string, RatingLabel>>(() => new Map())
  // The local day this session was composed for. If the app is left open past midnight (no
  // remount), foregrounding it recomposes so "caught up" doesn't stick into the new day.
  const loadedDayRef = useRef(resumed?.dayKey ?? dayKey())

  async function load(pushFurther = false) {
    const cards = await composeSession(Date.now(), pushFurther)
    const resolved = (await Promise.all(cards.map((c) => getPracticeCardView(c)))).filter(
      (v): v is PracticeCardView => v !== null,
    )
    const nextCanPush = pushFurther ? resolved.length > 0 : true
    loadedDayRef.current = dayKey()
    setViews(resolved)
    setIndex(0)
    setRevealed(false)
    setCanPushFurther(nextCanPush)
    setUndoStack([]) // a fresh batch replaces the queue — prior tokens no longer map to it
    setActiveTab(0)
    setRatings(new Map())
    saveSession({ dayKey: dayKey(), views: resolved, index: 0, canPushFurther: nextCanPush })
    void persistSession(resolved.map((v) => v.card), 0, nextCanPush)
  }

  // Re-hydrate a session saved before a page refresh: re-resolve its lightweight queue into views
  // and restore the cursor. Falls back to composing a fresh session if there's nothing to resume.
  async function resumeOrLoad() {
    const persisted = await loadPersistedSession()
    if (!persisted) {
      await load()
      return
    }
    const resolved = (await Promise.all(persisted.cards.map((c) => getPracticeCardView(c)))).filter(
      (v): v is PracticeCardView => v !== null,
    )
    const restoredIndex = Math.min(persisted.index, resolved.length)
    loadedDayRef.current = persisted.dayKey
    setViews(resolved)
    setIndex(restoredIndex)
    setRevealed(false)
    setCanPushFurther(persisted.canPushFurther)
    setUndoStack([]) // undo history doesn't survive a refresh — start the resumed sitting clean
    setActiveTab(0)
    setRatings(new Map())
    saveSession({
      dayKey: persisted.dayKey,
      views: resolved,
      index: restoredIndex,
      canPushFurther: persisted.canPushFurther,
    })
  }

  useEffect(() => {
    if (views === null) void resumeOrLoad() // no in-memory session → try the persisted one, else compose
  }, [])

  // Recompose if the app is foregrounded (or restored from bfcache) on a new local day while still
  // mounted — switching tabs already remounts and handles this, but staying on Practice past
  // midnight would otherwise keep showing the stale (often "caught up") session until a refresh.
  // A ref keeps the latest resumeOrLoad so the once-registered listener never calls a stale closure.
  const reloadRef = useRef(resumeOrLoad)
  reloadRef.current = resumeOrLoad
  useEffect(() => {
    function check() {
      if (document.visibilityState === 'visible' && dayKey() !== loadedDayRef.current) {
        void reloadRef.current()
      }
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('pageshow', check) // iOS PWA back-forward-cache restore
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('pageshow', check)
    }
  }, [])

  if (views === null) {
    return (
      <div class={styles.screen}>
        <p class={styles.message}>Loading…</p>
      </div>
    )
  }

  if (index >= views.length) {
    return (
      <div class={styles.screen}>
        <div class={styles.caughtUp}>
          <p class={styles.caughtTitle}>You're caught up for today.</p>
          {canPushFurther ? (
            <button class={styles.pushFurther} onClick={() => void load(true)}>
              Push further
            </button>
          ) : (
            <p class={styles.caughtSub}>Nothing more to pull right now.</p>
          )}
          {/* Keep the last rating reversible even after it tips you into "caught up". */}
          {undoStack.length > 0 ? <UndoButton onClick={() => void undo()} /> : null}
        </div>
      </div>
    )
  }

  const view = views[index]
  const isRevealed = revealed || view.card.mode === 'new'

  // Advance to the next card: step the cursor, reset per-card UI, persist the position.
  function advance() {
    setActiveTab(0)
    setRatings(new Map())
    setRevealed(false)
    setIndex((i) => {
      const next = i + 1
      setSessionIndex(next) // in-memory: leaving mid-session (tab switch) resumes here
      void persistIndex(next) // persisted: a page refresh resumes here too
      return next
    })
  }

  // Commit a multi-answer card: persist every answer's own grade as one reversible step, then advance.
  async function commitGroup(members: PracticeGroupMember[], graded: Map<string, RatingLabel>) {
    const token = await recordGroupReview(
      members.map((m) => ({ translationId: m.translationId, label: graded.get(m.translationId) ?? 'good' })),
    )
    setUndoStack((s) => [...s, { kind: 'group', token }])
    advance()
  }

  async function rate(rating: RatingLabel) {
    navigator.vibrate?.(10)
    const card = view.card
    if (!card.group || !view.group) {
      const token = await recordReview(card, rating)
      setUndoStack((s) => [...s, { kind: 'single', token }])
      advance()
      return
    }
    // Group: grade the active answer, then auto-advance to the next unrated tab — or commit if done.
    const members = view.group.members
    const graded = new Map(ratings).set(members[activeTab].translationId, rating)
    const nextUnrated = members.findIndex((m) => !graded.has(m.translationId))
    if (nextUnrated === -1) await commitGroup(members, graded)
    else {
      setRatings(graded)
      setActiveTab(nextUnrated)
    }
  }

  // "Knew all": grade every still-unrated answer Good, then commit.
  async function knewAll() {
    navigator.vibrate?.(10)
    if (!view.group) return
    const graded = new Map(ratings)
    for (const m of view.group.members) if (!graded.has(m.translationId)) graded.set(m.translationId, 'good')
    await commitGroup(view.group.members, graded)
  }

  // Take back the most recent rating: reverse its scheduling, step back to that card (shown
  // revealed, ready to re-rate), and rewind the cursor. The stack and cursor move in lockstep
  // — each rating pushes a token and advances one; each undo pops one and rewinds one.
  async function undo() {
    const entry = undoStack[undoStack.length - 1]
    if (!entry) return
    navigator.vibrate?.(10)
    if (entry.kind === 'group') await undoGroupReview(entry.token)
    else await undoReview(entry.token)
    setUndoStack((s) => s.slice(0, -1))
    setActiveTab(0)
    setRatings(new Map())
    setRevealed(true)
    setIndex((i) => {
      const prev = i - 1
      setSessionIndex(prev)
      void persistIndex(prev)
      return prev
    })
  }

  // After an in-session edit (note / examples / translation override), re-resolve just this
  // card's view so the change shows without a refresh. The queue isn't recomposed — only this
  // card's overlay is refreshed, in both component state and the tab-switch resume cache.
  // (The persisted record stores lightweight cards, not views, so it re-resolves on its own.)
  async function refreshCurrentView() {
    if (!views) return
    const refreshed = await getPracticeCardView(view.card)
    if (!refreshed) return
    const nextViews = views.map((v, i) => (i === index ? refreshed : v))
    setViews(nextViews)
    setSessionViews(nextViews)
  }

  return (
    <div class={styles.screen}>
      <div class={styles.topbar}>
        <ProgressBar value={index} total={views.length} />
        {/* Always reserve the undo slot so the progress track's width stays put when the in-memory
            undo stack resets on a tab switch (it's per-sitting, not part of the resumed session). */}
        {undoStack.length > 0 ? <UndoButton onClick={() => void undo()} /> : <span class={styles.undoSlot} aria-hidden="true" />}
        <button class={styles.edit} aria-label="Edit note, examples, translation" onClick={() => setEditing(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      </div>
      <div
        class={`${styles.cardArea} ${isRevealed ? '' : styles.tappable}`}
        onClick={isRevealed ? undefined : () => setRevealed(true)}
      >
        {/* Keyed on the index so each question is a fresh mount — that's what triggers the
            card-in animation when advancing past a rating (tap-to-reveal keeps the same key). */}
        <StudyCard
          key={index}
          view={view}
          revealed={isRevealed}
          activeTab={activeTab}
          ratings={ratings}
          onSelectTab={setActiveTab}
        />
      </div>
      {/* Wiktionary link for the Swedish word — pinned just above the rating buttons; shown only once
          revealed (so it can't hint the answer in production). The footer always reserves its space, so
          revealing doesn't shrink the card area and nudge the prompt upward. A multi-answer card has no
          single Swedish word to link, so it's omitted there. */}
      <div class={styles.wiktFooter}>
        {isRevealed && !view.card.group ? <WiktionaryLink lemma={view.target.lemma} lang={view.target.lang} /> : null}
      </div>
      <div class={styles.actions}>
        <RatingButtons mode={view.card.mode} onRate={rate} />
        {/* Multi-answer card: a full-width "Knew all" right under the rating buttons (the answer tabs
            live at the top of the card's reveal). Shown only once revealed. */}
        {view.group && isRevealed ? (
          <button type="button" class={styles.knewAll} onClick={() => void knewAll()}>
            Knew all
          </button>
        ) : null}
      </div>

      {editing ? (
        <EntryEditor
          entryId={view.target.id}
          translationLang={view.native?.lang ?? 'en'}
          title="Edit word"
          onClose={() => {
            setEditing(false)
            void refreshCurrentView()
          }}
        />
      ) : null}
    </div>
  )
}

// A looping (counter-clockwise) arrow, so it reads as "undo" rather than a plain back chevron.
function UndoButton({ onClick }: { onClick: () => void }) {
  return (
    <button class={styles.undo} aria-label="Undo last rating" onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" />
      </svg>
    </button>
  )
}
