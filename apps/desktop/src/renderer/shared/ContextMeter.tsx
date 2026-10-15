import type { SessionSummary } from '@althar/contracts'
import { ContextRing } from '@althar/ui'
import { useEffect, useState } from 'react'

import type { NameModel } from './modelNames'

/*
 * How full the context of the agent on a conversation is, for its composer:
 * the kit's ring, from what the agent last said of it while it runs. Nothing
 * where it hasn't said. Its detail, as you point at it, holds Compact, which
 * has the agent sum up what it holds; it says it is compacting until the
 * agent says how full it is again.
 */

/** Tokens, as the ring counts them: in thousands, to a tenth. */
const thousands = (tokens: number) => Math.round(tokens / 100) / 10

/** How long Compact stays off, at most, for an agent that never says how full it is after. */
const COMPACTING_AT_MOST = 120_000

export function contextMeter(session: SessionSummary | null | undefined, named: NameModel, onCompact?: () => Promise<void>) {
  const context = session?.context
  if (session == null || context == null || context.size <= 0) return undefined
  return <ContextMeter session={session} named={named} onCompact={onCompact} />
}

function ContextMeter({
  session,
  named,
  onCompact,
}: {
  readonly session: SessionSummary
  readonly named: NameModel
  readonly onCompact: (() => Promise<void>) | undefined
}) {
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
    />
  )
}
