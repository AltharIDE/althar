import { AgentExited, AgentRequestFailed, AgentStartFailed, closingFailureOf, startFailureOf } from '@althar/provider-adapters'
import { Cause, Option } from 'effect'

/**
 * Whether a start that failed may pass if it is made again, afresh: its
 * adapter or its agent stopped on the way, it crashed, or it failed for a
 * reason that is no class the person can act on. Not where it is signed out,
 * isn't installed, is out of usage, refused what it was asked, or timed out
 * (it waited long enough already), nor where the network is in the way, which
 * a second start meets as well.
 */
export const startsAgain = (cause: Cause.Cause<unknown>): boolean => {
  const found = Cause.findErrorOption(cause)
  if (Option.isNone(found)) return false
  const error = found.value
  if (error instanceof AgentExited) {
    const why = closingFailureOf(error.stderr)
    return why === undefined || why === 'crashed'
  }
  if (error instanceof AgentRequestFailed) {
    if (error.failure !== 'unknown' && error.failure !== 'transient') return false
    const why = startFailureOf(error.message)
    return why === undefined || why === 'crashed'
  }
  if (error instanceof AgentStartFailed) {
    const why = startFailureOf(error.reason)
    return (why === undefined || why === 'crashed') && !/\bENOENT\b/.test(error.reason)
  }
  return false
}
