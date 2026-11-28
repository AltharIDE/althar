import { useId, useState } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Problem } from '../../primitives/Problem/Problem'
import { firstRunning, type PlanAccount, type PlanAgent, type PlanWindow, SAY_UNDER, usageTone } from './plan'
import s from './PlanPeek.module.css'

/*
 * What the plan gauge opens to. Its head says how the plans stand, in a few
 * words; then a row per agent, least room first: its name, what is left, a
 * bar, and what that figure is of. A row opens in place to every account and
 * window: where there are several, each account a card of its own, one
 * signed out on the danger wash with its Sign in; a read that will try again
 * said quietly, with how old its figures are. Every bar is the row's own.
 * Ink only, deeper as a window runs down; no new colour.
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
  /** A window's figure: 62%, Out. */
  share: (percent: number) => string
  shareOut: string
  until: (at: string) => string
  /** Hover on the bar's tick: how far through its window now is. */
  through: (percent: number) => string
  /** The button beside an agent a sign-in stops. */
  signIn: string
  /** An account whose sign-in has gone, at the head of its card. */
  signedOut: string
  /** The button on that card. */
  accountSignIn: string
  /** An agent opened that nothing was read of. */
  nothingRead: string
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
  shareOut: 'Out',
  until: (at) => `until ${at}`,
  through: (n) => `${n}% of the way through`,
  signIn: 'Sign in again',
  signedOut: 'Signed out',
  accountSignIn: 'Sign in',
  nothingRead: 'No usage read yet.',
  list: (names) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`),
}

/** How the plans stand, by the agent with least room that work can start on. */
export const levelOf = (agents: readonly PlanAgent[], t: PlanPeekText = planPeekText): string => {
  const first = firstRunning(agents)
  if (first === undefined) {
    const unread = agents.find((agent) => agent.unread !== undefined)
    if (unread !== undefined) return t.level.unread(unread.name)
    // One connected can run, though its usage isn't read: nothing read yet, unless one is stopped.
    const stopped = agents.find((agent) => agent.stopped !== undefined)
    return stopped === undefined ? t.level.nothing : t.level.stopped(stopped.name)
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

/** Puts right a sign-in, the agent's or one account's. */
type SignIn = (agentId: string, accountId?: string) => void

/** A share as a bar's width, with a tick at the time left (100 less `elapsed`): where the fill ends if use keeps to the clock.  a sliver while any is left, so a little reads as some. Decoration: the figure beside it says it. */
function Bar({ left, elapsed, t, className }: { left: number; elapsed?: number; t: PlanPeekText; className?: string }) {
  return (
    <span className={cx(s.bar, className)} aria-hidden="true" title={elapsed === undefined ? undefined : t.through(Math.round(elapsed))}>
      <i style={{ width: `${left > 0 ? Math.max(left, 3) : 0}%` }} />
      {elapsed !== undefined && <b className={s.now} style={{ left: `${Math.min(100, Math.max(0, 100 - elapsed))}%` }} />}
    </span>
  )
}

/** A line that isn't a fault to act on (a read that tries again, why nothing is read), and how old the figures are under it. */
function Note({ icon, children, age }: { icon: IconName; children: string; age?: string | null }) {
  return (
    <p className={s.note}>
      <Icon name={icon} size={12} className={s.noteMark} />
      <span className={s.noteWords}>
        {children}
        {age !== null && age !== undefined && <span className={s.noteAge}>{age}</span>}
      </span>
    </p>
  )
}

function Window({ window, quiet, t }: { window: PlanWindow; quiet: boolean; t: PlanPeekText }) {
  if (window.unread === true)
    return (
      <li className={cx(s.window, s.windowUnread)}>
        <span className={s.windowLabel}>{window.label}</span>
        {/* Reset since it was read: when, and that it wasn't read since, with no figure that could read as an empty limit. */}
        <span className={s.windowUnknown} title={window.resetsTitle}>
          {[window.resets ?? window.until, window.note].filter((part) => part !== undefined && part !== null).join(', ')}
        </span>
      </li>
    )
  return (
    <li className={s.window} data-tone={usageTone(window.left)} data-quiet={quiet ? '' : undefined}>
      <span className={s.windowLabel}>{window.label}</span>
      <Bar left={window.left} t={t} {...(window.elapsed === undefined ? {} : { elapsed: window.elapsed })} />
      <span className={s.windowLeft}>{window.left === 0 ? t.shareOut : t.share(window.left)}</span>
      <span className={s.windowUntil} title={window.resetsTitle}>
        {window.resets ?? window.until ?? ''}
      </span>
    </li>
  )
}

function Windows({ account, t }: { account: PlanAccount; t: PlanPeekText }) {
  if (account.windows.length === 0) return null
  // The last good reading, which a failed read or a sign-in gone left: faded, whatever is left.
  const quiet = account.stale === true || account.signedOut === true
  return (
    <ul className={s.windows}>
      {account.windows.map((window) => (
        <Window key={window.id} window={window} quiet={quiet} t={t} />
      ))}
    </ul>
  )
}

/** How an account stands, apart from its figures. */
const standing = (agent: PlanAgent, account: PlanAccount) => {
  // Signed out where the agent can still run: said on the account. Where none can, the row's Sign in again says it.
  const signedOut = account.signedOut === true && agent.stopped === undefined
  // Any other fault, whatever rows it has (those reset since included): a read that tries again, a sign-in the agent
  // renews, why nothing reads it. Quiet, as none is the person's to put right.
  const note = account.signedOut === true ? null : account.fault
  return { signedOut, note }
}

/** A read that failed and tries again by itself, over figures it left; else why there are none, or none fresh. */
const noteIcon = (account: PlanAccount): IconName => (account.stale === true ? 'reload' : 'info')

/** An account, where it is the agent's only one: its windows, under what is wrong. */
function Only({ agent, account, t, onSignIn }: { agent: PlanAgent; account: PlanAccount; t: PlanPeekText; onSignIn: SignIn | undefined }) {
  const { signedOut, note } = standing(agent, account)
  return (
    <>
      {signedOut && (
        <Problem
          banner
          size="small"
          {...(onSignIn === undefined
            ? {}
            : {
                action: (
                  <ActionButton tone="strong" size="small" onClick={() => onSignIn(agent.id, account.id)}>
                    {t.accountSignIn}
                  </ActionButton>
                ),
              })}
        >
          {t.signedOut}
        </Problem>
      )}
      {note !== null && (
        <Note icon={noteIcon(account)} age={account.age}>
          {note}
        </Note>
      )}
      <Windows account={account} t={t} />
      {note === null && account.age !== null && account.windows.length > 0 && <span className={s.age}>{account.age}</span>}
    </>
  )
}

/** An account, where the agent has several: a card with its name and how it stands on top. */
function Card({ agent, account, t, onSignIn }: { agent: PlanAgent; account: PlanAccount; t: PlanPeekText; onSignIn: SignIn | undefined }) {
  const { signedOut, note } = standing(agent, account)
  const name = <span className={s.cardName}>{account.name}</span>
  return (
    <div className={s.card} data-problem={signedOut ? '' : undefined} role="group" aria-label={account.name ?? undefined}>
      {signedOut ? (
        <Problem
          as="div"
          size="small"
          className={s.cardProblem}
          {...(onSignIn === undefined
            ? {}
            : {
                action: (
                  <ActionButton tone="strong" size="small" flush="end" onClick={() => onSignIn(agent.id, account.id)}>
                    {t.accountSignIn}
                  </ActionButton>
                ),
              })}
        >
          {name} {t.signedOut}
        </Problem>
      ) : (
        <div className={s.cardHead}>
          {name}
          {note === null && account.age !== null && <span className={s.age}>{account.age}</span>}
        </div>
      )}
      {note !== null && (
        <Note icon={noteIcon(account)} age={account.age}>
          {note}
        </Note>
      )}
      <Windows account={account} t={t} />
      {signedOut && account.age !== null && <span className={s.age}>{account.age}</span>}
    </div>
  )
}

function Detail({ agent, t, onSignIn }: { agent: PlanAgent; t: PlanPeekText; onSignIn: SignIn | undefined }) {
  const [only] = agent.accounts
  const several = agent.accounts.length > 1
  // Nothing read of it: every account without windows, and nothing said of why but a sign-in the row puts right.
  const nothing = agent.accounts.every((account) => account.windows.length === 0 && (account.fault === null || agent.stopped !== undefined))
  return (
    <>
      {/* What every account shares, said once; a sign-in that stops the agent is the row's own button. */}
      {agent.fault !== undefined && agent.stopped === undefined && <Note icon="reload">{agent.fault}</Note>}
      {nothing && <Note icon="info">{t.nothingRead}</Note>}
      {!nothing &&
        (several
          ? agent.accounts.map((account) => <Card key={account.id} agent={agent} account={account} t={t} onSignIn={onSignIn} />)
          : only !== undefined && <Only agent={agent} account={only} t={t} onSignIn={onSignIn} />)}
    </>
  )
}

function AgentRow({ agent, t, onSignIn }: { agent: PlanAgent; t: PlanPeekText; onSignIn: SignIn | undefined }) {
  const [open, setOpen] = useState(false)
  const detail = useId()
  // A sign-in that stops it is the button beside it, which says so: nothing in place of the figure then.
  const signIn = agent.signIn === true && onSignIn !== undefined
  const instead = agent.stopped ?? agent.unread ?? agent.connected
  return (
    <li className={signIn ? s.withAction : undefined}>
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
            <Bar left={agent.left} t={t} className={s.agentBar} {...(agent.elapsed === undefined ? {} : { elapsed: agent.elapsed })} />
            {/* Opened, the accounts and windows say what the figure is of. */}
            {!open && <span className={s.agentOf}>{ofWords(agent, t)}</span>}
          </>
        ) : signIn ? null : (
          // Its saved numbers or their age are in the detail, each account saying why it runs nothing or wasn't read again.
          <span className={s.agentLeft}>{instead}</span>
        )}
      </button>
      {signIn && (
        <ActionButton tone="strong" size="small" flush="end" className={s.action} onClick={() => onSignIn(agent.id)}>
          {t.signIn}
        </ActionButton>
      )}
      <div id={detail} className={s.detail} hidden={!open}>
        {open && <Detail agent={agent} t={t} onSignIn={onSignIn} />}
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
    /** Puts right a sign-in: the one that stops an agent (`signIn`), by its id, or one account's, by the agent's and the account's. */
    onSignIn?: SignIn
    text?: Partial<PlanPeekText>
  }
>

export function PlanPeek({ agents, headingLevel = 2, onSignIn, text, className, ...rest }: PlanPeekProps) {
  const t = { ...planPeekText, ...text }
  return (
    <div className={cx(s.peek, className)} {...rest}>
      <Heading level={headingLevel} className={s.heading}>
        {t.heading}
      </Heading>
      {agents.length > 0 && (
        <ul className={s.agents}>
          {agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} t={t} onSignIn={onSignIn} />
          ))}
        </ul>
      )}
    </div>
  )
}
