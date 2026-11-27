import { redact } from './diagnostics'
import { ToolRefused } from './toolErrors'
import { sentence, words } from './words'

/*
 * What an agent hears when one of Althar's tools fails: the runtime's own words for it, never only the kind of error
 * ("ApiError"), so it can act on the reason or tell the person, rather than read it out of the log.
 */

/** What words() says of an error it has no words for. */
const NO_WORDS = "Althar's runtime couldn't do that"

/** An error's own message, where it carries one: a tagged error's, or an Error's. */
const ownMessage = (error: unknown): string | undefined => {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message.trim() : ''
  return message === '' ? undefined : redact(message)
}

/**
 * Why it failed, in a sentence for the agent: the window's words for it, else its own message, else that the log has it.
 * `failed` says what didn't happen, where the tool says it its own way ("Althar could not run the setup").
 */
export const refusalWords = (error: unknown, failed = 'Althar could not do that'): string => {
  if (error instanceof ToolRefused) return error.message
  const said = words(error, (agentId) => agentId)
  if (said.reason !== 'Unknown' && !said.message.startsWith(NO_WORDS)) return said.message
  const own = ownMessage(error)
  return own === undefined
    ? `${failed}, and what it did is in its log. Try again, or tell the person.`
    : `${failed}: ${sentence(own)} Try again, or tell the person.`
}

/** A tool's failure as the refusal its agent reads. */
export const toolRefusalOf = (error: unknown, failed?: string): ToolRefused =>
  error instanceof ToolRefused ? error : new ToolRefused({ message: refusalWords(error, failed) })
