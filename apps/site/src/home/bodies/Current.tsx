import { AGENTS } from '../../content/agents'
import { COORDINATOR, LOOP, PLANS } from '../../content/home'
import { AgentMark } from '../../shared/AgentMark'
import { cx } from '../../lib/cx'
import { Coordinator } from '../Coordinator'
import s from '../Home.module.css'
import { TaskLoop } from '../TaskLoop'
import { Why } from '../Why'

/*
 * Prototype: the body as it is on main, for comparison. The developer page. One app for the coding agents you already pay for: the
 * first screen opens in Althar's light, as the app does (Hero). Then: what it
 * signs in with, why more than one agent (in cobalt, with a ticker from the
 * shifts list), the coordinator that hands out the work, one task's review
 * loop, and how to get it.
 */

function Part({ no, label }: { no: string; label: string }) {
  return (
    <p className={s.no}>
      <b>{no}</b>
      {label}
    </p>
  )
}

export function Current() {
  return (
    <main id="main" tabIndex={-1}>
      <section id="agents" className={s.section} aria-labelledby="agents-h">
        <div className={s.two}>
          <div>
            <Part no={PLANS.no} label={PLANS.label} />
            <h2 id="agents-h" className={cx(s.h2, s.lit)}>
              <span>{PLANS.title[0]}</span>
              <span>{PLANS.title[1]}</span>
            </h2>
            <p className={s.lead}>{PLANS.lead}</p>
          </div>
          <div className={s.list}>
            <table className={s.agents}>
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Signed in with</th>
                  <th scope="col">How Althar runs it</th>
                </tr>
              </thead>
              <tbody>
                {AGENTS.map((a) => (
                  <tr key={a.id}>
                    <th scope="row">
                      <span className={s.agent}>
                        <AgentMark agent={a.id} size={30} />
                        {a.name}
                      </span>
                    </th>
                    <td className={s.signIn}>{a.signIn}</td>
                    <td className={s.runs}>
                      <code>{a.runs.code}</code>
                      <span className={s.whose}>{a.runs.whose === 'bundled' ? 'bundled' : 'your install'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={s.note}>{PLANS.note}</p>
          </div>
        </div>
      </section>

      <Why />

      <section id="coordinator" className={s.section} aria-labelledby="coordinator-h">
        <div className={s.two}>
          <div>
            <Part no={COORDINATOR.no} label={COORDINATOR.label} />
            <h2 id="coordinator-h" className={s.h2}>
              <span>{COORDINATOR.title[0]}</span>
              <span>{COORDINATOR.title[1]}</span>
            </h2>
            <p className={s.lead}>{COORDINATOR.lead}</p>
            <ol className={s.points}>
              {COORDINATOR.points.map((p, i) => (
                <li key={p.title}>
                  <span className={s.pn}>{String(i + 1).padStart(2, '0')}</span>
                  <p>
                    <b>{p.title}</b>
                    <span>{p.body}</span>
                  </p>
                </li>
              ))}
            </ol>
          </div>
          <Coordinator />
        </div>
      </section>

      <section id="loop" className={`${s.section} ${s.band}`} aria-labelledby="loop-h">
        <div className={s.wrap}>
          <div className={s.loopHead}>
            <div>
              <Part no={LOOP.no} label={LOOP.label} />
              <h2 id="loop-h" className={s.h2}>
                <span>{LOOP.title[0]}</span>
                <span>{LOOP.title[1]}</span>
              </h2>
            </div>
            <p className={s.lead}>{LOOP.lead}</p>
          </div>
          <TaskLoop />
        </div>
      </section>
    </main>
  )
}
