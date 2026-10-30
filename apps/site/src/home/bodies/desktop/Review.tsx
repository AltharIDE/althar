import { Fragment } from './Fragment'
import s from './Review.module.css'
import review from './styled/d-review.html?raw'

/*
 * The work reviewing itself: the lead's change goes round to a reviewer
 * from another lab, two findings come back, the lead fixes them, round 2
 * comes back clean, and only then does the pull request reach you. Drawn as
 * an interface lit by one light, large, on the section's own dark.
 */
export function Review() {
  return (
    <div className={s.wrap}>
      <Fragment source={review} tone="dark" className={s.stage} />
    </div>
  )
}
