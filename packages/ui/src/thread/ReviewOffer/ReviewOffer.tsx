import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Problem } from '../../primitives/Problem/Problem'
import s from './ReviewOffer.module.css'

/*
 * A review a lead or the coordinator offered a task as its work turned real with none (a skipped review can be added back until
 * merge): a quiet line of the thread, by its reviewer. It adds nothing by itself: Add puts that reviewer on, and where the work
 * is up, its review starts at once; No thanks turns it down, and it isn't offered again. Answered, the line says what came of it.
 */

export interface ReviewOfferText {
  ask: string
  /** Putting the reviewer named on: Add GPT-6.1 Sol. */
  add: (who: string) => string
  decline: string
  /** Once added: who reviews it. */
  added: (who: string) => string
  /** Once turned down, or no longer the task's to take. */
  declined: string
}

export const reviewOfferText: ReviewOfferText = {
  ask: 'Add a review?',
  add: (who) => `Add ${who}`,
  decline: 'No thanks',
  added: (who) => `${who} reviews it.`,
  declined: 'No review.',
}

export interface ReviewOfferProps {
  /** Who would review it: the model, as its picker names it. */
  who: string
  /** What it asks, where it names the task: Add a review of “Context ring card”? */
  ask?: string
  onAdd?: () => void
  onDecline?: () => void
  /** One of the two is under way. */
  busy?: boolean
  /** Why the last press didn't go through, in a line. */
  error?: string | null
  /** Answered: who reviews it now, or null where nobody does. Left out while the offer stands. */
  answered?: string | null
  text?: Partial<ReviewOfferText>
}

export function ReviewOffer({ who, ask, onAdd, onDecline, busy = false, error, answered, text }: ReviewOfferProps) {
  const t = { ...reviewOfferText, ...text }
  return (
    <div className={s.offer} data-busy={busy || undefined}>
      <p className={s.line}>
        <span className={s.ask}>{ask ?? t.ask}</span>
        {answered === undefined ? (
          <>
            <LinkButton className={s.add} disabled={busy} onClick={onAdd}>
              {t.add(who)}
            </LinkButton>
            <LinkButton className={s.decline} disabled={busy} onClick={onDecline}>
              {t.decline}
            </LinkButton>
          </>
        ) : (
          <span>{answered === null ? t.declined : t.added(answered)}</span>
        )}
      </p>
      {error != null && error !== '' && <Problem size="small">{error}</Problem>}
    </div>
  )
}
