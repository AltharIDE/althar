import { useId, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { firstRunning, type PlanAccount, type PlanAgent, type PlanWindow, SAY_UNDER, usageTone } from './plan'
import s from './PlanPeek.module.css'

/*
 * What the plan gauge opens to. Its head says how the plans stand, in a few
 * words; then a row per agent, least room first: its name, what is left, a
 * bar, and what that figure is of. A row opens in place to every account and
 * window. Ink only, deeper as a window runs down; no new colour.
 */

export interface PlanPeekText {
  heading: string
  level: {
    nothing: string
    plenty: string
    down: (agent: string) => string
    nearly: (agent: string) => string
    out: (agent: string) => string
    /** Every agent read is stopped: no work can start on any. */
    stopped: (agent: string) => string
    /** No agent has a figure, and one can run: its windows have reset since they were read. */
    unread: (agent: string) => string
  }
  /** An agent's figure: 62% left, Out. */
  left: (percent: number) => string
  out: string
  /** A window's figure: 62%, out. */
  share: (percent: number) => string
  shareOut: string
  until: (at: string) => string
  /** The agents with no reading, by name. */
  /** "Copilot, Junie and Vibe". */
  list: (names: readonly string[]) => string
}

export const planPeekText: PlanPeekText = {
  heading: 'Plan usage',
  level: {
    nothing: 'Nothing read yet',
    plenty: 'Plenty left',
    down: (agent) => `${agent} is running down`,
    nearly: (agent) => `${agent} is nearly out`,
    out: (agent) => `${agent} is out`,
    stopped: (agent) => `${agent} can’t start work`,
    unread: (agent) => `${agent} not read since reset`,
  },
  left: (n) => `${n}% left`,
  out: 'Out',
  share: (n) => `${n}%`,
  shareOut: 'out',
  until: (at) => `until ${at}`,
  list: (names) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`),
}

/** How the plans stand, by the agent with least room that work can start on. */
export const levelOf = (agents: readonly PlanAgent[], t: PlanPeekText = planPeekText): string => {
  const first = firstRunning(agents)
  if (first === undefined) {
    const unread = agents.find((agent) => agent.unread !== undefined)
    if (unread !== undefined) return t.level.unread(unread.name)
    return agents[0] === undefined ? t.level.nothing : t.level.stopped(agents[0].name)
  }
  if (first.left > 50) return t.level.plenty
  if (first.left === 0) return t.level.out(first.name)
  if (first.left <= SAY_UNDER) return t.level.nearly(first.name)
  return t.level.down(first.name)
}

const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1)

/** What an agent's figure is of: Five-hour limit · until 14:00; Side · Weekly limit · until Tue 20:00. */
const ofWords = (agent: PlanAgent, t: PlanPeekText) =>
  [agent.account, capital(agent.limit), agent.until === null ? null : t.until(agent.until)].filter((part) => part !== null).join(' · ')

/** A share as a bar's width: a sliver while any is left, so a little reads as some. Decoration: the figure beside it says it. */
function Bar({ left, className }: { left: number; className?: string }) {
  return (
    <span className={cx(s.bar, className)} aria-hidden="true">
      <i style={{ width: `${left > 0 ? Math.max(left, 3) : 0}%` }} />
    </span>
  )
}

function Window({ window, t }: { window: PlanWindow; t: PlanPeekText }) {
  return (
    <li className={s.window} data-tone={usageTone(window.left)}>
      <span>{window.label}</span>
      <Bar left={window.left} className={s.windowBar} />
      <span className={s.windowLeft}>{window.left === 0 ? t.shareOut : t.share(window.left)}</span>
      <span className={s.windowUntil}>{window.until ?? ''}</span>
    </li>
  )
}

function Account({ account, t }: { account: PlanAccount; t: PlanPeekText }) {
  return (
    <div className={s.account}>
      {(account.name !== null || account.age !== null) && (
        <span className={s.accountName}>
          {account.name !== null && <span>{account.name}</span>}
          {account.age !== null && <span className={s.age}>{account.age}</span>}
        </span>
      )}
      {account.fault !== null && <span className={s.fault}>{account.fault}</span>}
      {account.windows.length > 0 && (
        <ul className={s.windows}>
          {account.windows.map((window) => (
            <Window key={window.id} window={window} t={t} />
          ))}
        </ul>
      )}
    </div>
  )
}

function AgentRow({ agent, t }: { agent: PlanAgent; t: PlanPeekText }) {
  const [open, setOpen] = useState(false)
  const detail = useId()
  const instead = agent.stopped ?? agent.unread
  return (
    <li>
      <button
        type="button"
        className={s.agent}
        data-tone={instead === undefined ? usageTone(agent.left) : undefined}
        aria-expanded={open}
        aria-controls={detail}
        onClick={() => setOpen(!open)}
      >
        <span className={s.agentName}>
          <Icon name="chevron" size={9} className={s.chev} />
          {agent.brand !== undefined && <BrandMark brand={agent.brand} size={13} />}
          {agent.name}
        </span>
        {instead === undefined ? (
          <>
            <span className={s.agentLeft}>{agent.left === 0 ? t.out : t.left(agent.left)}</span>
            <Bar left={agent.left} className={s.agentBar} />
            <span className={s.agentOf}>{ofWords(agent, t)}</span>
          </>
        ) : (
          // Its saved numbers or their age are in the detail, each account saying why it runs nothing or wasn't read again.
          <span className={s.agentLeft}>{instead}</span>
        )}
      </button>
      <div id={detail} className={s.detail} hidden={!open}>
        {open && agent.accounts.map((account) => <Account key={account.id} account={account} t={t} />)}
      </div>
    </li>
  )
}

export type PlanPeekProps = RootProps<
  'div',
  {
    /** Least room first. */
    agents: readonly PlanAgent[]
    headingLevel?: HeadingLevel
    text?: Partial<PlanPeekText>
  }
>

export function PlanPeek({ agents, headingLevel = 2, text, className, ...rest }: PlanPeekProps) {
  const t = { ...planPeekText, ...text }
  return (
    <div className={cx(s.peek, className)} {...rest}>
      <span className={s.head}>
        <Heading level={headingLevel} className={s.heading}>
          {t.heading}
        </Heading>
        <span className={s.level}>{levelOf(agents, t)}</span>
      </span>
      {agents.length > 0 && (
        <ul className={s.agents}>
          {agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} t={t} />
          ))}
        </ul>
      )}
    </div>
  )
}
