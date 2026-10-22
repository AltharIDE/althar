import { open } from 'node:fs/promises'

import { Duration, Effect } from 'effect'

import { localAddress } from './ports'
import { commandIn, shortCommand } from './rules'

/*
 * What an agent left running in the background, such as a dev server, as a
 * session keeps it while it runs (docs/decisions/021): the command, where it
 * answers once its output says, and how it ended if it did by itself. It
 * lives as long as the session does, so it is kept in memory, not in the
 * store: once the session goes, so does everything it left running.
 */

export interface LeftRunning {
  readonly id: string
  readonly command: string
  /** What the agent says it does, as it named the command: "Site dev server". Empty where it only gave the command. */
  readonly name: string
  /** The tool call that started it, whose output may say where it answers. */
  readonly toolCallId: string | null
  /** The file its output goes to, where the agent says (Claude Code). */
  outputPath: string | null
  /** The end of what it printed on its tool call, where the agent streams it there (Codex). */
  printed: string
  /** Where it answers, as its output said: http://localhost:5173/. */
  url: string | null
  /** `url` was worked out from a port, not said by its output: its output, once it says, replaces it. */
  inferred: boolean
  readonly startedAt: string
  /** It ended by itself: when, and its exit code where its output says. */
  ended: { readonly at: string; readonly code: number | null } | null
}

/**
 * Where one answers, given what it printed and the port found for it, if any:
 * what it printed is authoritative and replaces an address worked out from a
 * port; a port only gives one where it has none. Null where nothing changes.
 */
export const addressOf = (
  left: Pick<LeftRunning, 'url' | 'inferred'>,
  printed: string,
  port: number | null,
): { readonly url: string; readonly inferred: boolean } | null => {
  const said = servingAt(printed)
  if (said !== null) return left.url === said && !left.inferred ? null : { url: said, inferred: false }
  if (left.url === null && port !== null) return { url: localAddress(port), inferred: true }
  return null
}

/**
 * How long an agent must say nothing outside a turn Althar sent, once
 * something it left running ended, to be taken as done: Claude Code starts a
 * turn of its own when that happens (ADR-022), and nothing says when it ends.
 */
export const QUIET_FOR = Duration.seconds(30)

/**
 * How long an agent is given to wake once something it left running ended,
 * before it speaks: it may be slow to be told. Once it has spoken, `QUIET_FOR`
 * applies.
 */
export const WAKE_FOR = Duration.minutes(5)

/**
 * How long after a turn ends an agent is given to report what it left
 * running: Codex says it once its list of background terminals names it,
 * after the turn.
 */
export const REPORT_FOR = Duration.seconds(2)

/** A command that ends by itself, whatever it prints of where it answers: tests, builds, checks. */
const FINITE = /\b(test|tests|vitest|jest|mocha|playwright|cypress|pytest|check|lint|build|tsc|typecheck|e2e|ci)\b/i

/** What an agent has in hand, for whether it is done: the turn Althar sent, what it left running, and what it does outside a turn. */
export interface InHand {
  readonly turnRunning: boolean
  readonly background: ReadonlyArray<Pick<LeftRunning, 'ended' | 'url'> & { readonly command?: string }>
  /** Tool calls it began outside a turn and hasn't finished. */
  readonly callsOpen: number
  /** When it last spoke outside a turn, or something it left running ended (milliseconds); null if not since its last turn began. */
  readonly workedAt: number | null
  /** When something it left running ended in between turns, if it hasn't spoken since (milliseconds). */
  readonly wakeAt?: number | null
}

/**
 * Whether an agent is still at work: in a turn, with a command it left
 * running still going, in a call it hasn't finished, or not yet quiet for
 * `quiet` since it last spoke outside a turn or something it left running
 * ended. A turn that ends with any of these isn't the end of its work.
 * A command that says where it answers is a server, which runs on for as
 * long as the agent wants it: nothing the agent waits for to end. Unless it
 * is a test run or a build, which ends by itself though it prints an address.
 * Something it left running ended and it hasn't spoken yet is waited for
 * for `wake`, as it is on its way to wake.
 */
export const stillBusy = (hand: InHand, now: number, quiet: Duration.Duration, wake: Duration.Duration = WAKE_FOR) =>
  hand.turnRunning ||
  hand.background.some((left) => left.ended === null && (left.url === null || FINITE.test(left.command ?? ''))) ||
  hand.callsOpen > 0 ||
  (hand.wakeAt != null && now - hand.wakeAt < Duration.toMillis(wake)) ||
  (hand.workedAt !== null && now - hand.workedAt < Duration.toMillis(quiet))

/** How much of the end of a command's output is read for where it answers and how it ended. */
const TAIL = 16_384

// eslint-disable-next-line no-control-regex -- a terminal's colours are control characters
const COLOURS = /\u001b\[[0-9;?]*[A-Za-z]/g
const LOCAL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[\w-]+\.localhost)(?::\d{2,5})?(?:\/[^\s'"`<>)\]]*)?/

/** What a terminal shows, without its colours. */
export const uncoloured = (text: string) => text.replace(COLOURS, '')

/**
 * Where a command serves, as its output says: the first address on this
 * machine it prints, as a browser opens it. A server that prints none,
 * or holds its output back, never says.
 */
export const servingAt = (output: string): string | null => {
  const found = LOCAL.exec(uncoloured(output))?.[0]
  // Every address on this machine, as a browser can open it.
  return found === undefined ? null : found.replace(/\/\/(?:0\.0\.0\.0|\[::\])/, '//localhost').replace(/[.,;:]+$/, '')
}

/** How a command ended, where its output says, as Claude Code writes it at the end. */
export const exitCodeIn = (output: string): number | null => {
  const code = /\[exited with code (-?\d+)\]\s*$/.exec(output)?.[1]
  return code === undefined ? null : Number(code)
}

/** What it printed, with more on the end, kept to as much as is read. */
export const printedMore = (printed: string, more: string) => (printed + more).slice(-TAIL)

/** The end of a file, or nothing where it can't be read. */
export const tailOf = (path: string): Effect.Effect<string> =>
  Effect.promise(async () => {
    const file = await open(path, 'r').catch(() => undefined)
    if (file === undefined) return ''
    try {
      const { size } = await file.stat()
      const length = Math.min(size, TAIL)
      const buffer = Buffer.alloc(length)
      await file.read(buffer, 0, length, size - length)
      return buffer.toString('utf8')
    } finally {
      await file.close()
    }
  })

/**
 * The command one runs: its tool call's, where the call names it as a line;
 * else what the agent calls it, which for Codex is the command, and for
 * Claude Code what the call says it does.
 */
export const commandOfCall = (call: Readonly<Record<string, unknown>> | undefined, name: string): string => {
  const input = call?.rawInput
  const line = typeof input === 'object' && input !== null && 'command' in input ? input.command : undefined
  if (typeof line === 'string' && line !== '') return line
  if (name !== '') return name
  const title = call?.title
  return commandIn(input) ?? (typeof title === 'string' ? title : '')
}

/** What a client shows of one. */
export type ShownLeftRunning = Pick<LeftRunning, 'id' | 'command' | 'url' | 'startedAt' | 'ended'> & {
  /** What the agent calls it, where that says more than the command does. */
  readonly name?: string
  /** The command as it reads at a glance: without its `cd`, environment and output plumbing. */
  readonly label?: string
}
export const shownOf = (left: LeftRunning): ShownLeftRunning => ({
  id: left.id,
  command: left.command,
  ...(left.name === '' || left.name === left.command ? {} : { name: left.name }),
  label: shortCommand(left.command),
  url: left.url,
  startedAt: left.startedAt,
  ended: left.ended,
})
