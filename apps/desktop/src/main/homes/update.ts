import { sshUpdateArguments } from '@althar/transport-node'

import type { HomeUpdated, SshRemoteHome } from '../../homes'
import type { Ran, RunOptions } from './setup'

/*
 * Updating a home from its window, over the SSH it's reached by: the home's own managed update (apps/host/README.md,
 * Managed releases and updates), run by the launcher and profile its connection runs, so it's the very installation
 * the window talks to. It checks for a release, applies it, restarting the home, and waits until the new one answers.
 * The window's own connection drops meanwhile and comes back once it's done.
 *
 * One at a time for each home: a second ask, from another window or a second press, waits on the same one.
 */

/** As long as the home's own updater waits for a result, and a little more. */
const LONGEST = 16 * 60_000

/** What the home said last, other than SSH's own chatter: why it stopped. */
const lastWords = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('debug') && !line.startsWith('Warning: Permanently'))
    .at(-1)
    ?.slice(0, 300)

/** The updater's result, its last line of JSON. */
const resultIn = (stdout: string): { state?: unknown; version?: unknown } | undefined => {
  for (const line of stdout.split('\n').reverse()) {
    try {
      const value: unknown = JSON.parse(line)
      if (typeof value === 'object' && value !== null) return value
    } catch {
      // Not its result.
    }
  }
  return undefined
}

/** The updater's first sentence: what went wrong, without what it adds after. */
const firstSentence = (text: string) => /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text

/**
 * Why the home's updater stopped, as the window says it in a line: each of the updater's own lines
 * (apps/host/src/updates), worded for the window, with what failed where the updater says it, and otherwise its first
 * sentence. A 0.1.0 home says only that the download didn't complete.
 */
export const problemOf = (said: string, name: string) => {
  const host = (pattern: RegExp) => pattern.exec(said)?.[1]
  const lookup = host(/DNS didn’t answer for (\S+)\./)
  if (lookup !== undefined) return `${name}’s DNS didn’t answer for ${lookup}.`
  const connect = host(/Couldn’t connect to (\S+)\./)
  if (connect !== undefined) return `${name} couldn’t connect to ${connect}.`
  const slow = host(/^(\S+) took too long to answer\./)
  if (slow !== undefined) return `${slow} took too long to answer ${name}.`
  const limiting = host(/^(\S+) is limiting requests from this computer\./)
  if (limiting !== undefined) return `${limiting} is limiting requests from ${name}. Try again in an hour.`
  const status = /^(\S+) answered with HTTP (\d{3})\./.exec(said)
  if (status !== null) return `${status[1]} answered ${name} with HTTP ${status[2]}.`
  if (/could not be downloaded completely/.test(said)) return `${name} couldn’t download the update.`
  if (/No authenticated host release is available/.test(said)) return `${name} found no update it could take.`
  if (/does not match its authenticated digest/.test(said)) return `The update ${name} downloaded was damaged. Nothing changed.`
  return firstSentence(said)
}

/** What an update that ran said, as the window words it; an Error with a line where it didn't update. */
export const updatedFrom = (ran: Ran, name: string): HomeUpdated => {
  if (ran.code === 0) {
    const result = resultIn(ran.stdout)
    const version = typeof result?.version === 'string' ? result.version : undefined
    if (result?.state === 'applied') return version === undefined ? { state: 'applied' } : { state: 'applied', version }
    if (result?.state === 'current') throw new Error(`There’s no newer Althar for ${name} yet.`)
    throw new Error(`${name} downloaded the update but didn’t apply it.`)
  }
  if (ran.code === 255) {
    if (/Permission denied|Authentication failed|no supported authentication methods/i.test(ran.stderr))
      throw new Error(`SSH couldn’t sign in to ${name}.`)
    throw new Error(`Couldn’t reach ${name} over SSH.`)
  }
  if (ran.code === null) throw new Error(`${name} took too long to update. It may still be updating: check again in a few minutes.`)
  const said = lastWords(ran.stderr)
  throw new Error(said === undefined ? `${name} couldn’t update.` : problemOf(said, name))
}

/**
 * A 0.1.0 home's updater tries a download once, and a flaky network there (a DNS server that drops some lookups, as
 * runner-1's did) fails it often: the window asks again, twice at most. Its installed release is unchanged each time.
 * Later updaters try again themselves.
 */
const TRIES = 3
const downloadFailed = (ran: Ran) =>
  ran.code !== 0 && ran.code !== 255 && ran.code !== null && /could not be downloaded completely/.test(ran.stderr)

export const homeUpdates = ({
  run,
  program,
  signal,
  log,
}: {
  /** Runs a program by its path. */
  readonly run: (program: string, args: ReadonlyArray<string>, options: RunOptions) => Promise<Ran>
  /** The ssh the window's own connection runs (transport-node's sshProgram), so the update reaches the home as it does. */
  readonly program: string
  readonly signal: AbortSignal
  /** The app's log: what the home's updater said, in full, where it didn't update. */
  readonly log?: (line: string) => void
}) => {
  const running = new Map<string, Promise<HomeUpdated>>()
  return {
    update: (home: SshRemoteHome): Promise<HomeUpdated> => {
      const under = running.get(home.homeId)
      if (under !== undefined) return under
      const args = sshUpdateArguments(home.ssh)
      const attempt = async (tried: number): Promise<HomeUpdated> => {
        const ran = await run(program, args, { signal, timeout: LONGEST })
        if (ran.code !== 0) log?.(`Updating ${home.name} stopped (exit ${ran.code ?? 'timed out'}): ${ran.stderr.trim().slice(-2_000)}`)
        if (downloadFailed(ran) && tried < TRIES && !signal.aborted) return attempt(tried + 1)
        return updatedFrom(ran, home.name)
      }
      const one = attempt(1).finally(() => running.delete(home.homeId))
      running.set(home.homeId, one)
      return one
    },
  }
}
