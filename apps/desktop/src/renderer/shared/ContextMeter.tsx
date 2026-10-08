import type { SessionSummary } from '@althar/contracts'
import { ContextRing } from '@althar/ui'

import { modelInfo } from './agents'

/*
 * How full the context of the agent on a conversation is, for its composer:
 * the kit's ring, from what the agent last said of it while it runs. Nothing
 * where it hasn't said.
 */

/** Tokens, as the ring counts them: in thousands, to a tenth. */
const thousands = (tokens: number) => Math.round(tokens / 100) / 10

export function contextMeter(session: SessionSummary | null | undefined) {
  const context = session?.context
  if (session == null || context == null || context.size <= 0) return undefined
  return (
    <ContextRing
      used={thousands(context.used)}
      total={thousands(context.size)}
      model={modelInfo({ id: session.agentId, name: session.agentName }, session.model)}
    />
  )
}
