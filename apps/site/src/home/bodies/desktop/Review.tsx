import { Fragment } from './Fragment'
import s from './Review.module.css'
import review from './styled/d-review.html?raw'

/*
 * The work reviewing itself: the lead types its change, a reviewer from
 * another lab (GLM-5.3, an open model) flags two lines, the lead rewrites
 * both, round 2 comes back clean, and only then does the pull request reach
 * you. Drawn as an interface lit by one light, large, on the section's own
 * dark.
 */
export function Review() {
  return (
    <div className={s.wrap}>
      <Fragment source={review} tone="dark" className={s.stage} />
    </div>
  )
}
