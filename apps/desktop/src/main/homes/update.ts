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
  throw new Error(lastWords(ran.stderr) ?? `${name} couldn’t update.`)
}

export const homeUpdates = (
  run: (program: 'ssh', args: ReadonlyArray<string>, options: RunOptions) => Promise<Ran>,
  signal: AbortSignal,
) => {
  const running = new Map<string, Promise<HomeUpdated>>()
  return {
    update: (home: SshRemoteHome): Promise<HomeUpdated> => {
      const under = running.get(home.homeId)
      if (under !== undefined) return under
      const args = sshUpdateArguments(home.ssh)
      const one = run('ssh', args, { signal, timeout: LONGEST })
        .then((ran) => updatedFrom(ran, home.name))
        .finally(() => running.delete(home.homeId))
      running.set(home.homeId, one)
      return one
    },
  }
}
