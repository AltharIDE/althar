import type { AccountUse, SessionSummary } from '@althar/contracts'
import { ContextRing, UsageLines } from '@althar/ui'
import { useEffect, useState } from 'react'

import { type NameModel, type NameProvider, useProviderNames } from './modelNames'
import { usageLines } from './usage'

/*
 * How full the context of the agent on a conversation is, for its composer:
 * the kit's ring, from what the agent last said of it while it runs. Nothing
 * where it hasn't said. Its detail, as you point at it, holds Compact, which
 * has the agent sum up what it holds; it says it is compacting until the
 * agent says how full it is again. Under the context, what the task, or
 * the coordinator's day, used of each account (ADR-084).
 */

/** Tokens, as the ring counts them: in thousands, to a tenth. */
const thousands = (tokens: number) => Math.round(tokens / 100) / 10

/** The ring's usage, where the conversation used any account. */
const usageOf = (usage: MeterUsage | undefined, named: NameModel, nameProvider: NameProvider) => {
  const lines = usageLines(usage?.usage, named, nameProvider)
  return usage === undefined || lines.length === 0 ? {} : { usage: <UsageLines lines={lines} heading={usage.heading} /> }
}

/** How long Compact stays off, at most, for an agent that never says how full it is after. */
const COMPACTING_AT_MOST = 120_000

/** What the conversation's usage says, and whose it is, as the ring's panel heads it. */
export interface MeterUsage {
  readonly usage: ReadonlyArray<AccountUse> | undefined
  readonly heading: string
}

export function contextMeter(
  session: SessionSummary | null | undefined,
  named: NameModel,
  onCompact?: () => Promise<void>,
  usage?: MeterUsage,
) {
  const context = session?.context
  if (session == null || context == null || context.size <= 0) return undefined
  return <ContextMeter session={session} named={named} onCompact={onCompact} usage={usage} />
}

function ContextMeter({
  session,
  named,
  onCompact,
  usage,
}: {
  readonly session: SessionSummary
  readonly named: NameModel
  readonly onCompact: (() => Promise<void>) | undefined
  readonly usage: MeterUsage | undefined
}) {
  const nameProvider = useProviderNames()
  const used = session.context?.used ?? 0
  const size = session.context?.size ?? 0
  // How full it was when the person asked: compacting until the agent says otherwise, or for two minutes at most.
  const [asked, setAsked] = useState<number | null>(null)
  useEffect(() => {
    if (asked === null) return
    const gone = setTimeout(() => setAsked(null), COMPACTING_AT_MOST)
    return () => clearTimeout(gone)
  }, [asked])
  const compact =
    onCompact === undefined
      ? {}
      : {
          onCompact: () => {
            setAsked(used)
            onCompact().catch(() => setAsked(null))
          },
          compacting: asked === used,
        }
  return (
    <ContextRing
      used={thousands(used)}
      total={thousands(size)}
      model={named(session.agentId, session.model, session.account)}
      {...compact}
      {...usageOf(usage, named, nameProvider)}
    />
  )
}
