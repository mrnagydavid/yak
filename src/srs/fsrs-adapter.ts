import {
  type Card,
  createEmptyCard,
  fsrs,
  type FSRS,
  generatorParameters,
  type Grade,
  Rating,
  State,
} from 'ts-fsrs'
import { ulid } from '../db/ids'
import type { ReviewState, ReviewStateName, Skill } from '../db/types'

// The single boundary between Yak and ts-fsrs. Everything FSRS-specific (Card shape,
// Rating/State enums, scheduling) stays in here; the rest of the app speaks in terms of
// our own ReviewState rows and the four self-eval button labels. (SPEC §8)

/** The four self-evaluation buttons (SPEC §6.5), in our own vocabulary. */
export type RatingLabel = 'again' | 'hard' | 'good' | 'easy'

const LABEL_TO_GRADE: Record<RatingLabel, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
}

const STATE_TO_NAME: Record<State, ReviewStateName> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
}

const NAME_TO_STATE: Record<ReviewStateName, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
}

// Default FSRS parameters with learning steps enabled (SPEC §8.1). A single shared
// scheduler instance; per-user parameter optimisation (§8.1) can swap this later.
//
// `enable_fuzz` spreads each interval by a small random amount. Without it, cards rated
// identically in one sitting (e.g. a batch of below-level words all rated "Easy") get byte-
// identical intervals and stay perfectly synchronised — so a word's recognition and production
// keep coming due on the same day, session after session, in the same order. The default fuzz
// seed mixes in the review timestamp (ms), so cards rated seconds apart diverge, de-syncing the
// batch. (Complements the one-direction-per-word rule in the session composer.)
const scheduler: FSRS = fsrs(generatorParameters({ enable_fuzz: true }))

/** Map the FSRS-managed portion of a Card onto our ReviewState fields. */
function cardToFields(
  card: Card,
): Pick<
  ReviewState,
  | 'difficulty'
  | 'stability'
  | 'reps'
  | 'lapses'
  | 'state'
  | 'due'
  | 'lastReview'
  | 'scheduledDays'
  | 'elapsedDays'
  | 'learningSteps'
> {
  return {
    difficulty: card.difficulty,
    stability: card.stability,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_TO_NAME[card.state],
    due: card.due.getTime(),
    lastReview: card.last_review ? card.last_review.getTime() : null,
    scheduledDays: card.scheduled_days,
    elapsedDays: card.elapsed_days,
    learningSteps: card.learning_steps,
  }
}

/** Reconstruct a ts-fsrs Card from a stored ReviewState. */
function fieldsToCard(rs: ReviewState): Card {
  return {
    due: new Date(rs.due),
    stability: rs.stability,
    difficulty: rs.difficulty,
    elapsed_days: rs.elapsedDays,
    scheduled_days: rs.scheduledDays,
    learning_steps: rs.learningSteps,
    reps: rs.reps,
    lapses: rs.lapses,
    state: NAME_TO_STATE[rs.state],
    last_review: rs.lastReview ? new Date(rs.lastReview) : undefined,
  }
}

/** Create a fresh, unreviewed ReviewState for a (translation, skill) pair. */
export function createReviewState(
  translationId: string,
  skill: Skill,
  now: number = Date.now(),
): ReviewState {
  const card = createEmptyCard(new Date(now))
  return {
    id: ulid(now),
    translationId,
    skill,
    ...cardToFields(card),
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Apply a self-evaluation rating to a ReviewState and return the updated row.
 * Pure — the caller persists the result.
 */
export function applyRating(
  rs: ReviewState,
  label: RatingLabel,
  now: number = Date.now(),
): ReviewState {
  const { card } = scheduler.next(fieldsToCard(rs), new Date(now), LABEL_TO_GRADE[label])
  return { ...rs, ...cardToFields(card), updatedAt: now }
}

/** Whether a ReviewState is due for practice at `now`. */
export function isDue(rs: ReviewState, now: number = Date.now()): boolean {
  return rs.due <= now
}
