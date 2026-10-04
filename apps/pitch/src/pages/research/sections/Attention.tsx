import { cx } from '../../../lib/cx'
import s from '../Research.module.css'

export function Attention() {
  return (
    <>
      <section className={s.s} id="s6">
        <p className={s.sN}>6 · The attention boundary</p>
        <h2>Human attention is the scarcest resource in the system.</h2>
        <div className={s.prose}>
          <p>
            The expensive part of an interruption isn’t the minute it takes to answer. It’s the loss of focus: noticing a run has stopped,
            reloading its context, deciding, briefing the next agent, then finding your place in your own work again. Althar draws a hard
            line around what’s allowed to spend that attention.
          </p>
        </div>
        <figure className={s.ex}>
          <figcaption className={s.exH}>
            <b>Figure 7</b> What stays inside the system, and what reaches a person
          </figcaption>
          <div className={s.bound}>
            <div className={s.boundCol}>
              <p className={s.boundK}>Handled inside the system</p>
              <ul>
                <li>A failing test with a clear cause</li>
                <li>A review finding with an obvious fix</li>
                <li>A flaky run, a timeout, a retry</li>
                <li>Choosing which agent or model runs a node</li>
                <li>Checking a change against recorded claims</li>
                <li>Repair, re-review and re-audit loops</li>
              </ul>
            </div>
            <div className={cx(s.boundCol, s.isYou)}>
              <p className={s.boundK}>Brought to a person</p>
              <ul>
                <li>Product intent the record doesn’t settle</li>
                <li>An irreversible action</li>
                <li>A trade-off between two recorded decisions</li>
                <li>A security exception</li>
                <li>Agents still disagreeing after a second round</li>
                <li>Two claims the project can’t both believe</li>
              </ul>
            </div>
          </div>
          <p className={s.exCap}>
            In the product, the second column is the only thing that uses colour. Work progressing on its own stays monochrome.
          </p>
        </figure>
      </section>
    </>
  )
}
