// Scrappy: the pieces every new direction draws plan usage with. Three levels, each only as loud as it needs: the one figure that counts (the agent closest to running out, by the account Althar would start it on), then a line per agent, then, opened in place, each account and every window.
import type { AccountUsage, PlanUsage } from '@althar/contracts'
import { BrandMark, Icon, usageTone } from '@althar/ui'
import { useState } from 'react'

import { brandOf } from '../../../src/renderer/shared/agents'
import {
  type AgentRoom,
  agentRooms,
  agoWords,
  limitWords,
  noReadings,
  pctWords,
  type Room,
  roomOf,
  SAY_UNDER,
  whenShort,
  windowLabel,
} from '../usage'
import s from './plan.module.css'

export const STEPS = 5

/** Five steps lit as the share used, as the load meter's are; full ink once it is nearly out. */
export function Gauge({ name, left, small }: { readonly name?: string; readonly left: number; readonly small?: boolean }) {
  const lit = Math.min(STEPS, Math.ceil(((100 - left) / 100) * STEPS - 0.001))
  return (
    <span className={[s.gauge, left <= SAY_UNDER && s.full, small && s.small].filter(Boolean).join(' ')}>
      {name !== undefined && <span className={s.short}>{name}</span>}
      <span className={s.steps} aria-hidden="true">
        {Array.from({ length: STEPS }, (_, i) => (
          <i key={i} data-lit={i < lit ? '' : undefined} />
        ))}
      </span>
    </span>
  )
}

/** The agent closest to running out: what the bar and a peek's head lead with. */
export const firstOf = (usage: PlanUsage | null): AgentRoom | null => agentRooms(usage)[0] ?? null

/** The peek's level, in a few words: plenty, or who is low. */
export const levelWords = (first: AgentRoom | null): string => {
  if (first === null) return 'Nothing read yet'
  const left = first.route.room.left
  if (left > 50) return 'Plenty left'
  if (left === 0) return `${first.name} is out`
  if (left <= SAY_UNDER) return `${first.name} is nearly out`
  return `${first.name} is running down`
}

/** What an agent's figure is of: "Five-hour limit · until 14:00", "Work · weekly limit · until Mon 09:00". */
const ofWords = (agent: AgentRoom) => {
  const { room, account, several } = agent.route
  const limit = limitWords(room)
  return [
    several ? account.accountName : null,
    limit.charAt(0).toUpperCase() + limit.slice(1),
    room.resetsAt === null ? null : `until ${whenShort(room.resetsAt)}`,
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

function Win({ room }: { readonly room: Room }) {
  return (
    <div className={s.win} data-tone={usageTone(room.left)}>
      <span>{windowLabel(room)}</span>
      <span className={s.agentBar} aria-hidden="true">
        <i style={{ width: `${Math.max(room.left, room.left > 0 ? 3 : 0)}%` }} />
      </span>
      <span className={s.winLeft}>{pctWords(room.left)}</span>
      <span className={s.winUntil}>{room.resetsAt === null ? '' : whenShort(room.resetsAt)}</span>
    </div>
  )
}

/** An agent opened: each account (named only where there are several), its age where old, and every window. */
function Detail({ agent }: { readonly agent: AgentRoom }) {
  const now = new Date()
  const several = agent.accounts.length > 1
  return (
    <div className={s.detail}>
      {agent.accounts.map((account: AccountUsage) => {
        const old = account.observedAt !== null && now.getTime() - new Date(account.observedAt).getTime() > 15 * 60_000
        return (
          <div key={account.accountId} className={s.account}>
            {(several || old) && (
              <span className={s.accountName}>
                {several && <span>{account.accountName}</span>}
                {old && account.observedAt !== null && <span className={s.age}>read {agoWords(account.observedAt, now)}</span>}
              </span>
            )}
            {account.windows.map((window) => (
              <Win key={`${window.kind}:${window.label ?? ''}`} room={roomOf(window)} />
            ))}
          </div>
        )
      })}
    </div>
  )
}

/** An agent's row: its name and figure, a bar, what the figure is of; a press opens its accounts in place. */
export function AgentRow({ agent }: { readonly agent: AgentRoom }) {
  const [open, setOpen] = useState(false)
  const brand = brandOf(agent.agentId)
  const { room } = agent.route
  return (
    <div>
      <button type="button" className={s.agent} data-tone={usageTone(room.left)} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={s.agentName}>
          <Icon name="chevron" size={9} className={s.chev} />
          {brand !== undefined && <BrandMark brand={brand} size={13} />}
          {agent.name}
        </span>
        <span className={s.agentLeft}>{room.left === 0 ? 'Out' : `${room.left}% left`}</span>
        <span className={s.agentBar} aria-hidden="true">
          <i style={{ width: `${Math.max(room.left, room.left > 0 ? 2 : 0)}%` }} />
        </span>
        <span className={s.agentOf}>{ofWords(agent)}</span>
      </button>
      {open && <Detail agent={agent} />}
    </div>
  )
}

/** A line per agent, for C: name, figure, until when; a press opens it in place too. */
export function AgentLine({ agent }: { readonly agent: AgentRoom }) {
  const [open, setOpen] = useState(false)
  const brand = brandOf(agent.agentId)
  const { room } = agent.route
  return (
    <div>
      <button type="button" className={s.line} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={s.agentName}>
          {brand !== undefined && <BrandMark brand={brand} size={13} />}
          {agent.name}
        </span>
        <span className={s.lineLeft}>{room.left === 0 ? 'out' : `${room.left}%`}</span>
        <span className={s.lineUntil}>{room.resetsAt === null ? '' : whenShort(room.resetsAt)}</span>
      </button>
      {open && <Detail agent={agent} />}
    </div>
  )
}

/** The agents with no reading, in one quiet line: each name says why on hover. */
export function NoReading({ usage }: { readonly usage: PlanUsage | null }) {
  const none = noReadings(usage)
  if (none.length === 0) return null
  return (
    <p className={s.none}>
      {none.map((one, at) => (
        <span key={one.name}>
          {at > 0 && (at === none.length - 1 ? ' and ' : ', ')}
          <abbr title={one.why}>{one.name}</abbr>
        </span>
      ))}{' '}
      {none.length === 1 ? 'doesn’t' : 'don’t'} share usage with other apps.
    </p>
  )
}

/** A: the gauge's own peek. Its head says the level; a row per agent, least room first; no reading at the foot. */
export function PeekByAgent({ usage }: { readonly usage: PlanUsage | null }) {
  const agents = agentRooms(usage)
  return (
    <div className={s.peek}>
      <span className={s.head}>
        <h2 className={s.heading}>Plan usage</h2>
        <span className={s.level}>{levelWords(agents[0] ?? null)}</span>
      </span>
      <div className={s.agents}>
        {agents.map((agent) => (
          <AgentRow key={agent.agentId} agent={agent} />
        ))}
      </div>
      <NoReading usage={usage} />
    </div>
  )
}

/** B: the plan's part of the load peek, under the machine, in its manner. */
export function PlanSection({ usage }: { readonly usage: PlanUsage | null }) {
  const agents = agentRooms(usage)
  return (
    <section className={s.section} aria-label="Plan usage">
      <span className={s.head}>
        <h3 className={s.eyebrow}>Plan</h3>
        <span className={s.level}>{levelWords(agents[0] ?? null)}</span>
      </span>
      <div className={s.agents}>
        {agents.map((agent) => (
          <AgentRow key={agent.agentId} agent={agent} />
        ))}
      </div>
      <NoReading usage={usage} />
    </section>
  )
}

/** C: the one limit closest to running out, big, and then the rest, a line each; the lead opens in place as they do. */
export function PeekTightest({ usage }: { readonly usage: PlanUsage | null }) {
  const [first, ...rest] = agentRooms(usage)
  const [open, setOpen] = useState(false)
  const brand = first === undefined ? undefined : brandOf(first.agentId)
  return (
    <div className={s.peek}>
      {first !== undefined && (
        <div>
          <button type="button" className={s.lead} aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className={s.leadFigure}>{pctWords(first.route.room.left)}</span>
            <span className={s.leadWords}>
              <span className={s.leadWho}>
                {brand !== undefined && <BrandMark brand={brand} size={13} />}
                {first.route.several ? `${first.name} ${first.route.account.accountName}` : first.name}
                <Icon name="chevron" size={9} className={s.chev} />
              </span>
              <span className={s.leadUntil}>{ofWords({ ...first, route: { ...first.route, several: false } })}</span>
            </span>
          </button>
          {open && <Detail agent={first} />}
        </div>
      )}
      {rest.length > 0 && (
        <div className={s.agents}>
          {rest.map((agent) => (
            <AgentLine key={agent.agentId} agent={agent} />
          ))}
        </div>
      )}
      <NoReading usage={usage} />
    </div>
  )
}
