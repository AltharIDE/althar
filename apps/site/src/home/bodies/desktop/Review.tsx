import { Fragment } from './Fragment'
import s from './Review.module.css'
import review from './styled/d-review.html?raw'

/*
 * The work reviewing itself: task 432's change goes to two other labs,
 * their findings land on a list, the lead fixes two and sets one aside with
 * its reason, round 2 comes back clean, and only then does the pull request
 * reach you. Drawn as an interface lit by one light, large, on the
 * section's own dark.
 */
export function Review() {
  return (
    <div className={s.wrap}>
      <Fragment source={review} tone="dark" className={s.stage} />
    </div>
  )
}
