import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './ReviewOffer.module.css'

/*
 * The review a change is offered once, as its work turns real (a skipped review can be added back until merge): a quiet line on
 * its card, with the reviewer the project's rules would pick. It adds nothing by itself: Add puts that reviewer on, and where
 * the work is up, its review starts at once; No thanks turns it down, and it doesn't come back.
 */

export interface ReviewOfferText {
  ask: string
  /** Putting the reviewer named on: Add GPT-6.1 Sol. */
  add: (who: string) => string
  decline: string
}

export const reviewOfferText: ReviewOfferText = {
  ask: 'Add a review?',
  add: (who) => `Add ${who}`,
  decline: 'No thanks',
}

export interface ReviewOfferProps {
  /** Who would review it: the model, as its picker names it. */
  who: string
  onAdd: () => void
  onDecline: () => void
  /** One of the two is under way. */
  busy?: boolean
  /** Why the last press didn't go through, in a line. */
  error?: string | null
  text?: Partial<ReviewOfferText>
}

export function ReviewOffer({ who, onAdd, onDecline, busy = false, error, text }: ReviewOfferProps) {
  const t = { ...reviewOfferText, ...text }
  return (
    <div className={s.offer} data-busy={busy || undefined}>
      <p className={s.line}>
        <span className={s.ask}>{t.ask}</span>
        <LinkButton className={s.add} disabled={busy} onClick={onAdd}>
          {t.add(who)}
        </LinkButton>
        <LinkButton className={s.decline} disabled={busy} onClick={onDecline}>
          {t.decline}
        </LinkButton>
      </p>
      {error != null && error !== '' && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
