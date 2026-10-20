// Scrappy: A · a quiet chip in the window's bar. Nothing but a faint glyph while every account has more than half left; else the one limit closest to running out, its ink deeper the less is left. It opens (or ⌘U) a popover: every agent and account, tightest first, each window a slim bar, and the agents with nothing to read in one calm line.
import type { AccountUsage, PlanUsage } from '@althar/contracts'
import { BrandMark, Icon, Popover, usageTone } from '@althar/ui'

import { brandOf } from '../../../src/renderer/shared/agents'
import { usePlanUsage } from '../../../src/renderer/features/usage/useUsage'
import { agoWords, listed, readable, type Room, tightestOf, unreadOf, whenShort, whoOf } from '../usage'
import { Bar, Meters } from './Meter'
import s from './parts.module.css'

/** The one window closest to running out, of every account read. */
const lowestOf = (usage: PlanUsage | null): { readonly account: AccountUsage; readonly room: Room; readonly several: boolean } | null => {
  let low: { account: AccountUsage; room: Room } | null = null
  for (const account of usage?.accounts ?? []) {
    const room = tightestOf(account)
    if (room !== null && (low === null || room.left < low.room.left)) low = { account, room }
  }
  if (low === null) return null
  const agentId = low.account.agentId
  return { ...low, several: (usage?.accounts ?? []).filter((one) => one.agentId === agentId).length > 1 }
}

const faultWords: Readonly<Record<string, string>> = {
  sign_in_again: 'Sign in again to read its usage.',
  unreachable: 'Couldn’t read its usage just now.',
}

/** What the popover holds: agents tightest first, their accounts tightest first, and those with nothing to read last. */
export function UsagePeek({ usage }: { usage: PlanUsage | null }) {
  const now = new Date()
  const read = (usage?.accounts ?? []).filter(readable)
  const agents = [...new Set(read.map((account) => account.agentId))]
    .map((agentId) => {
      const accounts = read
        .filter((account) => account.agentId === agentId)
        .toSorted((a, b) => (tightestOf(a)?.left ?? 100) - (tightestOf(b)?.left ?? 100))
      return { agentId, name: accounts[0]!.agentName, accounts, low: tightestOf(accounts[0]!)?.left ?? 100 }
    })
    .toSorted((a, b) => a.low - b.low)
  const unread = unreadOf(usage)
  return (
    <div className={s.peek}>
      <div className={s.peekHead}>
        <h2 className={s.peekTitle}>Plan usage</h2>
      </div>
      {agents.map((agent) => {
        const brand = brandOf(agent.agentId)
        const several = agent.accounts.length > 1
        return (
          <section key={agent.agentId} className={s.agent} aria-label={agent.name}>
            <h3 className={s.agentName}>
              {brand !== undefined && <BrandMark brand={brand} size={14} />}
              {agent.name}
            </h3>
            {agent.accounts.map((account) => {
              // Numbers more than a quarter of an hour old say how old.
              const stale = account.observedAt !== null && now.getTime() - new Date(account.observedAt).getTime() > 15 * 60_000
              return (
                <div key={account.accountId} className={s.account}>
                  {(several || stale) && (
                    <div className={s.accountName}>
                      {several && <span>{account.accountName}</span>}
                      {stale && account.observedAt !== null && <span className={s.plan}>read {agoWords(account.observedAt, now)}</span>}
                    </div>
                  )}
                  {account.fault !== null && <p className={s.fault}>{faultWords[account.fault.kind] ?? account.fault.message}</p>}
                  <Meters account={account} />
                </div>
              )
            })}
          </section>
        )
      })}
      {unread.length > 0 && (
        <p className={s.calm}>
          {listed(unread)} {unread.length === 1 ? 'doesn’t report its usage' : 'don’t report their usage'}, so Althar can’t say how much
          {unread.length === 1 ? ' it has' : ' they have'} left.
        </p>
      )}
    </div>
  )
}

/** The chip, in place of the bar's Usage button, opened and closed by the bar's ⌘U too. */
export function BarChip({ expanded, onToggle }: { readonly expanded: boolean; readonly onToggle: () => void }) {
  const usage = usePlanUsage()
  const low = lowestOf(usage)
  const quiet = low === null || low.room.left > 50
  const tone = low === null ? 'plenty' : usageTone(low.room.left)
  const who = low === null ? '' : whoOf(low.account, low.several)
  const until = low?.room.resetsAt == null ? null : whenShort(low.room.resetsAt)
  const label = quiet
    ? 'Plan usage: every account has more than half left'
    : `Plan usage: ${who} has ${low!.room.left}% left${until === null ? '' : `, until ${until}`}`
  return (
    <Popover
      label="Plan usage"
      placement="below"
      align="end"
      width={360}
      padded={false}
      initialFocus="panel"
      open={expanded}
      onOpenChange={(open) => {
        if (open !== expanded) onToggle()
      }}
      trigger={
        quiet ? (
          <button type="button" className={s.glyph} aria-label={label}>
            <Icon name="load" size={13} />
          </button>
        ) : (
          <button type="button" className={s.chip} data-tone={tone} aria-label={label}>
            <span className={s.chipWho}>{who}</span>
            <span className={s.dot}>·</span>
            <Bar left={low!.room.left} />
            <span className={s.pct}>{low!.room.left === 0 ? 'out' : `${low!.room.left}%`}</span>
            {until !== null && (
              <>
                <span className={s.dot}>·</span>
                <span>until {until}</span>
              </>
            )}
          </button>
        )
      }
    >
      <UsagePeek usage={usage} />
    </Popover>
  )
}
