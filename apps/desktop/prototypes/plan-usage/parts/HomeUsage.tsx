// Scrappy: C · usage where the person looks first and where accounts live. On the home, a quiet section: a line per agent, each of its accounts by its tightest window. In Settings › Agents, under each account, every window, where the numbers came from and how old they are, and a fault in words.
import type { AccountUsage } from '@althar/contracts'
import { BrandMark, LinkButton, usageTone } from '@althar/ui'
import { useNavigate } from '@tanstack/react-router'

import { brandOf } from '../../../src/renderer/shared/agents'
import { sourceWords, usePlanUsage } from '../../../src/renderer/features/usage/useUsage'
import { listed, readable, tightestOf, unreadOf, whenShort, windowPhrase } from '../usage'
import { Meters } from './Meter'
import s from './parts.module.css'

/** An account's tightest window, as the home's line says it: "Week 56% left", "5 hours 3% left, until 14:00", "out until Mon 09:00". */
const partOf = (account: AccountUsage, several: boolean) => {
  const room = tightestOf(account)
  if (room === null) return null
  const name = several ? `${account.accountName}: ` : ''
  const until = room.resetsAt === null || room.left > 50 ? '' : `, until ${whenShort(room.resetsAt)}`
  const words =
    room.left === 0
      ? `${name}out${room.resetsAt === null ? '' : ` until ${whenShort(room.resetsAt)}`}`
      : `${name}${room.left}% of ${windowPhrase(room)} left${until}`
  return { words, tone: usageTone(room.left), left: room.left }
}

export function HomeUsage() {
  const usage = usePlanUsage()
  const navigate = useNavigate()
  if (usage === null) return null
  const read = usage.accounts.filter(readable)
  const agents = [...new Set(read.map((account) => account.agentId))]
  const unread = unreadOf(usage)
  return (
    <section className={s.home} aria-labelledby="home-usage">
      <div className={s.homeHead}>
        <h2 className={s.eyebrow} id="home-usage">
          Plan usage
        </h2>
        <LinkButton onClick={() => void navigate({ to: '/settings/$section', params: { section: 'agents' } })}>Accounts</LinkButton>
      </div>
      <ul className={s.lines}>
        {agents.map((agentId) => {
          const accounts = read.filter((account) => account.agentId === agentId)
          const parts = accounts.flatMap((account) => {
            const part = partOf(account, accounts.length > 1)
            return part === null ? [] : [{ id: account.accountId, ...part }]
          })
          const brand = brandOf(agentId)
          return (
            <li key={agentId} className={s.line}>
              {brand === undefined ? <span /> : <BrandMark brand={brand} size={13} />}
              <span className={s.lineName}>{accounts[0]!.agentName}</span>
              <span className={s.parts}>
                {parts
                  .toSorted((a, b) => a.left - b.left)
                  .map((part) => (
                    <span key={part.id} className={s.part} data-tone={part.tone}>
                      {part.words}
                    </span>
                  ))}
              </span>
            </li>
          )
        })}
      </ul>
      {unread.length > 0 && (
        <p className={s.calm}>
          {listed(unread)} {unread.length === 1 ? 'doesn’t report its usage.' : 'don’t report their usage.'}
        </p>
      )}
    </section>
  )
}

const calmFault: Readonly<Record<string, (agent: string) => string>> = {
  no_source: (agent) => `${agent} doesn’t report its usage, so Althar can’t say how much this account has left.`,
  sign_in_again: (agent) => `${agent} no longer accepts this account’s sign-in, so its usage can’t be read. Sign in again.`,
}

/** Under an account in Settings › Agents: every window, where the numbers came from and how old, or why there are none. */
export function AccountReading({ account }: { readonly account: AccountUsage }) {
  const source = sourceWords(account, new Date())
  return (
    <div className={s.accountUsage}>
      {account.noReading != null && <p className={s.fault}>{account.noReading}</p>}
      {account.fault !== null && <p className={s.fault}>{calmFault[account.fault.kind]?.(account.agentName) ?? account.fault.message}</p>}
      {account.windows.length > 0 && <Meters account={account} />}
      {source !== null && account.windows.length > 0 && <p className={s.source}>{source}</p>}
    </div>
  )
}
