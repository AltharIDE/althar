import { cx } from '../../../lib/cx'
import { HAND, MERGED, TASK, type HandStep } from '../model/data'
import { clock, handTotals, pad2 } from '../model/lib'
import { labOf, Mark } from '../Mark'
import { Pin } from '../Slide'
import ui from '../ui.module.css'
import s from './Morning.module.css'

/** Step 0 is the empty checklist, then one step per row, then the sum. */
const STEPS = HAND.length + 2

/** The clock at panel step `k`: when you last noticed an agent. */
export function handClock(k: number): string {
  if (k > HAND.length) return `${clock(0)}–${clock(MERGED)}`
  const seen = HAND.slice(0, k).findLast((e) => e.seen !== undefined)?.seen
  return clock(seen ?? 0)
}

function Outcome({ e }: { e: HandStep }) {
  if (e.fate === 'forgot') return <span className={cx(s.chip, s.never)}>Never ran</span>
  return (
    <>
      <span className={s.chip}>
        {clock(e.done ?? 0)} · <em>waited {(e.seen ?? 0) - (e.done ?? 0)} min</em>
      </span>
      {e.lost && <span className={cx(s.chip, s.lost)}>{e.lost}</span>}
    </>
  )
}

/** The seven steps a fix should get, at panel step `k`: done, lost on the way, or never run. */
export function Checklist({ k }: { k: number }) {
  return (
    <ol className={s.rows}>
      {HAND.map((e, j) => {
        const state = j < k - 1 || k > HAND.length ? 'past' : j === k - 1 ? 'now' : 'next'
        return (
          <li key={e.k} className={cx(s.row, s[state], state !== 'next' && s[e.fate])}>
            <span className={s.no}>{pad2(j + 1)}</span>
            <div className={s.what}>
              <b>{e.k}</b>
              <span className={s.who}>
                {e.a ? (
                  <>
                    <Mark lab={labOf(e.a)} /> {e.a}
                  </>
                ) : (
                  'Nobody'
                )}
              </span>
              {state !== 'next' && <span className={s.you}>{e.you}</span>}
            </div>
            <div className={s.out}>{state === 'next' ? <span className={s.dash}>—</span> : <Outcome e={e} />}</div>
          </li>
        )
      })}
    </ol>
  )
}

export function Morning() {
  return (
    <Pin id="bus" tone="light" name="The messenger" className={s.p2} steps={STEPS}>
      {(k) => {
        const sum = handTotals(Math.min(k, HAND.length))
        const done = k > HAND.length
        return (
          <div className={cx(ui.wrap, s.grid)}>
            <div>
              <p className={cx(ui.kicker, s.kicker)}>The problem · Attention</p>
              <h2>The developer is the messenger.</h2>
              <p className={cx(ui.body, s.body)}>
                You know the steps a fix should go through. Run them by hand and every hand-off waits for you to notice, and every step
                depends on you remembering it.
              </p>
              <dl className={s.nums}>
                <div>
                  <dt>minutes the agents sat waiting for you</dt>
                  <dd>{sum.waiting}</dd>
                </div>
                <div>
                  <dt>results you carried from one agent to the next</dt>
                  <dd>{sum.relays}</dd>
                </div>
                <div className={cx(sum.skipped > 0 && s.bad)}>
                  <dt>steps that never ran</dt>
                  <dd>
                    {sum.skipped}
                    <small>/ {HAND.length}</small>
                  </dd>
                </div>
              </dl>
            </div>
            <figure className={cx(s.card, done && s.done)} aria-label={`Task ${TASK.id}, run by hand one morning`}>
              <figcaption className={s.cardH}>
                <span>
                  <b>Task {TASK.id}</b> {TASK.title}
                </span>
                <span className={s.clock}>{handClock(k)}</span>
              </figcaption>
              <Checklist k={k} />
              <div className={s.sum}>
                <p>
                  <b>Merged at {clock(MERGED)}.</b> Two steps never ran and one finding was lost in a paste, so the bug ships at one call
                  site, and so does an unaudited change to token rotation.
                </p>
                <p className={s.then}>
                  With Althar <span>→</span> all seven steps, every time, and one question for you
                </p>
              </div>
            </figure>
          </div>
        )
      }}
    </Pin>
  )
}
