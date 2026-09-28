import { Wordmark } from '../../../components/Wordmark'
import { cx } from '../../../lib/cx'
import { researchHref } from '../../../paths'
import { Slide } from '../Slide'
import ui from '../ui.module.css'
import s from './Closer.module.css'

export function Closer() {
  return (
    <Slide id="close" tone="dark" name="Close" className={s.closer}>
      <div className={cx(ui.wrap, s.wrap)}>
        <p className={s.q}>
          <span>The project persists.</span> <span>The coordinator understands.</span> <span>Agents come and go.</span>
        </p>
        <a href={researchHref} className={s.next}>
          <span>Research note</span>The missing project layer: the full argument, in depth<i aria-hidden="true">→</i>
        </a>
        <p className={s.foot}>
          <span>Charrette · open source</span>
        </p>
      </div>
      <Wordmark />
    </Slide>
  )
}
