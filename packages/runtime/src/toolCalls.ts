import type { TallyKind } from '@althar/contracts'
import { SECRET_PLACES } from '@althar/provider-adapters'

/*
 * A tool call as the record keeps it (docs/architecture/07): the command line
 * and the paths its input names, without what it writes, and what the
 * boundary refused it, read from what it printed (ADR-071). Thread items and
 * permission requests keep these; the rules read the whole input, in memory.
 */

export const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined

/** The command line in a tool call's raw input, as a shell would read it, when it names one. */
export const commandIn = (rawInput: unknown): string | undefined => {
  const command = field(rawInput, 'command') ?? field(rawInput, 'cmd')
  if (typeof command === 'string') return command
  if (Array.isArray(command) && command.every((part) => typeof part === 'string')) return command.map(quoteWord).join(' ')
  return undefined
}

const quoteWord = (word: string) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`)

/** The fields of a tool call's input that name a path. */
export const PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path', 'old_path', 'new_path', 'destination', 'source', 'target']

/** How much of a command the store keeps. The rules read all of it, in memory. */
export const COMMAND_KEPT = 4_000

/**
 * What of a tool call's input the store keeps (docs/architecture/07: no file
 * contents, and so no secrets, in the record): the command, the paths, the
 * host a network request is for, and which files a patch touches, without
 * what it writes. What is left out is
 * named, so the record says it was cut. The rules decide on the whole input;
 * this is only what is written down.
 */
export const essentials = (
  rawInput: unknown,
): { readonly input: Readonly<Record<string, unknown>>; readonly cut: ReadonlyArray<string> } => {
  if (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput))
    return { input: {}, cut: rawInput === undefined || rawInput === null ? [] : ['input'] }
  const input: Record<string, unknown> = {}
  const cut: Array<string> = []
  for (const [key, value] of Object.entries(rawInput)) {
    if (key === 'command' || key === 'cmd') {
      const whole = typeof value === 'string' ? value : Array.isArray(value) ? value : undefined
      if (typeof whole === 'string' && whole.length > COMMAND_KEPT) {
        input[key] = `${whole.slice(0, COMMAND_KEPT)}…`
        cut.push(`${key} after ${COMMAND_KEPT} characters`)
      } else if (whole !== undefined) input[key] = whole
      else cut.push(key)
    } else if (PATH_KEYS.includes(key) && typeof value === 'string') input[key] = value
    // The host a network request is for (Claude Code's sandbox asks by it): a name, never a secret.
    else if (key === 'host' && typeof value === 'string') input.host = value.slice(0, 253)
    // Whether a command asked to run outside its sandbox (ADR-071): what was counted as crossing it.
    else if (key === 'dangerouslyDisableSandbox' && typeof value === 'boolean') input[key] = value
    else if (key === 'changes' && typeof value === 'object' && value !== null) {
      // A patch's files, without their contents.
      input.changes = Array.isArray(value)
        ? value.map((change) => ({ path: field(change, 'path') }))
        : Object.fromEntries(Object.keys(value).map((path) => [path, {}]))
      cut.push('changes (contents)')
    } else cut.push(key)
  }
  return { input, cut }
}

/** The kind of what git's guard stopped, where a failed command's output says it did, by the line it ends with (pushGuard.ts, `STOPPED`). */
export const guardStopIn = (printed: string): 'default-branch' | 'force-push' | 'delete-branch' | undefined =>
  /\(stopped by Althar: (default-branch|force-push|delete-branch)\)/.exec(printed)?.[1] as
    | 'default-branch'
    | 'force-push'
    | 'delete-branch'
    | undefined

/** What a sandbox says when it stops a command: macOS's, and a read-only bind on Linux (bubblewrap). */
const REFUSED_THERE = /operation not permitted|read-only file system/i

/** Where the person keeps keys, as a path a refusal names. */
const KEPT_KEYS = new RegExp(`/(?:${SECRET_PLACES.map((place) => place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:/|\\b)`)

/**
 * What the boundary refused a command, from what it printed: the kind git's
 * guard names, whether the command then failed or went on; or, where a
 * sandbox holds the session and the command failed saying it couldn't,
 * reading where keys are kept or writing outside. A command that went on
 * printing that has no mark of the sandbox's to tell it from one that
 * printed a log or a file saying it, so only the guard's mark counts there.
 */
export const stoppedIn = (printed: string, call: { readonly sandboxed: boolean; readonly failed: boolean }): TallyKind | undefined => {
  const guarded = guardStopIn(printed)
  if (guarded !== undefined) return guarded
  if (!call.sandboxed || !call.failed || !REFUSED_THERE.test(printed)) return undefined
  return KEPT_KEYS.test(printed) ? 'credentials' : 'outside'
}
