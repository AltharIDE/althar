import { cx } from '../../../lib/cx'
import s from '../Research.module.css'

export function Opening() {
  return (
    <>
      <div className={s.open}>
        <p className={s.kicker}>Research note · September 2026</p>
        <h1>The missing project layer.</h1>
        <p className={s.dek}>
          Why software engineering with AI agents needs an open, provider-independent home for project memory and coordination, and how
          Althar proposes to build it.
        </p>
      </div>
      <section className={cx(s.s, s.abstract)}>
        <p className={s.sN}>Abstract</p>
        <div className={s.prose}>
          <p className={s.lead}>
            Coding agents have crossed a threshold. They implement substantial changes, operate tools, run tests and respond to review. The
            operating model around them still looks like a collection of chat windows.
          </p>
          <p>
            Project context is fragmented, continuity belongs to individual products, and developers spend their attention carrying
            information between specialist agents. Althar proposes an open, provider-independent project layer. It holds durable intent and
            evidence, while a coordinator composes execution graphs around replaceable workers. The purpose is not to remove developer
            judgment. It is to stop spending that judgment on clerical coordination.
          </p>
        </div>
      </section>
    </>
  )
}
