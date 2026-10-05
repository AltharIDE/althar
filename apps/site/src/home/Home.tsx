import { AGENTS } from '../content/agents'
import { COORDINATOR, HERO, LOOP, PLANS } from '../content/home'
import { AgentMark } from '../shared/AgentMark'
import { Bar } from '../shared/Bar'
import { Close, Get } from '../shared/Close'
import { Coordinator } from './Coordinator'
import s from './Home.module.css'
import { Meters } from './Meters'
import { NameSwap } from './NameSwap'
import { TaskLoop } from './TaskLoop'
import { Why } from './Why'

/*
 * The developer page. One app for the coding agents you already pay for: the
 * first screen shows your plans running side by side and a task moving on when
 * one runs out. Then: what it signs in with, why more than one agent (in
 * cobalt, with a ticker from the shifts list), the coordinator that hands out
 * the work, one task's review loop, and how to get it.
 */

function Part({ no, label }: { no: string; label: string }) {
  return (
    <p className={s.no}>
      <b>{no}</b>
      {label}
    </p>
  )
}

export function Home() {
  return (
    <div className={s.page} id="top">
      <div className={s.top}>
        <Bar tone="blue" />
      </div>
      <main id="main" tabIndex={-1}>
        <div className={s.top}>
          <header className={s.hero}>
            <p className={s.kicker}>
              <i aria-hidden="true" />
              {HERO.kicker}
            </p>
            <h1 className={s.h1}>
              <span className={s.dim}>{HERO.pay}</span>
              <NameSwap names={HERO.names} nameClass={s.name} />
              <span>{HERO.use}</span>
            </h1>
            <div className={s.below}>
              <div>
                <p className={s.heroLead}>{HERO.lead}</p>
                <div className={s.ctas}>
                  <Get tone="blue" />
                </div>
                <p className={s.fine}>{HERO.fine}</p>
              </div>
              <Meters />
            </div>
          </header>
        </div>

        <section id="agents" className={s.section} aria-labelledby="agents-h">
          <div className={s.two}>
            <div>
              <Part no={PLANS.no} label={PLANS.label} />
              <h2 id="agents-h" className={s.h2}>
                <span>{PLANS.title[0]}</span>
                <span>{PLANS.title[1]}</span>
              </h2>
              <p className={s.lead}>{PLANS.lead}</p>
            </div>
            <div>
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
                          <AgentMark agent={a.id} size={26} />
                          {a.name}
                        </span>
                      </th>
                      <td>{a.signIn}</td>
                      <td>
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

      <Close />
    </div>
  )
}
