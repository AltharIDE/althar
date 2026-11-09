import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import type { SealFacts } from '../../seal/seal'
import type { ReviewRounds, RoundsOut } from '../PlansAndReviews/PlansAndReviews'
import { ReviewSealGlyph } from '../ReviewSeal/ReviewSeal'
import s from './TaskPreviews.module.css'

/*
 * What a task's review may take, and "When a check finds more" makes: a
 * seal for its review and one for the check of its fixes, the check
 * fainter, as one it may not need; then what happens once the check found
 * more, in violet where that waits on the person. A picture: nothing in it
 * can be pressed, and a screen reader reads its words.
 */

export interface RoundsPreviewText {
  /** What it is, for a screen reader. */
  label: string
  title: string
  upTo: (rounds: ReviewRounds) => string
  out: Record<RoundsOut, string>
}

export const roundsPreviewText: RoundsPreviewText = {
  label: 'Rounds of review',
  title: 'Review',
  // A review, and the one check of its fixes that may follow it: a fix is never reviewed again in whole.
  upTo: (n) => (n === 1 ? 'one review' : n === 2 ? 'a review, and one check of its fixes' : `up to ${n} rounds`),
  out: { settled: 'Goes on, once every finding is settled', ask: 'Asks you' },
}

export type RoundsPreviewProps = RootProps<
  'figure',
  {
    rounds: ReviewRounds
    /** What a task does once its rounds run out. */
    out: RoundsOut
    /** The review the seals say: a sample's, or the person's last. Each seal counts its own round. */
    facts: SealFacts
    text?: Partial<RoundsPreviewText>
  }
>

/** The review rounds a task may take, as the seals each would leave, and what happens once they run out. */
export function RoundsPreview({ rounds, out, facts, text, className, ...rest }: RoundsPreviewProps) {
  const t = { ...roundsPreviewText, ...text }
  return (
    <figure className={cx(s.card, className)} aria-label={t.label} {...rest}>
      <div className={s.reviewHead}>
        <span className={s.reviewTitle}>{t.title}</span>
        <span className={s.upTo}>{t.upTo(rounds)}</span>
      </div>
      <div className={s.rounds}>
        <span className={s.seals} aria-hidden="true">
          {Array.from({ length: rounds }, (_, at) => (
            <span key={at} className={cx(s.seal, at > 0 && s.later)}>
              <ReviewSealGlyph facts={{ ...facts, passes: at + 1 }} size={34} />
            </span>
          ))}
        </span>
        <span className={s.then}>
          <Icon name="arrow" size={12} />
          <span className={cx(out === 'ask' && s.asks)}>{t.out[out]}</span>
        </span>
      </div>
    </figure>
  )
}
