import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { sshArguments } from '@althar/transport-node'

import script from '../../../../host/bootstrap/ssh.sh?raw'
import type { SshHomeTarget } from '../../homes'
import type { WorkerAgent, WorkerCheck, WorkerSetup, WorkerSetupAction, WorkerSignInEvent } from '../../workers'
import type { Fields } from '../../logs/logFile'
import { ReleaseProblem, type HostRelease, type WorkerRelease } from './release'
import { loggedInWith, type SetupSystem } from './setup'

/*
 * Adding a worker over SSH (apps/desktop/src/workers.ts says the steps): ssh.sh's worker operations, piped to the
 * machine's sh by the person's own OpenSSH, with its host keys checked and nothing forwarded. As a home's setup does,
 * it looks the machine over, makes a user of its own where it logged in as root, and gets the signed release there,
 * downloaded there or sent from here. Then the release makes the worker's key, the window has its home sign it, and
 * the worker starts as its own service. Every step can run again: Try again starts over, and finds the release and the
 * key already there. Every call answers at once; the work goes on behind, and each change is told to every window.
 */

type Event = Readonly<Record<string, unknown>> & { readonly step: string; readonly state: string }
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const hostOf = (target: string) => target.split('@').at(-1) ?? target
const fingerprintOf = (blob: string) =>
  `SHA256:${createHash('sha256').update(Buffer.from(blob, 'base64')).digest('base64').replace(/=+$/, '')}`
const eventsIn = (text: string): Event[] =>
  text.split('\n').flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line)
      return typeof value === 'object' && value !== null && 'step' in value ? [value as Event] : []
    } catch {
      return []
    }
  })
const lastWords = (stderr: string) =>
  stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('debug') && !line.startsWith('Warning: Permanently'))
    .at(-1)
    ?.slice(0, 300)

const STEP = { reach: 0, look: 1, get: 2, enroll: 3, start: 4, check: 5 } as const
const STEP_NAMES = ['reach', 'look', 'get', 'enroll', 'start', 'check', 'done']
/** A field of an event as text: its string, else nothing. */
const textOf = (value: unknown) => (typeof value === 'string' ? value : '')

const ALLOWED = new Set(['NeedsAdministrator', 'SandboxStillFails', 'SandboxUnfixable'])

/** The worker's check, from its `check done` event: kept to what the window shows. */
export const checkOf = (event: Readonly<Record<string, unknown>> | undefined): WorkerCheck | undefined => {
  if (event === undefined || typeof event.sandbox !== 'object' || event.sandbox === null) return undefined
  const sandbox = event.sandbox as { starts?: unknown; problem?: unknown; fix?: unknown }
  const agents = Array.isArray(event.agents) ? (event.agents as ReadonlyArray<Record<string, unknown>>) : []
  return {
    sandbox:
      sandbox.starts === true
        ? { starts: true }
        : {
            starts: false,
            problem: typeof sandbox.problem === 'string' ? sandbox.problem : 'Failed',
            ...(typeof sandbox.fix === 'string' && sandbox.fix.length <= 4_096 && !sandbox.fix.includes('\n') ? { fix: sandbox.fix } : {}),
          },
    agents: agents.flatMap((agent) =>
      typeof agent.id === 'string' && typeof agent.name === 'string' && typeof agent.signedIn === 'boolean'
        ? [
            {
              id: agent.id,
              name: agent.name,
              signedIn: agent.signedIn,
              ...(typeof agent.started === 'boolean' ? { started: agent.started } : {}),
              ...(typeof agent.message === 'string' ? { message: agent.message.slice(0, 300) } : {}),
            },
          ]
        : [],
    ),
  }
}

/** Where it goes in main.log: Althar's own log, for what went wrong. */
export interface WorkerLog {
  readonly info: (message: string, fields?: Fields) => void
  readonly warn: (message: string, fields?: Fields) => void
  readonly error: (message: string, fields?: Fields) => void
}

/**
 * What of a program's words may go to the log: never a one-time code, the home's grant or anything as long as a key or
 * a token (base64 of 40 characters or more), and its last lines only.
 */
/**
 * How long a release's transfer to a worker may take, with unpacking and checking it: ten minutes, and as long as its bytes
 * take at 128 KiB/s, the slowest the worker's own downloads allow (apps/host/src/updates/network.ts `downloadTime`).
 */
export const transferTime = (bytes: number) => 10 * 60_000 + Math.ceil(bytes / 131_072) * 1000

export const forTheLog = (text: string, lines = 20) =>
  text
    .replaceAll(/althar-worker1\.[A-Za-z0-9._-]+/g, 'althar-worker1.…')
    .replaceAll(/[A-Za-z0-9+/_-]{40,}={0,2}/g, '…')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .slice(-lines)
    .join('\n')
    .slice(-4_000)

class Stopped extends Error {
  constructor(
    readonly code: string,
    readonly step: number,
    readonly said?: string,
  ) {
    super(code)
  }
}
class Unknown extends Error {
  constructor(readonly key: { host: string; type: string; fingerprint: string; file: string; line: string }) {
    super('Unknown host key')
  }
}

/** The arguments every worker SSH call has: host keys checked, nothing forwarded, no terminal, no shared connection. */
export const workerSshArgs = (target: SshHomeTarget, verbose = false) => {
  // Its checks: a plain target, an absolute config file, a port in range. It throws on anything else.
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

/** A worker's SSH address as the home keeps it, `user@host` or `user@host:port`, and back. */
export const sshAddressOf = (target: SshHomeTarget) => (target.port === undefined ? target.target : `${target.target}:${target.port}`)
/**
 * The line a person runs in a terminal here to run `command` on the worker at this SSH address, with a terminal of its
 * own there (`-t`), as an agent's own sign-in needs: by its address, its port where it has one.
 */
export const terminalLine = (address: string, command: string) => {
  const target = sshTargetOf(address)
  return ['ssh', '-t', ...(target.port === undefined ? [] : ['-p', String(target.port)]), target.target, quote(command)].join(' ')
}

export const sshTargetOf = (address: string): SshHomeTarget => {
  const match = /^(.*?)(?::(\d{1,5}))?$/u.exec(address)
  const port = match?.[2] === undefined ? undefined : Number(match[2])
  return { target: match?.[1] ?? address, ...(port === undefined ? {} : { port }) }
}

export const workerSetups = (
  system: SetupSystem,
  /** OpenSSH, started with its input left open: for a sign-in, whose code is pasted back later. */
  interactive: (args: ReadonlyArray<string>) => ChildProcessWithoutNullStreams,
  changed: (setup: WorkerSetup | null) => void,
  said: (event: WorkerSignInEvent) => void,
  {
    log,
    release,
  }: {
    readonly log: WorkerLog
    /** Whether the newest host release can add a worker; `fresh` asks again rather than taking the last answer. */
    readonly release: (fresh: boolean, signal: AbortSignal) => Promise<WorkerRelease>
  },
) => {
  let setup: WorkerSetup | null = null
  let running: AbortController | undefined
  let here = false
  let pendingKey: { file: string; line: string } | undefined
  let found: HostRelease | undefined
  // Try again asks afresh whether a release can add a worker.
  let again = false

  const set = (change: Partial<WorkerSetup>) => {
    if (setup === null) return
    if (change.at !== undefined && change.at !== setup.at)
      log.info('Adding a worker: step', { worker: setup.name, step: STEP_NAMES[change.at] ?? String(change.at) })
    setup = { ...setup, ...change }
    changed(setup)
  }
  const say = (line: string) => {
    log.info('Adding a worker', { worker: setup?.name, said: forTheLog(line, 1) })
    set({ log: [...(setup?.log ?? []), line].slice(-200) })
  }

  /** ssh.sh with one operation, piped to the machine's sh: its events as they come, and how it ended. */
  const bootstrap = async (
    target: SshHomeTarget,
    operation: string,
    args: ReadonlyArray<string>,
    signal: AbortSignal,
    {
      verbose = false,
      timeout = 60_000,
      event,
      late,
    }: {
      verbose?: boolean
      timeout?: number
      event?: (event: Event) => void
      /** What it stopping at its deadline means, where that isn't the connection's failure. */
      late?: () => Stopped
    } = {},
  ) => {
    const ran = await system.run('ssh', [...workerSshArgs(target, verbose), `sh -s -- ${[operation, ...args].map(quote).join(' ')}`], {
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
    const failedEvent = events.find((one) => one.state === 'failed')
    if (ran.code !== 0 || failedEvent !== undefined)
      // The operation by its name only: its arguments carry the release's envelope and the home's grant.
      log.warn('Worker SSH call ended badly', {
        operation,
        target: sshAddressOf(target),
        exit: ran.code,
        failed: failedEvent === undefined ? undefined : `${failedEvent.step} ${textOf(failedEvent.code)}`.trim(),
        message: typeof failedEvent?.message === 'string' ? forTheLog(failedEvent.message, 3) : undefined,
        stderr: forTheLog(ran.stderr),
      })
    else log.info('Worker SSH call done', { operation, target: sshAddressOf(target) })
    // Its deadline, before what SSH exits with when stopped (255, as for a connection that failed).
    if (ran.timedOut === true && late !== undefined && !events.some((one) => one.state === 'failed')) throw late()
    if (ran.code === 255 && !events.some((one) => one.state === 'failed')) {
      const words = lastWords(ran.stderr)
      if (/HOST IDENTIFICATION HAS CHANGED/i.test(ran.stderr)) throw new Stopped('HostKeyChanged', STEP.reach, words)
      if (/Host key verification failed|No .*host key is known/i.test(ran.stderr)) throw new Unknown(await scan(target, signal))
      if (/Permission denied|Authentication failed|no supported authentication methods/i.test(ran.stderr))
        throw new Stopped('AuthFailed', STEP.reach, words)
      throw new Stopped('Unreachable', STEP.reach, words)
    }
    const failed = events.find((one) => one.state === 'failed')
    if (failed !== undefined) {
      const step = (STEP as Record<string, number>)[failed.step] ?? STEP.start
      // Its words, or the line that puts it right, as LingerOff gives it.
      const words = typeof failed.message === 'string' ? failed.message : typeof failed.command === 'string' ? failed.command : undefined
      throw new Stopped(typeof failed.code === 'string' ? failed.code : 'Failed', step, words)
    }
    return { ...ran, events }
  }

  /** What OpenSSH makes of the target: the host it reaches, its port, where it keeps known keys, its keys. */
  const resolve = async (target: SshHomeTarget, signal: AbortSignal) => {
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
    const value = (key: string) =>
      ran.stdout
        .split('\n')
        .filter((line) => line.toLowerCase().startsWith(`${key} `))
        .map((line) => line.slice(key.length + 1).trim())
    const expand = (path: string) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)
    return {
      host: value('hostname')[0] ?? hostOf(target.target),
      port: Number(value('port')[0] ?? '22'),
      alias: value('hostkeyalias')[0],
      known: expand((value('userknownhostsfile')[0] ?? '~/.ssh/known_hosts').split(/\s+/)[0]!),
      identities: value('identityfile').map(expand),
    }
  }

  const scan = async (target: SshHomeTarget, signal: AbortSignal) => {
    const where = await resolve(target, signal)
    const ran = await system.run('ssh-keyscan', ['-T', '10', '-p', String(where.port), '-t', 'ed25519,ecdsa,rsa', where.host], {
      signal,
      timeout: 20_000,
    })
    const keys = ran.stdout
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 3 && !parts[0]!.startsWith('#'))
    const key = keys.find((parts) => parts[1] === 'ssh-ed25519') ?? keys.find((parts) => parts[1]!.startsWith('ecdsa-')) ?? keys[0]
    if (key === undefined) throw new Stopped('KeyScanFailed', STEP.reach)
    const name = where.alias ?? (where.port === 22 ? where.host : `[${where.host}]:${where.port}`)
    return {
      host: where.host,
      type: key[1] === 'ssh-ed25519' ? 'ED25519' : key[1]!.startsWith('ecdsa-') ? 'ECDSA' : 'RSA',
      fingerprint: fingerprintOf(key[2]!),
      file: where.known,
      line: `${name} ${key[1]} ${key[2]}`,
    }
  }

  /** The public key the login used, to give the user Althar makes on a machine reached as root. */
  const acceptedKey = async (target: SshHomeTarget, stderr: string, signal: AbortSignal) => {
    const fingerprint = loggedInWith(stderr)
    const where = await resolve(target, signal)
    const agent = await system.run('ssh-add', ['-L'], { signal, timeout: 10_000 }).catch(() => ({ stdout: '' }))
    const files = await Promise.all(where.identities.map((path) => system.readFile(`${path}.pub`).catch(() => null)))
    const keys = [agent.stdout, ...files]
      .flatMap((text) => (text ?? '').split('\n'))
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 2 && /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))$/.test(parts[0]!))
    const key = fingerprint === undefined ? undefined : keys.find((parts) => fingerprintOf(parts[1]!) === fingerprint)
    if (key === undefined) throw new Stopped('NoPublicKey', STEP.look)
    return `${key[0]} ${key[1]}`
  }

  /** Looks the machine over and gets it the release: up to its key, ready for the home to sign. */
  const prepare = async (signal: AbortSignal) => {
    let target = setup!.target
    say(`$ ssh ${target.target}`)
    const probed = await bootstrap(target, 'probe', ['1'], signal, {
      verbose: true,
      event: (one) => {
        if (one.step === 'reach' && one.state === 'done') set({ at: STEP.look })
      },
    })
    const look = probed.events.find((one) => one.step === 'look' && one.state === 'done')
    if (look === undefined) throw new Stopped('Unreachable', STEP.reach)
    const arch = typeof look.arch === 'string' ? look.arch : 'x64'
    set({ at: STEP.look })
    const facts = `Linux · ${arch} · ${Math.round((typeof look.freeKiB === 'number' ? look.freeKiB : 0) / 1_048_576)} GB free`
    set({ facts })
    say(facts)
    // A regular login without lingering would stop the worker as this login ends: turned on here where it may be, else
    // the line for the machine's administrator, before anything is installed. A root login makes a user that lingers.
    if (look.root !== true && look.linger !== true) {
      const lingers = await bootstrap(target, 'worker-linger', [], signal)
      if (!lingers.events.some((one) => one.step === 'look' && one.state === 'done' && one.linger === true))
        throw new Stopped('LingerOff', STEP.look)
      say('loginctl enable-linger: on')
    }
    if (look.root === true) {
      // As a home is, a worker runs as a user of its own, reached with the key that logged in.
      const key = await acceptedKey(target, probed.stderr, signal)
      say('useradd --create-home althar · your SSH key to ~althar/.ssh/authorized_keys · loginctl enable-linger althar')
      const made = await bootstrap(target, 'root-login', [key], signal)
      if (made.events.some((one) => one.step === 'setup' && one.state === 'done' && one.sandboxRule === true))
        say('AppArmor: bubblewrap may make namespaces for the worker (/etc/apparmor.d/althar-worker-bwrap)')
      target = { ...target, target: `althar@${hostOf(target.target)}` }
      set({ target })
      say(`$ ssh ${target.target}`)
    }
    set({ at: STEP.get })
    try {
      found ??= await system.release(arch, signal)
    } catch (error) {
      if (signal.aborted) throw signal.reason
      log.warn('Adding a worker: no release to install', { arch, error: error instanceof Error ? error.message : String(error) })
      throw new Stopped(error instanceof ReleaseProblem ? error.code : 'ReleaseRejected', STEP.get)
    }
    const release = found
    // Downloaded on the machine, a release comes as its base where it has one: each agent's program follows with its sign-in.
    // Sent from here, it goes whole.
    const base = release.base
    set({ version: release.version, progress: { bytes: 0, total: base?.bytes ?? release.bytes } })
    const signed = [release.sha256, String(release.bytes), String(release.unpackedBytes)]
    const trust = [Buffer.from(release.envelope).toString('base64'), Buffer.from(release.key).toString('base64')]
    const install = async (method: 'download' | 'upload', source: string) => {
      const asked = method === 'download' && base !== undefined ? [base.sha256, String(base.bytes), String(base.unpackedBytes)] : signed
      const total = method === 'download' && base !== undefined ? base.bytes : release.bytes
      const ran = await bootstrap(target, 'worker-install', [method, ...asked, source, ...trust], signal, {
        timeout: transferTime(total),
        // Still downloading at its deadline: sent from here instead.
        ...(method === 'download' ? { late: () => new Stopped('CannotDownload', STEP.get) } : {}),
        event: (one) => {
          if (one.step === 'get' && typeof one.bytes === 'number' && typeof one.totalBytes === 'number')
            set({ progress: { bytes: one.bytes, total: one.totalBytes } })
        },
      })
      const key = ran.events.find((one) => one.step === 'key' && one.state === 'done')
      if (typeof key?.publicKey !== 'string') throw new Stopped('NoWorker', STEP.get)
      say(`althar-worker ${release.version}: checked against Althar’s release key`)
      return key.publicKey
    }
    try {
      say(`Release ${release.version}: downloading on the machine`)
      return await install('download', base?.url ?? release.url)
    } catch (error) {
      if (!(error instanceof Stopped) || error.code !== 'CannotDownload') throw error
    }
    // It can't download it: sent from here instead, into a folder the machine made for it.
    say(`Release ${release.version}: sending from this computer`)
    set({ sending: true })
    const prepared = await bootstrap(target, 'worker-prepare-upload', signed.slice(1), signal)
    const started = prepared.events.find((one) => one.step === 'get' && one.state === 'started')
    if (typeof started?.uploadId !== 'string' || typeof started.uploadPath !== 'string' || /["\n]/.test(started.uploadPath))
      throw new Stopped('CannotDownload', STEP.get)
    const scratch = await system.scratch()
    try {
      const file = join(scratch.path, 'althar.tar.gz')
      await system.fetchArchive(release, file, (bytes) => set({ progress: { bytes: Math.round(bytes / 2), total: release.bytes } }), signal)
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
        { input: `put "${file}" "${started.uploadPath}"\n`, signal, timeout: transferTime(release.bytes) },
      )
      if (signal.aborted) throw signal.reason
      if (sent.code !== 0) {
        log.warn('Worker sftp upload failed', { target: sshAddressOf(target), exit: sent.code, stderr: forTheLog(sent.stderr) })
        throw new Stopped('UploadFailed', STEP.get, lastWords(sent.stderr))
      }
    } finally {
      await scratch.remove().catch(() => undefined)
    }
    return install('upload', started.uploadId)
  }

  const agentsOf = (value: unknown): ReadonlyArray<WorkerAgent> =>
    Array.isArray(value)
      ? value.flatMap((one: unknown) => {
          const agent = one as Partial<WorkerAgent>
          return typeof agent.id === 'string' && typeof agent.name === 'string' && typeof agent.signedIn === 'boolean'
            ? [{ id: agent.id, name: agent.name, signedIn: agent.signedIn }]
            : []
        })
      : []

  /** The check that ends adding it, or ran again: done, and at its step where it found the worker can't run a task yet. */
  const checked = (events: ReadonlyArray<Event>) => {
    const check = checkOf(events.findLast((one) => one.step === 'check' && one.state === 'done'))
    const ready = check === undefined || (check.sandbox.starts && check.agents.every((agent) => agent.started !== false))
    if (check !== undefined)
      log.info('Adding a worker: checked', {
        worker: setup!.name,
        sandbox: check.sandbox.starts ? 'starts' : check.sandbox.problem,
        agents: check.agents
          .map((agent) => `${agent.id}:${agent.started === undefined ? 'signed out' : agent.started ? 'started' : 'failed'}`)
          .join(' '),
      })
    if (check !== undefined && !check.sandbox.starts) say(`Sandbox: ${check.sandbox.problem}`)
    set({ phase: 'done', at: ready ? STEP.check + 1 : STEP.check, checking: false, ...(check === undefined ? {} : { check }) })
  }

  const go = (work: (signal: AbortSignal) => Promise<void>) => {
    running?.abort()
    const controller = new AbortController()
    running = controller
    void work(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted || setup === null) return
      if (error instanceof Unknown) {
        log.info('Adding a worker: its host key is new here', {
          worker: setup.name,
          type: error.key.type,
          fingerprint: error.key.fingerprint,
        })
        pendingKey = { file: error.key.file, line: error.key.line }
        return set({ phase: 'trust', hostKey: { host: error.key.host, type: error.key.type, fingerprint: error.key.fingerprint } })
      }
      const stopped = error instanceof Stopped ? error : new Stopped('Failed', setup.at, error instanceof Error ? error.message : undefined)
      log.error('Adding a worker stopped', {
        worker: setup.name,
        target: sshAddressOf(setup.target),
        step: STEP_NAMES[stopped.step],
        code: stopped.code,
        said: stopped.said === undefined ? undefined : forTheLog(stopped.said, 5),
        ...(error instanceof Stopped ? {} : { stack: forTheLog(error instanceof Error ? (error.stack ?? '') : String(error), 12) }),
      })
      // NoWorkerRelease's is the newest release's version, for the window's words: no line of What it ran.
      if (stopped.said !== undefined && stopped.code !== 'NoWorkerRelease') say(stopped.said)
      set({
        phase: 'failed',
        at: stopped.step,
        problem: { code: stopped.code, ...(stopped.said === undefined ? {} : { said: stopped.said }) },
      })
    })
  }
  const begin = () =>
    go(async (signal) => {
      const { problem: _problem, hostKey: _hostKey, ...rest } = setup!
      setup = { ...rest, phase: 'running', at: STEP.reach }
      changed(setup)
      log.info('Adding a worker', { worker: setup.name, target: sshAddressOf(setup.target), here })
      // Whether there's a release that can be a worker at all, before anything is done on the machine. Where it can't be
      // found out (GitHub unreachable), the setup goes on, and stops at the release where it must.
      const able = await release(again, signal).catch((error: unknown) => {
        if (signal.aborted) throw signal.reason
        log.warn('Adding a worker: couldn’t find out the newest host release', { error: String(error) })
        return undefined
      })
      again = false
      if (signal.aborted) throw signal.reason
      if (able?.kind === 'none') {
        log.error('Adding a worker: no release can add one', { newest: able.newest, why: able.why })
        throw new Stopped('NoWorkerRelease', STEP.reach, able.newest ?? undefined)
      }
      const publicKey = await prepare(signal)
      set({ phase: 'enroll', at: STEP.enroll, publicKey })
    })

  /** The worker's check, run over SSH at its address; it writes what it found where the worker tells its home. */
  const checkOver = async (ssh: string) => {
    const controller = new AbortController()
    const ran = await bootstrap(sshTargetOf(ssh), 'worker-check', [], controller.signal, { timeout: 5 * 60_000 }).catch(
      (error: unknown) => {
        log.warn('A worker couldn’t be checked', { target: ssh, code: error instanceof Stopped ? error.code : String(error) })
        throw error
      },
    )
    const check = checkOf(ran.events.findLast((one) => one.step === 'check' && one.state === 'done')) ?? null
    log.info('A worker checked', {
      target: ssh,
      sandbox: check === null ? 'unsaid' : check.sandbox.starts ? 'starts' : check.sandbox.problem,
    })
    return check
  }

  // One sign-in at a time, over its own SSH connection: its input carries a pasted code.
  let signingIn: { readonly controller: AbortController; readonly write: (line: string) => void } | undefined

  return {
    current: () => setup,
    start: (target: SshHomeTarget, home: boolean) => {
      sshArguments(target)
      here = home
      found = undefined
      setup = { target, name: hostOf(target.target), phase: 'running', at: STEP.reach, log: [] }
      changed(setup)
      begin()
    },
    act: async (action: WorkerSetupAction) => {
      if (setup === null) return
      switch (action.kind) {
        case 'trust': {
          if (setup.phase !== 'trust' || pendingKey === undefined) return
          const kept = (await system.readFile(pendingKey.file).catch(() => null)) ?? ''
          await system.writeFile(pendingKey.file, `${kept}${kept === '' || kept.endsWith('\n') ? '' : '\n'}${pendingKey.line}\n`)
          say(`Trusted ${setup.hostKey?.fingerprint ?? 'its key'}: added to ${pendingKey.file}`)
          pendingKey = undefined
          return begin()
        }
        case 'enroll':
          if (setup.phase !== 'enroll') return
          set({ phase: 'running', at: STEP.start })
          return go(async (signal) => {
            const grant = Buffer.from(JSON.stringify(action.grant)).toString('base64url')
            say(`Signed by the home as ${action.grant.workerId}: starting the worker’s service`)
            const ran = await bootstrap(setup!.target, 'worker-enroll', [grant, here ? '1' : '0'], signal, {
              timeout: 5 * 60_000,
              event: (one) => {
                if (one.step === 'start' && one.state === 'done') set({ at: STEP.check })
              },
            })
            const started = ran.events.find((one) => one.step === 'start' && one.state === 'done')
            if (started === undefined) throw new Stopped('NotStarted', STEP.start)
            log.info('Adding a worker: started', { worker: setup!.name, workerId: action.grant.workerId })
            set({ workerId: action.grant.workerId, agents: agentsOf(started.agents) })
            checked(ran.events)
          })
        case 'check':
        case 'sandbox':
          if (setup.phase !== 'done' || setup.checking === true) return
          set({ checking: true })
          return go(async (signal) => {
            let last: Readonly<Record<string, unknown>> | undefined
            const keep = (one: Readonly<Record<string, unknown>> & { step: string; state: string }) => {
              if (one.step === 'check' && one.state === 'done') last = one
            }
            try {
              say(action.kind === 'sandbox' ? `$ sudo -n sh -c '…' on ${setup!.name}` : `Checking ${setup!.name} again`)
              const ran = await bootstrap(setup!.target, action.kind === 'sandbox' ? 'worker-sandbox' : 'worker-check', [], signal, {
                timeout: 5 * 60_000,
                event: keep,
              })
              checked(ran.events)
            } catch (error) {
              // Allowing it couldn't: its check stands, with why, and the command stays for an administrator.
              if (!(error instanceof Stopped) || !ALLOWED.has(error.code)) {
                set({ checking: false })
                throw error
              }
              const found = checkOf(last) ?? setup!.check
              set({
                checking: false,
                ...(found === undefined ? {} : { check: { ...found, allowed: error.code as NonNullable<WorkerCheck['allowed']> } }),
              })
            }
          })
        case 'again':
          if (setup.phase !== 'failed') return
          again = true
          return begin()
        case 'unsigned':
          // The window's home refused the worker's key: its words, as the home said them, for the log.
          log.error('Adding a worker: the home didn’t sign its key', { worker: setup.name, said: forTheLog(action.said ?? '', 5) })
          return set({ phase: 'failed', problem: { code: 'WorkerNotAdded', ...(action.said === undefined ? {} : { said: action.said }) } })
        case 'stop':
          log.info('Adding a worker: stopped by the person', { worker: setup.name, step: STEP_NAMES[setup.at] })
          running?.abort()
          return set({ phase: 'failed', problem: { code: 'Stopped' } })
        case 'dismiss':
          running?.abort()
          setup = null
          changed(null)
      }
    },
    /**
     * The worker's agents and their sign-ins, by its whole check over SSH: each signed in started once, as a task would
     * start it, which also says its models to the home. One that can't say whether it is signed in (Junie, Qwen Code, Mistral
     * Vibe, signed in in a terminal) is signed in only once it starts.
     */
    agents: async (ssh: string) => {
      const check = await checkOver(ssh)
      return (check?.agents ?? []).map(({ id, name, signedIn }) => ({ id, name, signedIn }))
    },
    /**
     * The worker's whole check now, over SSH, as its Check again runs it: its sandbox, as an administrator's fix left it,
     * and its agents. Null from a release that doesn't say it.
     */
    check: (ssh: string) => checkOver(ssh),
    signIn: (ssh: string, agent: string, way: 'browser' | 'device') => {
      signingIn?.controller.abort()
      const controller = new AbortController()
      // The script goes as the command, so the connection's input stays open for a code pasted back.
      const child = interactive([
        ...workerSshArgs(sshTargetOf(ssh)),
        `sh -c ${quote(script)} sh ${['worker-sign-in', agent, way].map(quote).join(' ')}`,
      ])
      controller.signal.addEventListener('abort', () => child.kill(), { once: true })
      log.info('Worker sign-in started', { target: ssh, agent, way })
      let partial = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (data: string) => {
        partial += data
        const lines = partial.split('\n')
        partial = lines.pop() ?? ''
        for (const one of eventsIn(lines.join('\n'))) {
          if (one.step === 'sign-in' && typeof one.kind === 'string') {
            // Its kind only: a device code, a link, who signed in and a refusal's words stay out of the log; a failure's
            // words go in, cut as every line is.
            if (one.kind === 'failed') log.warn('Worker sign-in failed', { target: ssh, agent, message: forTheLog(textOf(one.message), 3) })
            else log.info('Worker sign-in', { target: ssh, agent, kind: one.kind })
            // Its own command, to run on the worker: given as the line that reaches it over this SSH address.
            if (one.kind === 'terminal' && typeof one.command === 'string')
              said({ kind: 'terminal', command: terminalLine(ssh, one.command) })
            else said(one as unknown as WorkerSignInEvent)
          } else if (one.step === 'agents' && one.state === 'done') said({ kind: 'agents', agents: agentsOf(one.agents) })
          else if (one.step === 'check' && one.state === 'done') {
            const check = checkOf(one)
            if (check !== undefined) said({ kind: 'checked', check })
          } else if (one.state === 'failed') {
            log.warn('Worker sign-in failed', {
              target: ssh,
              agent,
              code: textOf(one.code),
              message: forTheLog(textOf(one.message), 3),
            })
            said({ kind: 'failed', message: typeof one.message === 'string' ? one.message : 'The sign-in stopped.' })
          }
        }
      })
      // What SSH said, kept short, for the log should the connection fail; a code pasted back goes in, never out.
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (data: string) => {
        stderr = (stderr + data).slice(-8_000)
      })
      child.stdin.on('error', () => undefined)
      child.on('exit', (code) => {
        if (signingIn?.controller === controller) signingIn = undefined
        if (code === 255 && !controller.signal.aborted)
          log.warn('Worker sign-in couldn’t reach the worker', { target: ssh, agent, exit: code, stderr: forTheLog(stderr) })
        if (code === 255 && !controller.signal.aborted) said({ kind: 'failed', message: 'The worker couldn’t be reached over SSH.' })
      })
      signingIn = { controller, write: (line) => child.stdin.write(`${line}\n`) }
      return Promise.resolve()
    },
    signInAct: (action: { readonly paste: string } | { readonly cancel: true }) => {
      if ('cancel' in action) {
        signingIn?.write(JSON.stringify({ cancel: true }))
        const ending = signingIn?.controller
        // Its moment to say it stopped, then the connection goes.
        setTimeout(() => ending?.abort(), 2_000).unref()
        signingIn = undefined
        return Promise.resolve()
      }
      signingIn?.write(JSON.stringify({ paste: action.paste }))
      return Promise.resolve()
    },
    stop: () => {
      running?.abort()
      signingIn?.controller.abort()
    },
  }
}
