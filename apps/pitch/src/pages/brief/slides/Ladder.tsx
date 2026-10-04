import { cx } from '../../../lib/cx'
import { vars } from '../../../lib/vars'
import { Slide } from '../Slide'
import ui from '../ui.module.css'
import s from './Ladder.module.css'

export function Ladder() {
  return (
    <Slide tone="light" name="Orchestration" className={s.ladder}>
      <div className={ui.wrap}>
        <p className={cx(ui.kicker, s.kicker)}>What orchestration actually means</p>
        <h2>Launching a sub-agent is delegation. Orchestration is deciding what happens next.</h2>
        <ol className={s.stairs}>
          <li style={vars({ '--h': 112 })}>
            <div className={s.tread}>
              <svg viewBox="0 0 200 90" aria-hidden="true">
                <rect className={s.gb} x="14" y="31" width="58" height="28" rx="4" />
                <rect className={s.gb} x="128" y="31" width="58" height="28" rx="4" />
                <path className={s.gl} d="M72 40 H124 M118 35 L124 40 L118 45" />
                <path className={s.gd} d="M128 52 H76" />
              </svg>
            </div>{' '}
            <b>Delegation</b>
            <p>One agent starts another and waits for text back.</p>
            <span className={s.rW}>Most agent tools</span>
          </li>
          <li style={vars({ '--h': 160 })}>
            <div className={s.tread}>
              <svg viewBox="0 0 200 90" aria-hidden="true">
                <circle className={s.gi} cx="36" cy="45" r="13" />
                <rect className={s.gb} x="118" y="6" width="64" height="20" rx="4" />
                <rect className={s.gb} x="118" y="35" width="64" height="20" rx="4" />
                <rect className={s.gb} x="118" y="64" width="64" height="20" rx="4" />
                <path className={s.gd} d="M49 42 L118 16 M49 45 H118 M49 48 L118 74" />
              </svg>
            </div>{' '}
            <b>Parallel agents</b>
            <p>Many sessions at once. You carry the context between them.</p>
            <span className={s.rW}>Most agent tools</span>
          </li>
          <li style={vars({ '--h': 208 })}>
            <div className={s.tread}>
              <svg viewBox="0 0 200 90" aria-hidden="true">
                <rect className={s.gb} x="4" y="33" width="36" height="24" rx="4" />
                <rect className={s.gb} x="56" y="33" width="36" height="24" rx="4" />
                <rect className={s.gb} x="108" y="33" width="36" height="24" rx="4" />
                <rect className={s.gb} x="160" y="33" width="36" height="24" rx="4" />
                <path className={s.gl} d="M40 45 H56 M92 45 H108 M144 45 H160" />
              </svg>
            </div>{' '}
            <b>Fixed pipeline</b>
            <p>The same steps every time, whether they’re needed or not.</p>
            <span className={s.rW}>Workflow features, CI</span>
          </li>
          <li className={s.us} style={vars({ '--h': 300 })}>
            <div className={s.tread}>
              <svg viewBox="0 0 360 170" aria-hidden="true">
                <rect className={s.gm} x="0" y="144" width="360" height="22" rx="4" />
                <text className={s.gt} x="12" y="159">
                  project memory
                </text>
                <path className={s.gad} d="M26 144 V48 M334 44 V144" />
                <rect className={s.gb} x="0" y="18" width="52" height="26" rx="5" />
                <rect className={s.gb} x="76" y="18" width="52" height="26" rx="5" />
                <rect className={s.gb} x="152" y="18" width="52" height="26" rx="5" />
                <rect className={s.gb} x="308" y="18" width="52" height="26" rx="5" />
                <path className={s.gl} d="M52 31 H76 M128 31 H152 M204 31 H308" />
                <rect className={s.ga} x="152" y="72" width="52" height="26" rx="5" />
                <path className={s.gad} d="M178 44 V72" />
                <path className={s.gh} d="M204 85 H252 M263 74 V31" />
                <circle className={s.gy} cx="263" cy="85" r="11" />
              </svg>
            </div>{' '}
            <b>Supervision from evidence</b>
            <p>
              Each result decides the next step: a finding adds a repair, a sensitive file adds an audit. You’re asked only when it matters.
            </p>
            <span className={s.rW}>Althar</span>
          </li>
        </ol>
        <p className={s.cap}>
          The vendors sell steps 1 to 3. Step 4 only works as one thing: the graph, the routing, the person and the memory.
        </p>
      </div>
    </Slide>
  )
}
