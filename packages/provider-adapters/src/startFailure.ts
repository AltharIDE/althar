/*
 * Why an agent couldn't start, or couldn't be reached, in the few classes a
 * person can act on (DEV-196): it isn't installed, it isn't signed in, its
 * sign-in ended, the network is in the way, its program and what drives it
 * are different versions, a part of it is missing, or it crashed on the way.
 * Read from what the agent or
 * the system said: a spawn's error, what the agent wrote before it stopped,
 * or a request it refused. Anything else is no class here, and its own first
 * error line says it. The texts are what the agents said, as the tests'
 * fixtures record them (tests/startFailure.test.ts).
 */

export type StartFailure = 'not_installed' | 'signed_out' | 'sign_in_ended' | 'unreachable' | 'version_mismatch' | 'incomplete' | 'crashed'

/** A command that isn't there: Node's spawn error, a shell's, or Windows' own. */
const notInstalled =
  /\bspawn \S+ ENOENT\b|\bENOENT\b.{0,40}\bspawn\b|command not found|is not recognized as an internal or external command/i

/**
 * A sign-in that was there and no longer serves: Claude Code's login past
 * its end or its time limit, or its token revoked; Codex's refresh token
 * expired, used or revoked; OpenCode's Console or SSO to sign in to again.
 * Said before a plain sign-in is looked for, as each also reads as one. A
 * bare "sign in again" isn't one: Claude Code says it with no sign-in at all.
 */
const ended =
  /\b(?:o?auth |access |refresh )?token (?:has |is |was |been )*(?:expired|revoked|already used)|\b(?:login|sign[- ]?in|session) (?:has )?(?:expired|ended)|reached its time limit|could not be refreshed|\bsign in with [\w ]{1,20} again\b|\breconnect [\w ]{1,40} to continue|re-?authenticate/i

/**
 * No sign-in at all, in the words agents say it. A 401 only as a status an
 * agent's request got (`API Error: 401`, `status 401 Unauthorized`), never a
 * bare number or "unauthorized" alone, which a tool or a server it runs says
 * of its own sign-in as often.
 */
const signedOut =
  /auth(?:entication)? required|not (?:logged|signed) in|please (?:log|sign) ?in|(?:log|sign) ?in to continue|please run \/login|\b(?:status|error|code|http\/[\d.]+)\W{0,3}401\b|invalid api key|no api key|not authenticated|missing (?:api key|credentials)/i

/**
 * A program refusing what it was started with, as a version older or newer
 * than what drives it does: an option, a command or an argument it doesn't
 * know, in the words of each agent's own command-line parser, and the agents'
 * own words for it. Commander (Claude Code, Copilot): `error: unknown option
 * '--initialize-fields=settings'`, as Claude Code 2.1.326 said it to Agent
 * SDK 0.3.330 on 24 November 2026; clap (Codex, Grok Build): `error:
 * unexpected argument '--acp' found`, `unrecognized subcommand`; yargs
 * (Gemini CLI, Qwen Code): `Unknown argument: acp`; OpenCode 2.3.0's `Unrecognized
 * flag: --acp in command opencode`; Click and
 * Typer (Kimi Code): `No such option: --acp`, `No such command 'acp'`;
 * argparse (Mistral Vibe): `unrecognized arguments`; cobra: `unknown flag`;
 * picocli (Junie): `Unknown option: '--acp'`. And Claude Code's "too old to
 * read MCP servers from the initialize request", an ACP protocol version an
 * agent doesn't speak, "requires a newer version", and Althar's own check
 * before it starts one (`bundledProblem`).
 */
const mismatch =
  /\bunknown (?:option|flag|command|subcommand|argument)s?\b|\bunexpected argument\b|\bunrecognized (?:subcommand|argument|option|flag)s?\b|\bno such (?:option|command)\b|\bunmatched argument\b|\btoo old to\b|\brequires? (?:a )?newer (?:version|release)\b|\bversion mismatch\b|\bunsupported (?:acp |protocol )+version\b|\bprotocol version\b.{0,40}\bnot supported\b|\bincompatible (?:version|protocol)\b|\bown program is version \S+, and its adapter needs\b/i

/** An agent saying it is too old for what drives it. */
const tooOld = /\b(?:is|are) too old to\b/i

/**
 * A program that comes with an agent's adapter, missing: Claude Code's Agent
 * SDK and its adapter (`Native CLI binary for darwin-arm64 not found`,
 * `Claude native binary not found`, `The Claude CLI is missing`), Codex's
 * launcher (`Missing optional dependency @openai/codex-darwin-arm64`), and
 * Althar's own check before it starts one (`bundledProblem`).
 */
const incomplete =
  /\bnative (?:cli )?binary (?:for \S+ )?not found\b|\bnative binary not found\b|\bthe claude cli is missing\b|\bmissing optional dependency\b|without --omit=optional|\bown program for this computer\b.{0,80}\bis missing\b/i

/**
 * An adapter whose agent stopped under it while it started: Claude Code's
 * SDK (`Claude Code process exited with code 1`, `Query closed before
 * response received`), claude-agent-acp's "The Claude Agent process exited
 * unexpectedly", and a signal or a crash, said by any.
 */
const crashed =
  /\bprocess exited (?:unexpectedly|with code -?\d+)|\bexited unexpectedly\b|\bterminated by signal\b|\bkilled by signal\b|\bSIG(?:KILL|SEGV|ABRT|BUS|ILL)\b|\bsegmentation fault\b|\bquery closed before response received\b|\bpanicked at\b/i

/** A spawn the adapter made of its agent's command, the one "isn't installed" an agent that started can still say. */
const spawnMissing = /\bspawn \S+ ENOENT\b|\bENOENT\b.{0,40}\bspawn\b/i

/**
 * A line about something the agent runs rather than the agent: an MCP
 * server, a hook, a plugin. Its sign-in, its command or its network is its
 * own, never the agent's class, whatever its words.
 */
const aside = /\bmcp\b|\bhooks?\b|\bplugins?\b/i

/**
 * The network in the way: a name that can't be looked up, nothing answering, or the agent waiting for a connection. A connection
 * that dropped mid-way isn't: the agent reached its servers, and its own words say what happened.
 */
const unreachable =
  /\bENOTFOUND\b|\bEAI_AGAIN\b|\bECONNREFUSED\b|\bETIMEDOUT\b|\bENETUNREACH\b|\bEHOSTUNREACH\b|getaddrinfo|(?:can'?t|could not|cannot|unable to) reach|cannot connect|unable to connect|could not connect|failed to connect|error sending request|dns error|waiting for network|network (?:is )?unreachable|no internet route|connection refused/i

/**
 * Which of the classes `said` is, or undefined where it is none of them.
 * `authRequired` says a request the agent refused for its sign-in, as the
 * failure table classed it: signed out unless the words say it ended.
 * `started` says the agent's process ran and wrote `said` before it stopped:
 * then only the adapter's own spawn of the agent's command, not a shell's
 * "command not found", says it isn't installed, as that is a hook's or a
 * tool's. Lines about an MCP server, a hook or a plugin name no class.
 */
export const startFailureOf = (said: string, authRequired = false, started = false): StartFailure | undefined => {
  // The agent saying it is too old is about itself, whatever it is too old for ("to read MCP servers from the initialize request").
  if (tooOld.test(said)) return 'version_mismatch'
  if (!authRequired && aside.test(said)) return undefined
  if (incomplete.test(said)) return 'incomplete'
  if (started ? spawnMissing.test(said) : notInstalled.test(said)) return 'not_installed'
  if (ended.test(said)) return 'sign_in_ended'
  if (authRequired || signedOut.test(said)) return 'signed_out'
  // After the sign-in: a program that stopped for its sign-in says so as it stops, and it is the sign-in to put right.
  if (mismatch.test(said)) return 'version_mismatch'
  if (unreachable.test(said)) return 'unreachable'
  if (crashed.test(said)) return 'crashed'
  return undefined
}

/** What looks like an error, among an agent's lines. */
const errorish = /\b(?:error|fatal|failed|failure|cannot|can'?t|couldn'?t|unable|refused|denied|invalid|not found|exception|panic)\b/i

/** Terminal colours and the like, which mean nothing in a line of the window. */
// oxlint-disable-next-line no-control-regex
const escapes = /\u001b\[[0-9;]*[A-Za-z]/g

/** A line of what an agent wrote, and whether it details the one before: indented under it, `line N:`, or after one ending in `:`. */
interface Line {
  readonly text: string
  readonly detail: boolean
}

/** An agent's lines, past terminal colours, blank lines and a stack trace's frames. */
const linesOf = (output: string): ReadonlyArray<Line> => {
  const kept = output
    .replace(escapes, '')
    .split('\n')
    .filter((line) => line.trim() !== '' && !/^\s*at\s/.test(line))
  return kept.map((line, at) => ({
    text: line.trim(),
    detail: at > 0 && (/^\s/.test(line) || /^line \d+\b/i.test(line.trim()) || kept[at - 1]!.trim().endsWith(':')),
  }))
}

/** Whether a line reads as an error, and says more than that it is one. */
const reads = (line: Line) => errorish.test(line.text) && line.text.replace(/^(?:\w*error|fatal|panic)\s*:?\s*/i, '') !== ''

/**
 * The line at `at`, with the one under it that says what to put right, where
 * there is one: `Error: invalid config: line 4: unknown key "modle"`.
 */
const withDetail = (lines: ReadonlyArray<Line>, at: number): string => {
  const line = lines[at]!.text
  const next = lines[at + 1]
  if (next === undefined || !next.detail) return line
  return line.endsWith(':') ? `${line} ${next.text}` : `${line}: ${next.text}`
}

/**
 * The agent's own first error line, from what it wrote: the first that reads
 * as an error, past a stack trace's frames, with the line under it that
 * details it; else its last line, which usually says why; empty where it
 * wrote nothing. For one answer it gave, such as a refused request.
 */
export const firstErrorLine = (output: string): string => {
  const lines = linesOf(output)
  const at = lines.findIndex((line) => !line.detail && reads(line))
  return at === -1 ? (lines.at(-1)?.text ?? '') : withDetail(lines, at)
}

/** How many of its last lines an agent that stopped is read for why. */
const CLOSING = 3

/**
 * Why an agent that stopped stopped, from all it wrote while it ran: the last
 * line among its last few that reads as an error, with its detail, else its
 * last line; empty where it wrote nothing. Not its first: what an MCP server,
 * a hook or a retry wrote on the way rarely says why it stopped.
 */
export const closingErrorLine = (output: string): string => {
  const lines = linesOf(output)
  const from = Math.max(0, lines.length - CLOSING)
  for (let at = lines.length - 1; at >= from; at--) if (!lines[at]!.detail && reads(lines[at]!)) return withDetail(lines, at)
  return lines.at(-1)?.text ?? ''
}

/**
 * Which class an agent that stopped is, from its last few lines, each read
 * on its own, the last first: never from a line further up, or one about an
 * MCP server, a hook or a plugin, whatever the rest of what it wrote says.
 */
export const closingFailureOf = (output: string): StartFailure | undefined => {
  const lines = linesOf(output)
  for (let at = lines.length - 1; at >= Math.max(0, lines.length - CLOSING); at--) {
    const found = startFailureOf(lines[at]!.text, false, true)
    if (found !== undefined) return found
  }
  return undefined
}
