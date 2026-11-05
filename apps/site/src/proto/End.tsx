import { CopyButton } from '@althar/ui'
import type { ReactNode } from 'react'

import { AGENTS } from '../content/agents'
import { INSTALL } from '../content/facts'
import { HERO } from '../content/home'
import h from '../home/Hero.module.css'
import t from '../home/bodies/kit/type.module.css'
import { cx } from '../lib/cx'
import { AgentMark } from '../shared/AgentMark'
import { Get, OtherMac } from '../shared/Close'
import { LightUnder } from '../shared/lightUnder'
import { CHAPTERS } from './chapters'
import s from './End.module.css'

/*
 * PROTOTYPE. What the takes end on: the first screen's own console (the
 * agents, the install, the download), and the arrival over the planet's lit
 * edge that leads to it, with what keeps you in flow on the night side.
 */

/** The first screen's console, as it ends the page. */
export function Console({ className }: { className?: string }) {
  return (
    <div className={cx(h.console, s.console, className)}>
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
  )
}

/** The planet's edge, lit, the night side under it. */
export function Limb({ bright, className }: { bright?: boolean; className?: string }) {
  return <div className={cx(s.limb, bright && s.bright, className)} aria-hidden="true" />
}

const FLOW = CHAPTERS.find((c) => c.id === 'flow')!

/** Arriving over the planet: its edge coming up, what keeps you in flow on its night side, then the console on the brightest edge. `flow` leaves the bento out when the take has shown it. */
export function Arrival({ flow = true, children }: { flow?: boolean; children?: ReactNode }) {
  return (
    <section className={s.arrival} aria-label={flow ? undefined : 'Download Althar'} aria-labelledby={flow ? 'flow-h' : undefined}>
      <LightUnder tone="ink" className={s.under} />
      <Limb />
      {children}
      {flow && (
        <div className={s.flow}>
          <div className={s.head}>
            <h2 id="flow-h" className={cx(t.title, s.title)}>
              {FLOW.title}
            </h2>
            <p className={cx(t.lead, s.lead)}>{FLOW.lead}</p>
          </div>
          <FLOW.Picture />
        </div>
      )}
      <div className={s.last}>
        <h2 className={s.headline}>
          Bring the agents <b>you already pay for.</b>
        </h2>
        <Console />
        <Limb bright className={s.lastLimb} />
      </div>
    </section>
  )
}
