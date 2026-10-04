import { Slide } from '../Slide'
import ui from '../ui.module.css'
import s from './Abstract.module.css'

export function Abstract() {
  return (
    <Slide tone="dark" name="In one line" className={s.abstract}>
      <div className={ui.wrap}>
        <p>
          Every major AI coding company is building a project layer, and each one ties it to the agent it sells.{' '}
          <strong>Althar keeps project knowledge open and independent,</strong> and uses it to run work across whichever agents are best
          this month.
        </p>
      </div>
    </Slide>
  )
}
