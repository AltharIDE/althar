import { CopyButton } from '@althar/ui'

import { AGENTS } from '../../content/agents'
import { INSTALL } from '../../content/facts'
import { HERO } from '../../content/home'
import h from '../../home/Hero.module.css'
import { cx } from '../../lib/cx'
import { AgentMark } from '../../shared/AgentMark'
import { Get, OtherMac } from '../../shared/Close'
import { Footer } from '../../shared/footer/Footer'
import { LightUnder } from '../../shared/lightUnder'
import { CHAPTERS } from '../chapters'
import s from './NightSide.module.css'

/*
 * PROTOTYPE. C: Night side. After the first screen the page stays in orbit,
 * in the warm dark the shifts, the changelog and the docs open on, so the
 * home and the other pages are one place. Each picture stands on the
 * planet's edge, lit cobalt under it, and the next claim comes up out of
 * the planet's night beyond: pass after pass, one ground, no panels. The
 * headlines take the night pages' voice (one weight, the words that matter
 * white). It ends on the first screen's own console, on the brightest edge,
 * and lands on the footer.
 */

export function NightSide() {
  return (
    <main id="main" tabIndex={-1} className={s.night}>
      <div className={s.sky}>
        <LightUnder tone="ink" className={s.under} />
        {CHAPTERS.map((c, i) => (
          <section key={c.id} id={c.id} className={cx(s.pass, s[c.id])} aria-labelledby={`${c.id}-h`}>
            <div className={s.head}>
              <p className={s.over}>
                <span className={s.lit}>{String(i + 1).padStart(2, '0')}</span>
                {c.name}
              </p>
              <h2 id={`${c.id}-h`} className={s.headline}>
                {c.title}
              </h2>
              <p className={s.why}>{c.lead}</p>
            </div>
            <div className={s.picture}>
              <c.Picture />
            </div>
            <div className={s.limb} aria-hidden="true" />
          </section>
        ))}
        <section className={cx(s.pass, s.last)} aria-label="Download Althar">
          <div className={s.head}>
            <h2 className={s.headline}>
              Bring the agents <b>you already pay for.</b>
            </h2>
          </div>
          <div className={cx(h.console, s.console)}>
            <div className={h.cell}>
              <span className={h.label}>{HERO.agents}</span>
              <ul className={h.agents} aria-label={HERO.agentsName}>
                {AGENTS.map((agent) => (
                  <li key={agent.id} title={agent.name}>
                    <AgentMark agent={agent.id} size={17} />
                    <span className={h.sr}>{agent.name}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={cx(h.cell, h.install)}>
              <span className={h.label}>{HERO.install}</span>
              <div className={h.command}>
                <code>
                  <span aria-hidden="true">$ </span>
                  {INSTALL.brew}
                </code>
                <span className="ch-root">
                  <CopyButton value={INSTALL.brew} tone="onDark" ghost />
                </span>
              </div>
            </div>
            <div className={cx(h.cell, h.ways)}>
              <Get tone="blue" />
              <OtherMac tone="blue" />
            </div>
          </div>
          <div className={s.limb} aria-hidden="true" />
        </section>
      </div>
      <Footer />
    </main>
  )
}
