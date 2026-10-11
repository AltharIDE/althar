import { open } from 'node:fs/promises'

import { Effect } from 'effect'

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
  /** The tool call that started it, whose output may say where it answers. */
  readonly toolCallId: string | null
  /** The file its output goes to, where the agent says (Claude Code). */
  outputPath: string | null
  /** The end of what it printed on its tool call, where the agent streams it there (Codex). */
  printed: string
  /** Where it answers, as its output said: http://localhost:5173/. */
  url: string | null
  readonly startedAt: string
  /** It ended by itself: when, and its exit code where its output says. */
  ended: { readonly at: string; readonly code: number | null } | null
}

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
  /** The command as it reads at a glance: without its `cd`, environment and output plumbing. */
  readonly label: string
}
export const shownOf = (left: LeftRunning): ShownLeftRunning => ({
  id: left.id,
  command: left.command,
  label: shortCommand(left.command),
  url: left.url,
  startedAt: left.startedAt,
  ended: left.ended,
})
