import { Fragment } from './Fragment'
import s from './Review.module.css'
import review from './styled/review.html?raw'

/*
 * The work reviewing itself, as a before and after. Today you carry each
 * agent's answer to the other by hand, Copy and Paste, round after round;
 * with Althar one task fills in its own steps, the lead and a reviewer from
 * another lab taking turns down its rail, and only the pull request
 * reaches you.
 */

export function Review() {
  return (
    <div className={s.wrap}>
      <Fragment source={review} tone="dark" className={s.stage} />
    </div>
  )
}
