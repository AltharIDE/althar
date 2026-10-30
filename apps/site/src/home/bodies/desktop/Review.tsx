import { TwoLabReview } from '../kit/app'
import { Shot } from '../kit/Shot'
import s from './Review.module.css'

/*
 * The work reviewing itself: every change reviewed by models from other
 * labs, fixed by its lead, and reviewed again until it is clean, before a
 * pull request reaches you. Large, on the section's own dark. Until its
 * drawing is made, the app's own review of task 432.
 */
export function Review() {
  return (
    <div className={s.wrap}>
      <Shot
        w={740}
        maxScale={1.15}
        label="A review by Sonnet 5 and Gemini 3 Pro: three findings, two fixed by the lead, one waiting for your call"
        frame={s.card}
      >
        <div className={s.pad}>
          <TwoLabReview />
        </div>
      </Shot>
    </div>
  )
}
