/*
 * Why an agent couldn't start, or couldn't be reached, in the few classes a
 * person can act on (DEV-196): it isn't installed, it isn't signed in, its
 * sign-in ended, or the network is in the way. Read from what the agent or
 * the system said: a spawn's error, what the agent wrote before it stopped,
 * or a request it refused. Anything else is no class here, and its own first
 * error line says it. The texts are what the agents said, as the tests'
 * fixtures record them (tests/startFailure.test.ts).
 */

export type StartFailure = 'not_installed' | 'signed_out' | 'sign_in_ended' | 'unreachable'

/** A command that isn't there: Node's spawn error, a shell's, or Windows' own. */
const notInstalled =
  /\bspawn \S+ ENOENT\b|\bENOENT\b.{0,40}\bspawn\b|command not found|is not recognized as an internal or external command/i

/**
 * A sign-in that was there and no longer serves: a token past its end that
 * couldn't be renewed, or the agent asking for a sign-in "again". Said before
 * a plain sign-in is looked for, as each also reads as one.
 */
const ended =
  /\b(?:o?auth |access |refresh |id )?token (?:has |is )?(?:expired|been revoked|could not be refreshed|was already used)|(?:sign[- ]?in|log[- ]?in|session|credentials?) (?:has |have )?(?:expired|ended)|could not be refreshed|refresh token|(?:log|sign) ?in again|re-?authenticate/i

/** No sign-in at all, in the words agents say it. */
const signedOut =
  /auth(?:entication)? required|not (?:logged|signed) in|please (?:log|sign) ?in|(?:log|sign) ?in to continue|please run \/login|unauthori[sz]ed|\b401\b|invalid api key|no api key|not authenticated|missing (?:api key|credentials)/i

/**
 * The network in the way: a name that can't be looked up, nothing answering, or the agent waiting for a connection. A connection
 * that dropped mid-way isn't: the agent reached its servers, and its own words say what happened.
 */
const unreachable =
  /\bENOTFOUND\b|\bEAI_AGAIN\b|\bECONNREFUSED\b|\bETIMEDOUT\b|\bENETUNREACH\b|\bEHOSTUNREACH\b|getaddrinfo|can'?t reach|cannot connect|unable to connect|could not connect|failed to connect|error sending request|dns error|waiting for network|network (?:is )?unreachable|connection refused/i

/**
 * Which of the classes `said` is, or undefined where it is none of them.
 * `authRequired` says a request the agent refused for its sign-in, as the
 * failure table classed it: signed out unless the words say it ended.
 */
export const startFailureOf = (said: string, authRequired = false): StartFailure | undefined => {
  if (notInstalled.test(said)) return 'not_installed'
  if (ended.test(said)) return 'sign_in_ended'
  if (authRequired || signedOut.test(said)) return 'signed_out'
  if (unreachable.test(said)) return 'unreachable'
  return undefined
}

/** What looks like an error, among an agent's lines. */
const errorish = /\b(?:error|fatal|failed|failure|cannot|can'?t|couldn'?t|unable|refused|denied|invalid|not found|exception|panic)\b/i

/** Terminal colours and the like, which mean nothing in a line of the window. */
// oxlint-disable-next-line no-control-regex
const escapes = /\u001b\[[0-9;]*[A-Za-z]/g

/**
 * The agent's own first error line, from what it wrote: the first that reads
 * as an error, past a stack trace's frames; else its last line, which
 * usually says why; empty where it wrote nothing.
 */
export const firstErrorLine = (output: string): string => {
  const lines = output
    .replace(escapes, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^at\s/.test(line))
  const first = lines.find((line) => errorish.test(line) && line.replace(/^(?:\w*error|fatal|panic)\s*:?\s*/i, '') !== '')
  return first ?? lines.at(-1) ?? ''
}
