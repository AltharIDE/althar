import { Button, CopyButton, NeedLine } from '@althar/ui'
import { Home } from '@althar/ui/screens'
import type { ReactNode } from 'react'

import { AGENTS } from '../../../content/agents'
import { INSTALL } from '../../../content/facts'
import { HERO } from '../../../content/home'
import { cx } from '../../../lib/cx'
import { AgentMark } from '../../../shared/AgentMark'
import { Get, OtherMac } from '../../../shared/Close'
import { LightUnder } from '../../../shared/lightUnder'
import { Tabs } from '../../bodies/kit/app'
import app from '../../bodies/kit/app.module.css'
import { Shot } from '../../bodies/kit/Shot'
import { DECISION, PROJECT_LIST, PUBLISH, READY, RUNNING, SINCE } from '../../bodies/kit/world'
import { addDisplay } from '../../display'
import bankUrl from './cloud/bank.webp'
import seaUrl from './cloud/sea.webp'
import s from './Cloud.module.css'

/*
 * Prototype, a new first screen: Cloud, the window in the clouds. High above
 * the weather, still: a painted cobalt sky over a cream cloud sea, the
 * headline calm in the upper part with the download under it, and the app
 * itself, its home in a Mac window, resting in the cloud sea, the nearer
 * bank swallowing its foot. The cloud's foot is the paper the page goes on
 * in. Nothing on it moves.
 */

addDisplay()

const none = () => {}

/** What waits on you at home, as the bento's picture of it has it. */
const NEEDS = [
  {
    key: 'publish',
    project: PUBLISH.project,
    line: (
      <NeedLine
        kind={PUBLISH.kind}
        project={PUBLISH.project}
        task={PUBLISH.task}
        title={PUBLISH.title}
        command={PUBLISH.command}
        actions={
          <>
            <Button size="small">Deny</Button>
            <Button size="small" variant="signal">
              Allow once
            </Button>
          </>
        }
      />
    ),
  },
  {
    key: 'accept',
    project: READY.project,
    line: (
      <NeedLine
        kind={READY.kind}
        project={READY.project}
        task={READY.task}
        title={READY.title}
        brief={`${READY.change.repo} #${READY.change.number} · checks passed · +${READY.change.add} −${READY.change.del}`}
        actions={<Button size="small">Review</Button>}
      />
    ),
  },
  {
    key: 'decision',
    project: DECISION.project,
    line: (
      <NeedLine
        kind={DECISION.kind}
        project={DECISION.project}
        task={DECISION.task}
        title={DECISION.title}
        brief={DECISION.options.map((option) => option.label).join(' or ')}
        actions={<Button size="small">Decide</Button>}
      />
    ),
  },
]

/** Every agent Althar runs, as its mark, named on hover and to a screen reader. */
function Agents() {
  return (
    <ul className={s.agents} aria-label={HERO.agentsName}>
      {AGENTS.map((agent) => (
        <li key={agent.id} title={agent.name}>
          <AgentMark agent={agent.id} size={16} />
          <span className={s.sr}>{agent.name}</span>
        </li>
      ))}
    </ul>
  )
}

/** The app's home in its window, still: the tabs with the system's lights, and what needs you. */
function Window() {
  return (
    <Shot
      w={1040}
      h={620}
      phoneW={820}
      maxScale={1.2}
      label="Althar’s home: three things that need you, across Halyard and Tally, and every project beside them"
      frame={s.frame}
    >
      <div className={app.window}>
        <Tabs current={null} />
        <div className={s.home}>
          <Home
            waiting={3}
            needs={NEEDS}
            running={RUNNING}
            since={SINCE}
            looked="3 h ago"
            projects={PROJECT_LIST}
            onOpenEvent={none}
            onOpenProject={none}
            onTalk={none}
            onNewProject={none}
          />
        </div>
      </div>
    </Shot>
  )
}

/** The first screen above the cloud sea, the app resting in it. */
export function CloudHero({ nav }: { nav?: ReactNode }) {
  return (
    <div className={s.hero}>
      {/* Cobalt under the nav: it turns to smoked glass over the sky. */}
      <LightUnder tone="ink" className={s.under} />
      <img className={s.sky} src={seaUrl} alt="" aria-hidden="true" decoding="async" />
      <div className={s.stage}>
        <h1 className={s.h1}>
          {HERO.title} <em>{HERO.last}</em>
        </h1>
        <p className={s.lead}>{HERO.lead}</p>
        <div className={s.get}>
          <Get tone="blue" />
          <div className={s.quiet}>
            <OtherMac tone="blue" />
            <i className={s.rule} aria-hidden="true" />
            <div className={s.command}>
              <code>
                <span aria-hidden="true">$ </span>
                {INSTALL.brew}
              </code>
              <span className="ch-root">
                <CopyButton value={INSTALL.brew} tone="onDark" ghost />
              </span>
            </div>
          </div>
        </div>
        <div className={s.window}>
          <Window />
          <div className={s.clouds} aria-hidden="true">
            <div className={s.mist} />
            <div className={s.body} />
            <img className={cx(s.bank, s.behind)} src={bankUrl} alt="" decoding="async" />
            <img className={s.bank} src={bankUrl} alt="" decoding="async" />
            <div className={s.bed} />
          </div>
        </div>
      </div>
      <div className={s.foot} aria-hidden="true" />
      <Agents />
      {nav}
    </div>
  )
}
