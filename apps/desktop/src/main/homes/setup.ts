import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { sshArguments, sshEnvironment } from '@althar/transport-node'

import script from '../../../../host/bootstrap/ssh.sh?raw'
import { SETUP_STEPS, type HomeSetup, type SetupAction, type SetupStep, type SshHomeTarget } from '../../homes'
import { ReleaseProblem, type HostRelease } from './release'

/*
 * Setting a home up over SSH, as the host's bootstrap protocol has it (apps/host/bootstrap/README.md): the person's
 * own OpenSSH reaches the server and pipes it ssh.sh, which looks the server over, takes the verified release and
 * hands it to a setup that runs there on its own, under systemd, writing where it got to. This follows that setup,
 * by asking its status, until the home is running. So a dropped connection, a sleeping computer or a quit Althar
 * leaves it going or resumable: each step is safe to run again, and Try again starts again from where it stopped.
 *
 * One setup at a time, for the whole app; where it got to is kept in the profile, so a restart of Althar opens on it.
 * Every call answers at once; the work goes on behind, and each change is told to every window.
 */

export interface Ran {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  /** Stopped at its deadline: whatever code it then exited with (OpenSSH says 255) is the deadline's, not its own. */
  readonly timedOut?: boolean
}
export interface RunOptions {
  readonly input?: string
  /** Each line of its output, as it comes. */
  readonly line?: (line: string) => void
  readonly signal: AbortSignal
  readonly timeout: number
}
export interface SetupSystem {
  /** Runs one of OpenSSH's programs, by its name (ssh, ssh-keyscan, ssh-add, sftp). */
  readonly run: (program: 'ssh' | 'ssh-keyscan' | 'ssh-add' | 'sftp', args: ReadonlyArray<string>, options: RunOptions) => Promise<Ran>
  readonly release: (arch: string, signal: AbortSignal) => Promise<HostRelease>
  /** The release's archive, fetched here into `to` and checked against its digest. */
  readonly fetchArchive: (release: HostRelease, to: string, progress: (bytes: number) => void, signal: AbortSignal) => Promise<void>
  readonly readFile: (path: string) => Promise<string | null>
  readonly writeFile: (path: string, text: string | null) => Promise<void>
  readonly appendFile: (path: string, text: string) => Promise<void>
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>
  readonly home: string
  /** A new folder only this user can open, for one attempt's archive; `remove` takes it and all in it away. */
  readonly scratch: () => Promise<{ readonly path: string; readonly remove: () => Promise<void> }>
}

/** What a setup keeps across a restart of Althar: where, how far, and what it learnt on the way. */
interface Saved {
  readonly target: SshHomeTarget
  readonly at: number
  readonly madeUser: boolean
  readonly upload: boolean
  readonly linger?: string
  readonly version?: string
  readonly identity?: HomeSetup['identity']
}

/** A step that stopped, with the code the window words. */
class Stopped extends Error {
  constructor(
    readonly code: string,
    readonly step: number,
  ) {
    super(code)
  }
}
/** The connection went under it: it reconnects, and the server goes on meanwhile. */
class Dropped extends Error {}
/** The server's key, seen for the first time: the person's to trust. */
class Unknown extends Error {
  constructor(readonly key: { host: string; type: string; fingerprint: string; file: string; line: string }) {
    super('Unknown host key')
  }
}

type Event = Readonly<Record<string, unknown>> & { readonly step: string; readonly state: string }
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const hostOf = (target: string) => target.split('@').at(-1) ?? target
const indexOf = (step: unknown) => Math.max(0, SETUP_STEPS.indexOf(step as SetupStep))
const fingerprintOf = (blob: string) =>
  `SHA256:${createHash('sha256').update(Buffer.from(blob, 'base64')).digest('base64').replace(/=+$/, '')}`
/**
 * The fingerprint of the key a login finished with, from ssh -v's log, or undefined where it can't be told for sure.
 * OpenSSH logs "Server accepts key" when the server would take a key, before it signs with it; where signing fails it
 * offers the next. So it's the last key accepted before authentication succeeded over publickey, with no signing
 * failure after it. A login that needed more than one (partial success) or ended otherwise isn't read.
 */
export const loggedInWith = (log: string): string | undefined => {
  const lines = log.split(/\r?\n/)
  const succeeded = lines.findIndex(
    (line) => /Authentication succeeded \(publickey\)/.test(line) || /Authenticated to .* using "publickey"/.test(line),
  )
  if (succeeded === -1) return undefined
  const before = lines.slice(0, succeeded)
  if (before.some((line) => /partial success/i.test(line))) return undefined
  let at = -1
  for (const [index, line] of before.entries()) if (/Server accepts key:/.test(line)) at = index
  if (at === -1) return undefined
  if (before.slice(at + 1).some((line) => /signing failed|sign_and_send_pubkey/.test(line))) return undefined
  return /(SHA256:[A-Za-z0-9+/]+)/.exec(before[at]!)?.[1]
}
const eventsIn = (text: string): Event[] =>
  text.split('\n').flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line)
      return typeof value === 'object' && value !== null && 'step' in value && 'state' in value ? [value as Event] : []
    } catch {
      return []
    }
  })
/** The last thing SSH said that isn't its own chatter, for What it ran. */
const lastWords = (stderr: string) =>
  stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('debug') && !line.startsWith('Warning: Permanently'))
    .at(-1)
    ?.slice(0, 300)

/** Codes no Try again can help with: the server itself can't run a home. */
export const FINAL = new Set(['UnsupportedOS', 'UnsupportedArchitecture', 'NoSystemd', 'AccountConflict', 'NoRelease'])

export const homeSetups = (system: SetupSystem, changed: (setup: HomeSetup | null) => void) => {
  let setup: HomeSetup | null = null
  let running: AbortController | null = null
  // The key a run stopped on, for the person to trust: theirs to answer for that run only.
  let pendingKey: { file: string; line: string; run: AbortController } | null = null
  let saved = ''
  const savedAt = join(system.home, 'home-setup.json')
  let ready: Promise<void> = system
    .readFile(savedAt)
    .then((text) => {
      if (text === null || setup !== null) return
      const value = JSON.parse(text) as Saved
      if (typeof value.target?.target !== 'string' || typeof value.at !== 'number') return
      saved = text
      setup = {
        ...value,
        phase: 'stopped',
        log: ['(Althar quit partway: the server keeps what it had)'],
      }
      changed(setup)
    })
    .catch(() => undefined)

  const persist = () => {
    const next =
      setup === null
        ? ''
        : JSON.stringify({
            target: setup.target,
            at: setup.at,
            madeUser: setup.madeUser,
            upload: setup.upload,
            ...(setup.linger === undefined ? {} : { linger: setup.linger }),
            ...(setup.version === undefined ? {} : { version: setup.version }),
            ...(setup.identity === undefined ? {} : { identity: setup.identity }),
          } satisfies Saved)
    if (next === saved) return
    saved = next
    ready = ready.then(() => system.writeFile(savedAt, next === '' ? null : next)).catch(() => undefined)
  }

  /** One run of the setup: everything it changes is dropped once it's stopped or replaced. */
  const drive = () => {
    running?.abort()
    const stop = new AbortController()
    running = stop
    const { signal } = stop
    const set = (next: Partial<HomeSetup>) => {
      if (signal.aborted || setup === null) return
      setup = { ...setup, ...next }
      changed(setup)
      persist()
    }
    const say = (line: string) => setup !== null && set({ log: [...setup.log, line].slice(-200) })
    const advance = (step: number) => setup !== null && step > setup.at && set({ at: step })
    let drops = 0
    // Reached once in this run: a connection failing after that dropped, rather than never answered.
    let reached = false

    const sshArgs = (target: SshHomeTarget, verbose = false) => {
      sshArguments(target)
      return [
        '-T',
        ...(verbose ? ['-v'] : []),
        '-oBatchMode=yes',
        '-oStrictHostKeyChecking=yes',
        '-oForwardAgent=no',
        '-oClearAllForwardings=yes',
        '-oControlMaster=no',
        '-oControlPath=none',
        '-oConnectTimeout=20',
        '-oServerAliveInterval=15',
        '-oServerAliveCountMax=3',
        '-oRequestTTY=no',
        ...(target.configFile === undefined ? [] : ['-F', target.configFile]),
        ...(target.port === undefined ? [] : ['-p', String(target.port)]),
        '--',
        target.target,
      ]
    }

    /** ssh.sh, piped to the server's sh, with one operation: its events as they come, and how it ended. */
    const bootstrap = async (
      operation: string,
      args: ReadonlyArray<string>,
      { verbose = false, timeout = 60_000, event }: { verbose?: boolean; timeout?: number; event?: (event: Event) => void } = {},
    ) => {
      const target = setup!.target
      const ran = await system.run('ssh', [...sshArgs(target, verbose), `sh -s -- ${[operation, ...args].map(quote).join(' ')}`], {
        input: script,
        signal,
        timeout,
        ...(event === undefined
          ? {}
          : {
              line: (line: string) => {
                for (const one of eventsIn(line)) event(one)
              },
            }),
      })
      if (signal.aborted) throw signal.reason
      const events = eventsIn(ran.stdout)
      // OpenSSH's own failure, before or under the script.
      if (ran.code === 255 && !events.some((one) => one.state === 'failed')) {
        const said = lastWords(ran.stderr)
        if (said !== undefined) say(said)
        if (/HOST IDENTIFICATION HAS CHANGED/i.test(ran.stderr)) throw new Stopped('HostKeyChanged', 0)
        if (/Host key verification failed|No .*host key is known/i.test(ran.stderr)) throw new Unknown(await scan(target))
        if (/Permission denied|Authentication failed|no supported authentication methods/i.test(ran.stderr))
          throw new Stopped('AuthFailed', 0)
        if (events.length > 0 || drops > 0 || reached) throw new Dropped()
        throw new Stopped('Unreachable', 0)
      }
      return { ...ran, events }
    }
    const failedIn = (events: ReadonlyArray<Event>) => {
      const failed = events.find((one) => one.state === 'failed')
      if (failed !== undefined) throw new Stopped(typeof failed.code === 'string' ? failed.code : 'InstallFailed', indexOf(failed.step))
    }

    /** What OpenSSH makes of the target: the host it reaches, its port, where it keeps known keys. */
    const resolve = async (target: SshHomeTarget) => {
      const ran = await system.run(
        'ssh',
        [
          '-G',
          ...(target.configFile === undefined ? [] : ['-F', target.configFile]),
          ...(target.port === undefined ? [] : ['-p', String(target.port)]),
          '--',
          target.target,
        ],
        { signal, timeout: 10_000 },
      )
      const said = (key: string) =>
        ran.stdout
          .split('\n')
          .filter((line) => line.toLowerCase().startsWith(`${key} `))
          .map((line) => line.slice(key.length + 1).trim())
      const expand = (path: string) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)
      return {
        host: said('hostname')[0] ?? hostOf(target.target),
        port: Number(said('port')[0] ?? '22'),
        alias: said('hostkeyalias')[0],
        known: expand((said('userknownhostsfile')[0] ?? '~/.ssh/known_hosts').split(/\s+/)[0]!),
        identities: said('identityfile').map(expand),
      }
    }

    /** The server's own key, read the first time, for the person to compare. */
    const scan = async (target: SshHomeTarget) => {
      const where = await resolve(target)
      const ran = await system.run('ssh-keyscan', ['-T', '10', '-p', String(where.port), '-t', 'ed25519,ecdsa,rsa', where.host], {
        signal,
        timeout: 20_000,
      })
      const keys = ran.stdout
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 3 && !parts[0]!.startsWith('#'))
      const key = keys.find((parts) => parts[1] === 'ssh-ed25519') ?? keys.find((parts) => parts[1]!.startsWith('ecdsa-')) ?? keys[0]
      if (key === undefined) throw new Stopped('KeyScanFailed', 0)
      const name = where.alias ?? (where.port === 22 ? where.host : `[${where.host}]:${where.port}`)
      return {
        host: where.host,
        type: key[1] === 'ssh-ed25519' ? 'ED25519' : key[1]!.startsWith('ecdsa-') ? 'ECDSA' : 'RSA',
        fingerprint: fingerprintOf(key[2]!),
        file: where.known,
        line: `${name} ${key[1]} ${key[2]}`,
      }
    }

    /** The public key the server took, from what OpenSSH said: the one to give the user Althar makes. */
    const acceptedKey = async (stderr: string) => {
      const fingerprint = loggedInWith(stderr)
      const where = await resolve(setup!.target)
      const agent = await system.run('ssh-add', ['-L'], { signal, timeout: 10_000 }).catch(() => ({ stdout: '' }))
      const files = await Promise.all(where.identities.map((path) => system.readFile(`${path}.pub`).catch(() => null)))
      const keys = [agent.stdout, ...files]
        .flatMap((text) => (text ?? '').split('\n'))
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 2 && /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))$/.test(parts[0]!))
      // Only the key that logged in: any other may be one this computer can't log in with as althar.
      const key = fingerprint === undefined ? undefined : keys.find((parts) => fingerprintOf(parts[1]!) === fingerprint)
      if (key === undefined) throw new Stopped('NoPublicKey', 1)
      return `${key[0]} ${key[1]}`
    }

    /** Reach the server and look it over: what it is, and whether it can be a home. */
    const look = async () => {
      if (!setup!.log.at(-1)?.startsWith(`$ ssh ${setup!.target.target}`)) say(`$ ssh ${setup!.target.target}`)
      const ran = await bootstrap('probe', ['1'], {
        verbose: true,
        event: (one) => {
          if (one.step === 'reach' && one.state === 'done') advance(1)
        },
      })
      advance(1)
      failedIn(ran.events)
      const found = ran.events.find((one) => one.step === 'look' && one.state === 'done')
      if (found === undefined) throw new Stopped('Unreachable', 0)
      reached = true
      const facts = {
        arch: typeof found.arch === 'string' ? found.arch : 'x64',
        freeKiB: typeof found.freeKiB === 'number' ? found.freeKiB : 0,
        git: found.git === true,
      }
      const action = found.action as Record<string, unknown> | undefined
      set({
        facts,
        ...(action?.code === 'LingerOff' && typeof action.command === 'string' ? { linger: `sudo ${action.command}` } : {}),
      })
      say(`Linux · ${facts.arch} · ${Math.round(facts.freeKiB / 1_048_576)} GB free${facts.git ? ' · git' : ''}`)
      return { root: found.root === true, stderr: ran.stderr, arch: facts.arch }
    }

    /** Logged in as root: the home gets a user of its own, althar, with this computer's key, and is reached as it. */
    const makeUser = async (stderr: string) => {
      const key = await acceptedKey(stderr)
      say('useradd --create-home althar · your SSH key to ~althar/.ssh/authorized_keys · loginctl enable-linger althar')
      const ran = await bootstrap('root-login', [key])
      const failed = ran.events.find((one) => one.state === 'failed')
      if (failed !== undefined) throw new Stopped(typeof failed.code === 'string' ? failed.code : 'AccountCreationFailed', 1)
      if (!ran.events.some((one) => one.step === 'setup' && one.state === 'done' && one.login === 'althar'))
        throw new Stopped('AccountCreationFailed', 1)
      const own = { ...setup!.target, target: `althar@${hostOf(setup!.target.target)}` }
      set({ target: own, madeUser: true })
      say(`$ ssh ${own.target}  (from here on, the home is althar's)`)
    }

    /** How the setup stands on the server: none yet, its transfer, or the host's own setup and its state. */
    const status = async () => {
      const ran = await bootstrap('status', [], { timeout: 30_000 })
      try {
        const value = JSON.parse(ran.stdout.trim()) as { state?: unknown; events?: unknown } | null
        if (typeof value === 'object' && value !== null && typeof value.state === 'string' && Array.isArray(value.events))
          return { kind: 'host' as const, state: value.state, events: eventsIn(value.events.map((one) => JSON.stringify(one)).join('\n')) }
      } catch {
        // Not the host's status: the transfer's events, or nothing yet.
      }
      if (ran.events.some((one) => one.code === 'SetupNotFound')) return { kind: 'none' as const }
      return { kind: 'transfer' as const, events: ran.events }
    }

    /** The release to install, found and checked once a run: before anything changes on the server. */
    let found: HostRelease | undefined
    const releaseFor = async (arch: string) => {
      if (found !== undefined) return found
      try {
        found = await system.release(arch, signal)
      } catch (error) {
        if (signal.aborted) throw signal.reason
        throw new Stopped(error instanceof ReleaseProblem ? error.code : 'ReleaseRejected', 2)
      }
      set({ version: found.version })
      return found
    }

    /** Get althar-host onto the server: downloaded there, or sent from here; it ends with the setup going on its own. */
    const get = async (arch: string) => {
      advance(2)
      const release = await releaseFor(arch)
      set({ progress: { bytes: 0, total: release.bytes } })
      const signed = [release.sha256, String(release.bytes), String(release.unpackedBytes)]
      const trust = [Buffer.from(release.envelope).toString('base64'), Buffer.from(release.key).toString('base64')]
      const install = async (method: 'download' | 'upload', source: string) => {
        let detached = false
        const ran = await bootstrap('install', [method, ...signed, source, ...trust], {
          timeout: 15 * 60_000,
          event: (one) => {
            if (one.step === 'get' && typeof one.bytes === 'number' && typeof one.totalBytes === 'number')
              set({ progress: { bytes: one.bytes, total: one.totalBytes } })
            if (one.step === 'get' && one.state === 'done') {
              say(`althar-host ${release.version}: checked against Althar’s release key`)
              advance(3)
            }
            if (one.step === 'setup' && one.state === 'started' && one.detached === true) detached = true
          },
        })
        for (const one of ran.events) if (one.step === 'setup' && one.state === 'started' && one.detached === true) detached = true
        failedIn(ran.events)
        if (!detached) throw new Dropped()
      }
      if (!setup!.upload) {
        say(`althar-host ${release.version}: downloading on the server`)
        return install('download', release.url)
      }
      say(`althar-host ${release.version}: sending from this computer`)
      const prepared = await bootstrap('prepare-upload', signed.slice(1))
      failedIn(prepared.events)
      const started = prepared.events.find((one) => one.step === 'get' && one.state === 'started')
      if (typeof started?.uploadId !== 'string' || typeof started.uploadPath !== 'string' || /["\n]/.test(started.uploadPath))
        throw new Stopped('CannotDownload', 2)
      // A folder of this attempt's own: nothing else's file is written through, and it goes however this ends.
      const scratch = await system.scratch().catch(() => {
        throw new Stopped('UploadFailed', 2)
      })
      try {
        const file = join(scratch.path, 'althar-host.tar.gz')
        try {
          await system.fetchArchive(
            release,
            file,
            (bytes) => set({ progress: { bytes: Math.round(bytes / 2), total: release.bytes } }),
            signal,
          )
        } catch {
          if (signal.aborted) throw signal.reason
          throw new Stopped('UploadFailed', 2)
        }
        const target = setup!.target
        const sent = await system.run(
          'sftp',
          [
            '-b',
            '-',
            '-oBatchMode=yes',
            '-oStrictHostKeyChecking=yes',
            '-oConnectTimeout=20',
            ...(target.configFile === undefined ? [] : ['-F', target.configFile]),
            ...(target.port === undefined ? [] : ['-P', String(target.port)]),
            target.target,
          ],
          { input: `put "${file}" "${started.uploadPath}"\n`, signal, timeout: 15 * 60_000 },
        )
        if (signal.aborted) throw signal.reason
        if (sent.code !== 0) throw new Dropped()
      } finally {
        await scratch.remove().catch(() => undefined)
      }
      set({ progress: { bytes: release.bytes, total: release.bytes } })
      return install('upload', started.uploadId)
    }

    /**
     * A transfer the server is running already, from a run the connection dropped under or another window's: followed
     * by its journal until it's staged, it ends, or it stops moving (its process gone, so the lock is free again).
     */
    const watch = async () => {
      let last = ''
      let still = 0
      for (;;) {
        const now = await status()
        if (now.kind === 'host') return 'staged' as const
        if (now.kind === 'none') return 'ended' as const
        // It failed there (couldn't download, didn't match): that's the setup's trouble, with its own way out.
        failedIn(now.events)
        const moved = [...now.events].reverse().find((one) => one.step === 'get' && typeof one.bytes === 'number')
        if (moved !== undefined && typeof moved.totalBytes === 'number')
          set({ progress: { bytes: moved.bytes as number, total: moved.totalBytes } })
        const seen = JSON.stringify(now.events.at(-1) ?? null)
        if (seen !== last) {
          last = seen
          still = 0
        } else if (++still > 40) return 'ended' as const
        await system.wait(1500, signal)
      }
    }

    /** Get it there, or follow the transfer that holds the server's lock, until it's staged. */
    const transfer = async (arch: string) => {
      for (let held = 0; ; held++) {
        try {
          return await get(arch)
        } catch (error) {
          if (!(error instanceof Stopped) || error.code !== 'LockHeld' || held >= 3) throw error
        }
        say('(a transfer is under way on the server: following it)')
        if ((await watch()) === 'staged') return
      }
    }

    /** Follow the setup the server runs on its own, step by step, until the home answers. */
    const follow = async () => {
      advance(3)
      const said = new Set<string>()
      let resumed = false
      let absent = 0
      for (;;) {
        const now = await status()
        if (now.kind === 'none') throw new Stopped('SetupNotFound', setup!.at)
        if (now.kind === 'transfer') {
          // Staged and then not: the transfer's own end, where it has one, else it never got going.
          failedIn(now.events)
          if (++absent > 20) throw new Stopped('SetupLaunchFailed', 3)
        }
        if (now.kind === 'host') {
          for (const one of now.events) {
            const key = `${one.step}:${one.state}`
            if (one.state !== 'done' || said.has(key)) continue
            said.add(key)
            if (one.step === 'setup') {
              say(`althar-host init: a new home, ${typeof one.homeId === 'string' ? `${one.homeId.slice(0, 13)}…` : ''}`)
              advance(4)
            }
            if (one.step === 'start') {
              say('systemctl --user enable --now althar-host.service')
              advance(5)
            }
          }
          if (now.state === 'done') {
            // The home it made, as it says: the one the window connects to must be it.
            const identity = now.events.find((one) => one.step === 'identity' && one.state === 'done')
            if (typeof identity?.homeId !== 'string' || typeof identity.hostDeviceId !== 'string') throw new Stopped('IdentityMismatch', 5)
            say(`althar-host status: ready, ${identity.homeId}`)
            set({
              phase: 'done',
              at: 5,
              identity: { homeId: identity.homeId, hostDeviceId: identity.hostDeviceId },
              ...(typeof identity.version === 'string' ? { version: identity.version } : {}),
            })
            return
          }
          if (now.state === 'failed') failedIn([...now.events].reverse())
          if (now.state === 'interrupted') {
            if (resumed) throw new Stopped('InstallFailed', setup!.at)
            resumed = true
            say('(it stopped on the server: picking up where it got to)')
            failedIn((await bootstrap('resume', [], { timeout: 60_000 })).events)
          }
          if (now.state === 'absent' && ++absent > 20) throw new Stopped('SetupLaunchFailed', 3)
        }
        await system.wait(1500, signal)
      }
    }

    /**
     * Once through: reach and look, make the user where it's root (once there's a release to install, so nothing changes
     * on a server Althar can't finish), then follow what the server has, or get it there, and follow it.
     */
    const once = async () => {
      const looked = await look()
      if (looked.root) {
        await releaseFor(looked.arch)
        await makeUser(looked.stderr)
        const again = await look()
        if (again.root) throw new Stopped('DedicatedUserRequired', 1)
      }
      const known = await status()
      if (known.kind === 'host' && known.state !== 'absent') {
        advance(3)
        if (known.state === 'failed') {
          say(`(trying again from: ${SETUP_STEPS[setup!.at]})`)
          failedIn((await bootstrap('resume', [], { timeout: 60_000 })).events)
        }
        return follow()
      }
      // Not staged yet: a transfer still going there holds its lock, and is followed rather than started over.
      await transfer(looked.arch)
      return follow()
    }

    void (async () => {
      for (;;) {
        try {
          await once()
          return
        } catch (error) {
          if (signal.aborted) return
          if (error instanceof Dropped && drops < 5) {
            drops++
            set({ phase: 'reconnecting' })
            say(`Connection to ${hostOf(setup!.target.target)} closed. Reconnecting: the setup goes on there meanwhile.`)
            try {
              await system.wait(2000 * drops, signal)
            } catch {
              return
            }
            set({ phase: 'running' })
            continue
          }
          if (error instanceof Unknown) {
            pendingKey = { file: error.key.file, line: error.key.line, run: stop }
            say(
              `The authenticity of host '${error.key.host}' can't be established. ${error.key.type} key fingerprint is ${error.key.fingerprint}.`,
            )
            set({ phase: 'trust', hostKey: { host: error.key.host, type: error.key.type, fingerprint: error.key.fingerprint } })
            return
          }
          const stopped =
            error instanceof Stopped ? error : new Stopped(error instanceof Dropped ? 'Dropped' : 'InstallFailed', setup?.at ?? 0)
          set({ phase: 'failed', problem: stopped.code, at: Math.max(stopped.step, setup?.at ?? 0) })
          return
        }
      }
    })()
  }

  const begin = () => {
    if (setup === null) return
    setup = { ...setup, phase: 'running', problem: undefined, hostKey: undefined }
    changed(setup)
    persist()
    drive()
  }

  return {
    state: async () => {
      await ready
      return setup
    },
    /** Sets a home up on this target, from the start: another under way is called off. */
    start: (given: SshHomeTarget) => {
      // It installs althar-host where it always goes, with its own profile: a launcher or profile given would read another.
      const { launcher: _launcher, profile: _profile, ...target } = given
      sshArguments(target)
      running?.abort()
      pendingKey = null
      setup = { target, phase: 'running', at: 0, upload: false, madeUser: false, log: [] }
      changed(setup)
      persist()
      drive()
    },
    act: async (action: SetupAction) => {
      await ready
      if (setup === null) return
      switch (action) {
        case 'trust': {
          if (setup.phase !== 'trust' || pendingKey === null) return
          const key = pendingKey
          pendingKey = null
          // Kept where OpenSSH looks, then the same run goes on: unless it was stopped, called off or replaced meanwhile.
          const current = () => running === key.run && !key.run.signal.aborted && setup?.phase === 'trust'
          let kept: unknown = null
          try {
            const existing = (await system.readFile(key.file)) ?? ''
            await system.appendFile(key.file, `${existing === '' || existing.endsWith('\n') ? '' : '\n'}${key.line}\n`)
          } catch (error) {
            kept = error
          }
          if (!current() || setup === null) return
          if (kept !== null) {
            setup = {
              ...setup,
              phase: 'failed',
              problem: 'KnownHostsUnwritable',
              hostKey: undefined,
              log: [
                ...setup.log,
                `Couldn’t keep the key in ${key.file}: ${kept instanceof Error ? kept.message : 'it couldn’t be written'}`,
              ],
            }
            changed(setup)
            return
          }
          setup = {
            ...setup,
            log: [...setup.log, `Trusted ${setup.hostKey?.host ?? ''} (${setup.hostKey?.fingerprint ?? ''}), kept in ${key.file}`],
          }
          return begin()
        }
        case 'stop':
          if (setup.phase !== 'running' && setup.phase !== 'reconnecting' && setup.phase !== 'trust') return
          running?.abort()
          running = null
          setup = { ...setup, phase: 'stopped', log: [...setup.log, '(stopped: what it had done stays, and it picks up from there)'] }
          changed(setup)
          return
        case 'upload':
          if (setup.phase !== 'failed' || setup.problem !== 'CannotDownload') return
          setup = { ...setup, upload: true }
          return begin()
        case 'resume':
          if (setup.phase !== 'failed' && setup.phase !== 'stopped') return
          if (setup.phase === 'failed' && FINAL.has(setup.problem ?? '')) return
          setup = { ...setup, log: [...setup.log, setup.phase === 'stopped' ? '(resuming: the server has what it had)' : '(trying again)'] }
          return begin()
        case 'dismiss':
          running?.abort()
          running = null
          pendingKey = null
          setup = null
          changed(null)
          persist()
          return
      }
    },
    stop: () => {
      running?.abort()
      running = null
      return ready
    },
  }
}
export type HomeSetups = ReturnType<typeof homeSetups>

/**
 * Whether this build can set a home up: not inside the Flatpak, which keeps the person's SSH keys, agent and known
 * hosts out of its sandbox (docs/decisions/061), so it can't read the key that logs in, scan a host or send a file.
 * There a home is set up by hand and connected over SSH or with a pairing code.
 */
export const canSetUp = (env: NodeJS.ProcessEnv = process.env) => env.FLATPAK_ID === undefined

/** Runs a program by its path, as OpenSSH's are run: its own process group, the SSH environment, bounded output. */
export const runProgram = (program: string, args: ReadonlyArray<string>, { input, line, signal, timeout }: RunOptions): Promise<Ran> =>
  new Promise((resolve) => {
    const child = spawn(program, [...args], {
      env: sshEnvironment(process.env),
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: 'pipe',
    })
    let stdout = ''
    let stderr = ''
    let partial = ''
    const kill = () => {
      try {
        if (process.platform !== 'win32' && child.pid !== undefined) process.kill(-child.pid, 'SIGTERM')
        else child.kill()
      } catch {
        child.kill()
      }
    }
    let timedOut = false
    const deadline = setTimeout(() => {
      timedOut = true
      kill()
    }, timeout)
    signal.addEventListener('abort', kill, { once: true })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (data: string) => {
      if (stdout.length < 1_048_576) stdout += data
      partial += data
      const lines = partial.split('\n')
      partial = lines.pop() ?? ''
      for (const one of lines) line?.(one)
    })
    child.stderr.on('data', (data: string) => {
      stderr = (stderr + data).slice(-65_536)
    })
    child.stdin.on('error', () => undefined)
    child.stdout.on('error', () => undefined)
    child.stderr.on('error', () => undefined)
    const end = (code: number | null) => {
      clearTimeout(deadline)
      signal.removeEventListener('abort', kill)
      if (partial !== '') line?.(partial)
      partial = ''
      resolve({ code, stdout, stderr, ...(timedOut ? { timedOut } : {}) })
    }
    child.once('error', () => end(255))
    child.once('close', (code) => end(code))
    child.stdin.end(input ?? '')
  })

/** The system as it is: OpenSSH beside the ssh the app reaches homes with, the network, and the profile's files. */
export const nativeSetupSystem = (profile: string, release: SetupSystem['release'], own?: string): SetupSystem => {
  const tools = own ?? (process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/OpenSSH') : '/usr/bin')
  const executable = (name: string) => join(tools, process.platform === 'win32' ? `${name}.exe` : name)
  return {
    home: profile,
    scratch: async () => {
      // mkdtemp makes it new, and only this user's (0700): no file of another's is there to follow or truncate.
      const path = await fs.mkdtemp(join(tmpdir(), 'althar-host-'))
      return { path, remove: () => fs.rm(path, { recursive: true, force: true }) }
    },
    run: (program, args, options) => runProgram(executable(program), args, options),
    release,
    fetchArchive: async (found, to, progress, signal) => {
      const response = await fetch(found.url, { signal, redirect: 'follow' })
      if (!response.ok || response.body === null) throw new Error('The release could not be downloaded.')
      const hash = createHash('sha256')
      let bytes = 0
      const counted = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>).map((chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > found.bytes) throw new Error('The release is larger than its manifest says.')
        hash.update(chunk)
        progress(bytes)
        return chunk
      })
      await pipeline(counted, createWriteStream(to, { flags: 'wx', mode: 0o600 }), { signal })
      if (bytes !== found.bytes || hash.digest('hex') !== found.sha256) {
        await fs.rm(to, { force: true })
        throw new Error('The release did not match its signed digest.')
      }
    },
    readFile: async (path) => {
      try {
        return await fs.readFile(path, 'utf8')
      } catch {
        return null
      }
    },
    writeFile: async (path, text) => {
      if (text === null) return fs.rm(path, { force: true })
      const temporary = `${path}.${process.pid}.tmp`
      await fs.writeFile(temporary, text, { mode: 0o600 })
      await fs.rename(temporary, path)
    },
    appendFile: async (path, text) => {
      await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await fs.appendFile(path, text, { mode: 0o600 })
    },
    wait: (ms, signal) =>
      new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason)
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort)
          resolve()
        }, ms)
        const abort = () => {
          clearTimeout(timer)
          reject(signal.reason)
        }
        signal.addEventListener('abort', abort, { once: true })
      }),
  }
}
