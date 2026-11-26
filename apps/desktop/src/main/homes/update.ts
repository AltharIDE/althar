import { API_VERSION } from '@althar/contracts'
import { sshReleaseInfoArguments, sshUpdateArguments } from '@althar/transport-node'

import type { HomeUpdateCheck, HomeUpdated, SshRemoteHome } from '../../homes'
import type { HostRelease } from './release'
import type { Ran, RunOptions } from './setup'

/*
 * Updating a home from its window, over the SSH it's reached by: the home's own managed update (apps/host/README.md,
 * Managed releases and updates), run by the launcher and profile its connection runs, so it's the very installation
 * the window talks to. It checks for a release, applies it, restarting the home, and waits until the new one answers.
 * The window's own connection drops meanwhile and comes back once it's done.
 *
 * One at a time for each home: a second ask, from another window or a second press, waits on the same one.
 *
 * Before it runs, it asks what it changes: the home's own `release-info` against the newest release's signed manifest,
 * authenticated under the pinned keys. The home's updater refuses a release whose API version or storage format differs
 * from its own unless told `--allow-incompatible`, which the window says only where the person accepted that release's
 * data change and the release still speaks this app's API. The updater's snapshot and recovery are as ever: a release
 * that fails before it starts puts the home back on its old one with its data as it was; once it has started on the
 * moved data, it isn't run against the old release again.
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
const resultIn = (stdout: string): Record<string, unknown> | undefined => {
  for (const line of stdout.split('\n').reverse()) {
    try {
      const value: unknown = JSON.parse(line)
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
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
  // Refused for a new data format: only where the window couldn't look at the release first, so it didn't ask.
  if (/changes the API or stored-data format|moves the home’s data to a new format/.test(said))
    return `The update changes how ${name} stores its data, and Althar couldn’t look at it first. Try again.`
  if (/serves API version \d+, and this home serves/.test(said)) return `${name}’s update needs a newer Althar app. Update this app first.`
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
/** How long the newest release's manifest is kept: asked of GitHub a few minutes apart at most. */
const KEPT = 10 * 60_000

const later = (left: string, right: string) => {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index++) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0)
  return false
}

/** What the home says it runs (`release-info --json`). */
interface Installed {
  readonly version: string
  readonly apiVersion: number
  readonly storage: string
  readonly arch: 'x64' | 'arm64'
}
const installedIn = (stdout: string): Installed | undefined => {
  const info = resultIn(stdout)
  const { version, apiVersion, storage, arch } = info ?? {}
  if (typeof version !== 'string' || typeof apiVersion !== 'number' || typeof storage !== 'string' || (arch !== 'x64' && arch !== 'arm64'))
    return undefined
  return { version, apiVersion, storage, arch }
}

/**
 * What updating from what the home runs to the newest release changes: nothing where it's no newer; an API this app
 * doesn't speak; or, where its API or storage format differs from the home's (the updater's own `compatible`), its data.
 */
export const changeOf = (
  installed: Omit<Installed, 'arch'>,
  newest: Pick<HostRelease, 'version' | 'apiVersion' | 'storage'>,
  apiVersion = API_VERSION,
) => {
  const check = (change: HomeUpdateCheck['change']): HomeUpdateCheck => ({ from: installed.version, to: newest.version, change })
  if (!later(newest.version, installed.version)) return check('none')
  if (newest.apiVersion !== apiVersion) return check('api')
  return check(newest.apiVersion !== installed.apiVersion || newest.storage !== installed.storage ? 'data' : 'none')
}

/** Why the window doesn't update a home to a release of another API, and what to do. */
export const apiLine = (check: HomeUpdateCheck, newest: number, name: string, apiVersion = API_VERSION) =>
  newest > apiVersion
    ? `Althar ${check.to} for ${name} needs a newer Althar app. Update this app first, then ${name}.`
    : `Althar ${check.to} for ${name} doesn’t work with this Althar app.`

/** Why the home couldn't be asked what it runs, as the window says it in a line. */
const unasked = (ran: Ran, name: string) => {
  if (ran.code === 255)
    return /Permission denied|Authentication failed|no supported authentication methods/i.test(ran.stderr)
      ? `SSH couldn’t sign in to ${name}.`
      : `Couldn’t reach ${name} over SSH.`
  return `${name} didn’t say which Althar it runs.`
}
const downloadFailed = (ran: Ran) =>
  ran.code !== 0 && ran.code !== 255 && ran.code !== null && /could not be downloaded completely/.test(ran.stderr)

export const homeUpdates = ({
  run,
  program,
  latest,
  signal,
  log,
  apiVersion = API_VERSION,
}: {
  /** Runs a program by its path. */
  readonly run: (program: string, args: ReadonlyArray<string>, options: RunOptions) => Promise<Ran>
  /** The ssh the window's own connection runs (transport-node's sshProgram), so the update reaches the home as it does. */
  readonly program: string
  /** The newest host release for an architecture, authenticated under the pinned keys (release.ts's findRelease). */
  readonly latest: (arch: 'x64' | 'arm64', signal: AbortSignal) => Promise<HostRelease>
  readonly signal: AbortSignal
  /** The app's log: what the home's updater said, in full, where it didn't update. */
  readonly log?: (line: string) => void
  /** The API version this app speaks. */
  readonly apiVersion?: number
}) => {
  const running = new Map<string, Promise<HomeUpdated>>()
  const newest = new Map<string, { readonly at: number; readonly release: Promise<HostRelease> }>()
  const newestFor = (arch: 'x64' | 'arm64') => {
    const kept = newest.get(arch)
    if (kept !== undefined && Date.now() - kept.at < KEPT) return kept.release
    const release = latest(arch, AbortSignal.any([signal, AbortSignal.timeout(20_000)]))
    newest.set(arch, { at: Date.now(), release })
    // A failed look isn't kept: the next asks again.
    release.catch(() => {
      if (newest.get(arch)?.release === release) newest.delete(arch)
    })
    return release
  }
  /** What updating the home changes, with the newest release's API version, for saying why where it's another. */
  const look = async (home: SshRemoteHome) => {
    const ran = await run(program, sshReleaseInfoArguments(home.ssh), { signal, timeout: 60_000 })
    const installed = ran.code === 0 ? installedIn(ran.stdout) : undefined
    if (installed === undefined) throw new Error(unasked(ran, home.name))
    const release = await newestFor(installed.arch)
    return { check: changeOf(installed, release, apiVersion), api: release.apiVersion }
  }
  return {
    check: async (home: SshRemoteHome): Promise<HomeUpdateCheck> => (await look(home)).check,
    update: (home: SshRemoteHome, accept?: string): Promise<HomeUpdated> => {
      const under = running.get(home.homeId)
      if (under !== undefined) return under
      const attempt = async (args: ReadonlyArray<string>, tried: number): Promise<HomeUpdated> => {
        const ran = await run(program, args, { signal, timeout: LONGEST })
        if (ran.code !== 0) log?.(`Updating ${home.name} stopped (exit ${ran.code ?? 'timed out'}): ${ran.stderr.trim().slice(-2_000)}`)
        if (downloadFailed(ran) && tried < TRIES && !signal.aborted) return attempt(args, tried + 1)
        return updatedFrom(ran, home.name)
      }
      const one = (async (): Promise<HomeUpdated> => {
        // Where it can't be looked at first, the update goes as it would, and the home's updater refuses a new format itself.
        const looked = await look(home).catch((error: unknown) => {
          log?.(`What updating ${home.name} changes couldn’t be found out: ${error instanceof Error ? error.message : String(error)}`)
          return undefined
        })
        const check = looked?.check
        if (looked !== undefined && check?.change === 'api') throw new Error(apiLine(looked.check, looked.api, home.name, apiVersion))
        if (check?.change === 'data' && accept !== check.to) return { state: 'confirm', check }
        return attempt(sshUpdateArguments(home.ssh, check?.change === 'data'), 1)
      })().finally(() => running.delete(home.homeId))
      running.set(home.homeId, one)
      return one
    },
  }
}
