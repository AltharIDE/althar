import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { request } from 'node:https'
import { promisify } from 'node:util'

import {
  agents,
  bundledClaude,
  bundledCodex,
  signInCheck,
  startSignInFlow,
  usingLocated,
  type AgentDefinition,
  type SignInWay,
} from '@althar/provider-adapters'
import { workerCodeOf } from '@althar/runtime/workerHome'
import { newKey } from '@althar/transport-node'
import { Effect } from 'effect'

import { HostError } from './errors'
import { HOST_VERSION } from './version'
import { privateDirectory, readPrivate, writePrivate } from './privateFiles'
import { authenticateRelease, verifyRelease } from './updates/release'
import { downloadRelease, getUpdateBytes } from './updates/network'
import { extractRelease } from './updates/archive'
import { completeRelease, freeBytes, NoRoom, type Completed } from './updates/parts'
import { checkHere, checkWorker, linkShipped, shippedSandbox, workerPath, type CheckSystem } from './workerCheck'
import { installTools } from './workerTools'

/*
 * A worker, set up from the window (ADR-103): a signed worker release, published beside the home's. Nobody types
 * any of this. The window's SSH setup runs it on the worker (`bootstrap/ssh.sh`'s `worker-` operations), and a machine
 * without SSH runs `join` with a one-time code. Each prints JSON lines the window reads.
 *
 * - `install --program <release>`: makes the release it was just given whole where it came as its base (its agents'
 *   own programs, its parts, lent from a release already here or downloaded: updates/parts.ts), points the worker's
 *   `current` program at it, makes the worker's own P-256 key where it has none, and says its public key. The key never
 *   leaves the worker.
 * - `enroll --grant <base64url>`: what the home gave once it signed that key, written to the worker's folder; its
 *   agents, from the release (the ACP adapters and the agents' own programs ship in it); and its services, started.
 * - `join --code <code>`: a code's way to the same, asking the home itself.
 * - `agents`: which agents it has and which are signed in, kept where the worker reads it with its heartbeats.
 * - `sign-in --agent <id> --way <browser|device>`: the agent's own sign-in, as Althar runs it on a home, its steps
 *   said as JSON lines; a code pasted back comes in on stdin.
 * - `update`: its timer's, hourly: a newer signed worker release, from where the home's come from, verified, unpacked
 *   and switched to while the worker runs no task, and the worker started again on it; and its check again. A release in
 *   parts comes as its base and only the parts the release it runs doesn't have.
 * - `check`: whether its agents' sandbox starts, its tools, and each signed-in agent started once, which says its
 *   models (workerCheck.ts); kept where the worker reads it with its heartbeats. Setup ends with it.
 * - `sandbox`: what only root may do to let the sandbox start (newer Ubuntu's AppArmor rule for bubblewrap), with
 *   `sudo -n` where this login may without a password; then the check again. Without, it only says the command.
 * - `tools <name@version>…`: what a project needs that the worker installs itself (workerTools.ts), before its setup.
 * - `version`: the release it is, for its packaging to check.
 *
 * A worker's own release runs these as `althar-worker.js <command>` (worker.ts); a home's, as `althar-host worker
 * <command>`, for workers installed from it before workers had a release of their own. Taking a worker off its
 * computer is its native program's (`althar-worker uninstall`, apps/worker/src/uninstall.rs), which the home starts
 * when the person removes it.
 */

const run = promisify(execFile)
const data = (env: NodeJS.ProcessEnv = process.env) => env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
export const workerFolder = (env: NodeJS.ProcessEnv = process.env) => join(data(env), 'althar-worker')
export const programFolder = (env: NodeJS.ProcessEnv = process.env) => join(data(env), 'althar-worker-program')
const unitsFolder = (env: NodeJS.ProcessEnv = process.env) => join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user')
const SERVICE = 'althar-worker.service'

const say = (out: (text: string) => void, value: Record<string, unknown>) => out(`${JSON.stringify({ protocol: 1, ...value })}\n`)

/** The agents a worker runs from its release: its ACP adapter and the agent's own program, both shipped in it. */
const shipped = (): ReadonlyArray<{
  readonly id: 'claude-code' | 'codex'
  readonly definition: AgentDefinition
  readonly program: string
}> =>
  (
    [
      ['claude-code', bundledClaude()],
      ['codex', bundledCodex()],
    ] as const
  ).flatMap(([id, program]) =>
    program === null
      ? []
      : [{ id, program, definition: usingLocated(agents[id], () => ({ command: program, whose: 'bundled' as const })) }],
  )

/** The release this runs from: `dist/althar-host.js`'s folder's parent. */
const running = () => resolve(dirname(process.argv[1] ?? ''), '..')

/**
 * A path in the release this runs from, as the worker's stable `current` names it, so its agents keep working across an
 * update: every release has the same layout.
 */
const stable = (path: string, release: string, current: string) =>
  path.startsWith(`${release}/`) ? `${current}${path.slice(release.length)}` : path

const shellQuoted = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

/** Each shipped agent as a small program of its own, as `agents.conf` names it: the launch Althar gives it on a home. */
const writeAgents = async (folder: string, current: string) => {
  const release = await fs.realpath(running())
  const node = join(current, 'node', 'bin', 'node')
  const programs = join(folder, 'agents')
  await privateDirectory(programs, true)
  const lines: string[] = [join(folder, 'workspaces')]
  for (const agent of system.agents()) {
    const spec = agent.definition.launch(node)
    const { PATH: _path, ...rest } = spec.env ?? {}
    const env = Object.entries(rest)
      .map(([name, value]) => `export ${name}=${shellQuoted(stable(value, release, current))}`)
      .join('\n')
    // The worker gives each run its PATH (agent_setup.rs `worker_path`): the tools installed for it first, the sandbox's.
    const keepPath = `if [ -z "\${PATH:-}" ]; then PATH=${shellQuoted(workerPath(folder, current))}; fi\nexport PATH`
    const command = [stable(spec.command, release, current), ...spec.args.map((arg) => stable(arg, release, current))]
    const script = `#!/bin/sh\n${env}${env === '' ? '' : '\n'}${keepPath}\nexec ${command.map(shellQuoted).join(' ')} "$@"\n`
    const path = join(programs, agent.id)
    await writePrivate(path, script, true)
    await fs.chmod(path, 0o700)
    lines.push(`*\t${agent.id}\t${path}`)
  }
  await writePrivate(join(folder, 'agents.conf'), `${lines.join('\n')}\n`, true)
}

/** Which shipped agents are signed in, kept where the worker reads it at each hello; says each. */
const checkAgents = async (folder: string) => {
  const checked = await Promise.all(
    system
      .agents()
      .map(async (agent) => ({ id: agent.id, name: agent.definition.name, signedIn: await system.signedIn(agent.definition) })),
  )
  const signedIn = checked.flatMap((agent) => (agent.signedIn ? [agent.id] : []))
  const was = (await readPrivate(join(folder, 'signed-in'), 4096))?.toString('utf8') ?? null
  const now = signedIn.map((id) => `${id}\n`).join('')
  if (was !== now) await writePrivate(join(folder, 'signed-in'), now, true)
  return { agents: checked }
}

/** Whether the worker runs a task now: one of its agents' or a project command's own units is active. */
const busy = async () => {
  try {
    return (
      (await system.systemctl(['list-units', '--state=active', '--plain', '--no-legend', 'althar-agent-*', 'althar-wpr_*'])).trim() !== ''
    )
  } catch {
    return true
  }
}

const systemctl = (...args: string[]) => system.systemctl(args)

/** What a worker's setup runs on: the user's service manager, the agents' own sign-in checks, the agents it ships. */
export interface WorkerSystem {
  /** `systemctl --user` with these arguments: what it printed. */
  readonly systemctl: (args: ReadonlyArray<string>) => Promise<string>
  readonly signedIn: (agent: AgentDefinition) => Promise<boolean>
  readonly agents: typeof shipped
  /** What its check runs on (workerCheck.ts). */
  readonly check: CheckSystem
  /** `sudo -n sh -c <script>`: whether it ran, without a password. */
  readonly sudo: (script: string) => Promise<boolean>
  /** Where its release ships each program its agents' sandbox needs. */
  readonly shipped: (current: string) => Readonly<Partial<Record<string, string>>>
  /** The bytes free on the disk a folder is on. */
  readonly free: (folder: string) => Promise<number>
}
let system: WorkerSystem = {
  systemctl: async (args) => (await run('systemctl', ['--user', ...args], { timeout: 30_000 })).stdout,
  signedIn: async (agent) => (await Effect.runPromise(signInCheck(agent, process.execPath))).status === 'signed_in',
  agents: shipped,
  check: checkHere,
  sudo: async (script) => (await checkHere.run('sudo', ['-n', 'sh', '-c', script], { timeout: 30_000 })).ok,
  shipped: (current) => shippedSandbox(current),
  free: freeBytes,
}
/** For tests: the system it runs on, in part; puts it back when called. */
export const withWorkerSystem = (given: Partial<WorkerSystem>) => {
  const was = system
  system = { ...system, ...given }
  return () => {
    system = was
  }
}

/**
 * How a release runs its worker's setup commands: a worker's own release by its own entry; a home's release, which
 * workers were installed from before they had their own, as `althar-host worker …`.
 */
const commandsOf = async (release: string): Promise<readonly [entry: string, ...rest: string[]]> =>
  (await fs.stat(join(release, 'dist', 'althar-worker.js')).then(
    (stat) => stat.isFile(),
    () => false,
  ))
    ? ['dist/althar-worker.js']
    : ['dist/althar-host.js', 'worker']

const renderUnits = (folder: string, program: string, [entry, ...rest]: Awaited<ReturnType<typeof commandsOf>>) => {
  const current = join(program, 'current')
  return {
    [SERVICE]: `[Unit]
Description=Althar worker
Wants=network-online.target
After=network-online.target

[Service]
ExecStart=${join(current, 'althar-worker')} serve ${folder}
Restart=always
RestartSec=5
UMask=0077

[Install]
WantedBy=default.target
`,
    'althar-worker-update.service': `[Unit]
Description=Althar worker update

[Service]
Type=oneshot
ExecStart=${[join(current, 'node', 'bin', 'node'), join(current, entry), ...rest].join(' ')} update
`,
    'althar-worker-update.timer': `[Unit]
Description=Check for a newer Althar worker every hour

[Timer]
OnBootSec=10min
OnUnitActiveSec=1h
RandomizedDelaySec=10min

[Install]
WantedBy=timers.target
`,
  }
}

/** Its services' files, for the release `current` points at. */
const writeUnits = async (folder: string, program: string) => {
  const units = unitsFolder()
  await fs.mkdir(units, { recursive: true, mode: 0o700 })
  const commands = await commandsOf(join(program, 'current'))
  for (const [name, text] of Object.entries(renderUnits(folder, program, commands))) await writePrivate(join(units, name), text, true)
}

const failed = (code: string, message: string) => Object.assign(new Error(message), { code })

/** Points `current` at a release, atomically: a link made beside it and renamed over it. */
const pointAt = async (program: string, release: string) => {
  const link = join(program, `.current-${process.pid}`)
  await fs.rm(link, { force: true })
  await fs.symlink(release, link)
  await fs.rename(link, join(program, 'current'))
}

export const install = async (releaseFolder: string, out: (text: string) => void, fetcher: typeof fetch = fetch) => {
  const folder = workerFolder()
  const program = programFolder()
  const release = resolve(releaseFolder)
  if (dirname(release) !== program || !basename(release).startsWith('bundle-')) throw failed('InvalidRequest', 'Not a worker release.')
  await fs.access(join(release, 'althar-worker'), fs.constants.X_OK).catch(() => {
    throw failed('NoWorker', 'This release carries no worker.')
  })
  await completeInstalled(release, out, fetcher)
  await privateDirectory(folder, true)
  await pointAt(program, release)
  await writePrivate(join(folder, 'release'), `${HOST_VERSION}\n`, true)
  let key = (await readPrivate(join(folder, 'worker.key'), 4096))?.toString('utf8')
  if (key === undefined) {
    key = newKey().key
    if (!(await writePrivate(join(folder, 'worker.key'), key, false)))
      key = (await readPrivate(join(folder, 'worker.key'), 4096))?.toString('utf8')
  }
  const publicKey = createPublicKey(createPrivateKey(key ?? ''))
    .export({ type: 'spki', format: 'der' })
    .toString('base64url')
  say(out, { step: 'key', state: 'done', publicKey, release: HOST_VERSION })
}

interface Grant {
  readonly homeId: string
  readonly workerId: string
  readonly authority: string
  readonly certificate: string
  readonly serverName: string
  readonly addresses: ReadonlyArray<string>
}

const grantOf = (value: unknown): Grant => {
  const grant = value as Partial<Grant>
  if (
    typeof grant.homeId !== 'string' ||
    !/^home_[a-f0-9]{32}$/u.test(grant.homeId) ||
    typeof grant.workerId !== 'string' ||
    !/^wrk_[a-f0-9]{32}$/u.test(grant.workerId) ||
    typeof grant.authority !== 'string' ||
    typeof grant.certificate !== 'string' ||
    typeof grant.serverName !== 'string' ||
    !/^[a-z0-9.-]{1,253}$/u.test(grant.serverName) ||
    !Array.isArray(grant.addresses) ||
    grant.addresses.length === 0 ||
    !grant.addresses.every((one) => typeof one === 'string' && /^[A-Za-z0-9.:[\]_-]{1,270}$/u.test(one))
  )
    throw failed('InvalidRequest', 'That isn’t what a home gives a worker.')
  return grant as Grant
}

/** What the home gave, written to the worker's folder; its agents and services set up and started. */
export const enroll = async (raw: unknown, out: (text: string) => void, first: ReadonlyArray<string> = []) => {
  const grant = grantOf(raw)
  const folder = workerFolder()
  const program = programFolder()
  const key = (await readPrivate(join(folder, 'worker.key'), 4096))?.toString('utf8')
  if (key === undefined) throw failed('NoKey', 'Set the worker up again: it has no key yet.')
  const certificate = new X509Certificate(grant.certificate)
  if (!certificate.checkIssued(new X509Certificate(grant.authority)) || !certificate.checkPrivateKey(createPrivateKey(key)))
    throw failed('WrongKey', 'The home signed another key than this worker’s.')
  say(out, { step: 'start', state: 'started' })
  // Enrolled before, with another home or as another worker: what it kept of that one's runs stays apart, under its name.
  const before = (await readPrivate(join(folder, 'enrollment'), 16384))?.toString('utf8').split('\n')
  if (before !== undefined && (before[0] !== grant.homeId || before[1] !== grant.workerId))
    await fs.rename(join(folder, 'journal'), join(folder, `journal-${before[1] ?? 'before'}`)).catch(() => undefined)
  await writePrivate(join(folder, 'home-ca.pem'), grant.authority, true)
  await writePrivate(join(folder, 'worker.pem'), grant.certificate, true)
  const addresses = [...new Set([...first, ...grant.addresses])]
  await writePrivate(join(folder, 'enrollment'), [grant.homeId, grant.workerId, grant.serverName, ...addresses].join('\n') + '\n', true)
  await privateDirectory(join(folder, 'journal'), true)
  await privateDirectory(join(folder, 'workspaces'), true)
  const current = join(program, 'current')
  await writeAgents(folder, current)
  await linkAll(folder, current)
  const { agents: found } = await checkAgents(folder)
  await writeUnits(folder, program)
  await systemctl('daemon-reload')
  await systemctl('enable', SERVICE, 'althar-worker-update.timer')
  await systemctl('restart', SERVICE)
  await systemctl('start', 'althar-worker-update.timer')
  say(out, { step: 'start', state: 'done', workerId: grant.workerId, agents: found })
  // A test run, so what would fail a task fails here: the sandbox started, and each signed-in agent started once.
  await check(out).catch((error: unknown) =>
    say(out, {
      step: 'check',
      state: 'failed',
      code: 'Failed',
      message: error instanceof Error ? error.message : 'The check couldn’t run.',
    }),
  )
}

/**
 * What the release ships for its agents' sandbox, linked into the worker's `bin` through `current`: the paths the running
 * release has them at, as `current` names them.
 */
const linkAll = async (folder: string, current: string) => {
  const release = await fs.realpath(running())
  const programs = Object.fromEntries(
    Object.entries(system.shipped(release)).map(([name, path]) => [name, path === undefined ? undefined : stable(path, release, current)]),
  )
  await linkShipped(folder, programs, system.check.executable)
}

/** The whole check (workerCheck.ts), said as a step: `check done` with what it found, by agent. */
export const check = async (out: (text: string) => void) => {
  const folder = workerFolder()
  const current = join(programFolder(), 'current')
  say(out, { step: 'check', state: 'started' })
  const signedIn = new Set((await checkAgents(folder)).agents.flatMap((agent) => (agent.signedIn ? [agent.id] : [])))
  const found = await checkWorker(
    {
      folder,
      current,
      program: programFolder(),
      agents: system.agents().map((agent) => ({
        id: agent.id,
        name: agent.definition.name,
        definition: agent.definition,
        signedIn: signedIn.has(agent.id),
      })),
    },
    system.check,
  )
  say(out, {
    step: 'check',
    state: 'done',
    sandbox: found.sandbox.starts
      ? { starts: true }
      : { starts: false, problem: found.sandbox.problem, ...(found.sandbox.fix === undefined ? {} : { fix: found.sandbox.fix }) },
    tools: found.tools,
    agents: found.agents.map(({ id, name, signedIn: signed, started, message, models }) => ({
      id,
      name,
      signedIn: signed,
      ...(started === undefined ? {} : { started }),
      ...(message === undefined ? {} : { message }),
      models: models.length,
    })),
  })
  return found
}

/**
 * Lets the sandbox start where only root may (newer Ubuntu's AppArmor rule for bubblewrap, or a kernel switch), with
 * `sudo -n` where this login may without a password; then checks again. Where it may not, the check's command stays for
 * an administrator to run, and this fails saying so.
 */
export const allowSandbox = async (out: (text: string) => void) => {
  const before = await check(out)
  if (before.sandbox.starts) return
  const fix = before.sandbox.fix
  // The check's own command, as `sudo sh -c '<script>'`: the script alone goes to sudo.
  const script = fix === undefined ? undefined : /^sudo sh -c '(.*)'$/u.exec(fix)?.[1]
  if (script === undefined) throw failed('SandboxUnfixable', 'Nothing Althar knows lets the sandbox start on this computer.')
  if (!(await system.sudo(script))) throw failed('NeedsAdministrator', 'This login can’t use sudo without a password here.')
  const after = await check(out)
  if (!after.sandbox.starts) throw failed('SandboxStillFails', 'The sandbox still can’t start after that.')
}

/** A code's way to a grant: ask the home at each address it gave, trusting only the authority it carries. */
export const join_ = async (code: string, name: string, out: (text: string) => void) => {
  const read = workerCodeOf(code)
  if (read === undefined) throw failed('InvalidRequest', 'That isn’t a worker code. Copy it again from Settings › Computers.')
  if (read.expiresAt <= Date.now()) throw failed('Expired', 'That code expired. Make a new one in Settings › Computers.')
  const authority = new X509Certificate(Buffer.from(read.authority, 'base64url')).toString()
  const folder = workerFolder()
  const key = (await readPrivate(join(folder, 'worker.key'), 4096))?.toString('utf8')
  if (key === undefined) throw failed('NoKey', 'Install the worker first.')
  const publicKey = createPublicKey(createPrivateKey(key)).export({ type: 'spki', format: 'der' }).toString('base64url')
  const body = JSON.stringify({ token: read.token, publicKey, name })
  say(out, { step: 'enroll', state: 'started' })
  let last = 'The home couldn’t be reached at any address the code gave.'
  for (const address of read.addresses) {
    const at = address.lastIndexOf(':')
    const host = address.slice(0, at).replace(/^\[|\]$/gu, '')
    try {
      const answer = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        const asked = request(
          {
            host,
            port: Number(address.slice(at + 1)),
            method: 'POST',
            path: '/v1/workers/enroll',
            ca: authority,
            servername: 'home.althar.invalid',
            timeout: 8_000,
            headers: { 'content-type': 'application/json' },
          },
          (response) => {
            const chunks: Buffer[] = []
            response.on('data', (chunk: Buffer) => chunks.push(chunk))
            response.on('end', () => {
              try {
                resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
              } catch (error) {
                reject(error)
              }
            })
          },
        )
        asked.on('timeout', () => asked.destroy(new Error('timed out')))
        asked.on('error', reject)
        asked.end(body)
      })
      if (answer.status !== 200) {
        const message = (answer.body as { message?: unknown }).message
        throw failed('Refused', typeof message === 'string' ? message : 'The home refused this worker.')
      }
      say(out, { step: 'enroll', state: 'done' })
      // The address that answered goes first: the home was there.
      return await enroll(answer.body, out, [`${address.slice(0, at)}:${(answer.body as { port?: number }).port ?? ''}`])
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'Refused') throw error
      last = `Couldn’t reach the home at ${address}.`
    }
  }
  throw failed('Unreachable', last)
}

export const listAgents = async (out: (text: string) => void) => {
  const folder = workerFolder()
  // The worker reads the file again with its heartbeats: the home hears of it within seconds, a task running or not.
  const { agents: found } = await checkAgents(folder)
  say(out, { step: 'agents', state: 'done', agents: found })
}

/** An agent's sign-in, as on a home: its steps said, a pasted code read from stdin; checked again once it ends. */
export const signIn = async (id: string, way: SignInWay, out: (text: string) => void) => {
  const agent = system.agents().find((one) => one.id === id)
  if (agent === undefined) throw failed('UnknownAgent', 'This worker has no such agent.')
  await new Promise<void>((resolve) => {
    const lines = createInterface({ input: process.stdin })
    let handle: ReturnType<typeof startSignInFlow> = null
    handle = startSignInFlow(
      agent.definition,
      (event) => {
        say(out, { step: 'sign-in', ...event })
        if (event.kind === 'done' || event.kind === 'failed') {
          lines.close()
          resolve()
        }
      },
      // The window opens what it would have opened: this worker has no browser.
      { way, node: process.execPath, openUrl: (url) => say(out, { step: 'sign-in', kind: 'open', url }) },
    )
    if (handle === null) {
      say(out, { step: 'sign-in', kind: 'failed', message: 'This agent doesn’t sign in that way here.' })
      lines.close()
      return resolve()
    }
    lines.on('line', (line) => {
      try {
        const message = JSON.parse(line) as { paste?: unknown; cancel?: unknown }
        if (typeof message.paste === 'string') handle?.paste(message.paste)
        if (message.cancel === true) {
          handle?.cancel()
          resolve()
        }
      } catch {
        // Not a message for it.
      }
    })
    lines.on('close', () => {
      handle?.cancel()
      resolve()
    })
  })
  await listAgents(out)
  // Signed in: started once, which also says its models there.
  await check(out).catch(() => undefined)
}

/**
 * The newer signed worker release, where there is one: verified against the key the worker was installed with. A worker
 * installed from a home's release, before workers had their own, moves to the worker's own release of the same version.
 */
export const update = async (out: (text: string) => void, fetcher: typeof fetch = fetch) => {
  const program = programFolder()
  const current = await fs.realpath(join(program, 'current'))
  const keys = [(await fs.readFile(join(current, '.release-key'), 'utf8')).trim()]
  const installed = authenticateRelease(await fs.readFile(join(current, '.manifest')), keys, process.arch === 'arm64' ? 'arm64' : 'x64')
  const moving = (installed.manifest.product ?? 'host') === 'host'
  const feed = (await readPrivate(join(workerFolder(), 'update-feed'), 2048))?.toString('utf8').trim()
  const bytes = feed === undefined || feed === '' ? await latestManifest(fetcher) : await getUpdateBytes(feed, 262_144, fetcher)
  let verified: ReturnType<typeof verifyRelease>
  try {
    verified = verifyRelease(bytes, {
      keys,
      arch: installed.manifest.arch,
      now: Date.now(),
      minimumSequence: installed.manifest.sequence,
      installedVersion: HOST_VERSION,
      product: 'worker',
      sameRelease: moving,
    })
  } catch {
    say(out, { step: 'update', state: 'current', version: HOST_VERSION })
    // Hourly, and not while it works: its check again, for what changed on it (a lead's fix, a sign-in run out).
    if (!(await busy())) await check(out).catch(() => undefined)
    return
  }
  if (await busy()) return say(out, { step: 'update', state: 'waiting', version: verified.manifest.version })
  // A release in parts comes as its base, and only those of its parts no release here has already.
  const parts = verified.manifest.parts
  const first = parts?.base ?? {
    ...verified.manifest.archive,
    files: verified.manifest.files,
    unpackedBytes: verified.manifest.unpackedBytes,
  }
  const target = join(program, `bundle-${first.sha256}`)
  const scratch = join(program, `.update-${process.pid}`)
  await fs.rm(scratch, { recursive: true, force: true })
  await privateDirectory(scratch, true)
  let completed: Completed | undefined
  try {
    await downloadRelease(first, join(scratch, 'release.tar.gz'), fetcher)
    await extractRelease(join(scratch, 'release.tar.gz'), join(scratch, 'release'), first)
    await fs.rm(join(scratch, 'release.tar.gz'))
    if (parts !== undefined)
      completed = await completeRelease(join(scratch, 'release'), parts.of, {
        donors: await releasesHere(program, current),
        scratch,
        fetcher,
        free: system.free,
      })
    await fs.writeFile(join(scratch, 'release', '.manifest'), bytes, { mode: 0o600 })
    await fs.writeFile(join(scratch, 'release', '.release-key'), `${keys[0]}\n`, { mode: 0o600 })
    await fs.rm(target, { recursive: true, force: true })
    await fs.rename(join(scratch, 'release'), target)
  } finally {
    await fs.rm(scratch, { recursive: true, force: true })
  }
  await pointAt(program, target)
  await writePrivate(join(workerFolder(), 'release'), `${verified.manifest.version}\n`, true)
  await writeAgents(workerFolder(), join(program, 'current'))
  await linkAll(workerFolder(), join(program, 'current'))
  // Its update runs from the release it's on: a worker's own runs its own entry.
  await writeUnits(workerFolder(), program)
  await systemctl('daemon-reload')
  await systemctl('restart', SERVICE)
  // The release before it stays, for a step back; older ones go.
  // By name: `current` is a real path, which a folder reached through a link doesn't spell the same.
  for (const entry of await fs.readdir(program))
    if (entry.startsWith('bundle-') && entry !== basename(target) && entry !== basename(current))
      await fs.rm(join(program, entry), { recursive: true, force: true })
  say(out, {
    step: 'update',
    state: 'done',
    version: verified.manifest.version,
    ...(completed === undefined ? {} : { lent: completed.lent, downloaded: completed.downloaded }),
  })
}

/** The releases on this computer a part may be lent from: the one it runs first, then the rest. */
const releasesHere = async (program: string, current?: string) => {
  const others = (await fs.readdir(program).catch(() => [] as string[]))
    .filter((entry) => entry.startsWith('bundle-'))
    .map((entry) => join(program, entry))
    .filter((path) => path !== current)
  return current === undefined ? others : [current, ...others]
}

/**
 * A release the bootstrap unpacked from its base (`bundle-<base>`), made whole: each of its parts lent from a release
 * already here or downloaded, said as the download's progress, from the base's bytes on. A whole release, or one with no
 * signed manifest beside it, is left as it is.
 */
const completeInstalled = async (release: string, out: (text: string) => void, fetcher: typeof fetch) => {
  const [manifest, key] = await Promise.all([
    fs.readFile(join(release, '.manifest')).catch(() => undefined),
    fs.readFile(join(release, '.release-key'), 'utf8').catch(() => undefined),
  ])
  if (manifest === undefined || key === undefined) return
  const parts = authenticateRelease(manifest, [key.trim()], process.arch === 'arm64' ? 'arm64' : 'x64').manifest.parts
  if (parts === undefined || basename(release) !== `bundle-${parts.base.sha256}`) return
  const total = parts.of.reduce((sum, part) => sum + part.bytes, parts.base.bytes)
  const scratch = join(dirname(release), `.install-${process.pid}`)
  await fs.rm(scratch, { recursive: true, force: true })
  await privateDirectory(scratch, true)
  let said = 0
  try {
    await completeRelease(release, parts.of, {
      donors: (await releasesHere(dirname(release))).filter((path) => path !== release),
      scratch,
      fetcher,
      free: system.free,
      // At most once a second: the window shows it as the download's progress.
      progress: (bytes) => {
        if (Date.now() - said < 1000) return
        said = Date.now()
        say(out, { step: 'get', state: 'progress', bytes: parts.base.bytes + bytes, totalBytes: total })
      },
    })
  } catch (error) {
    // Where it can't download them, the window sends the whole release from its own computer instead.
    if (error instanceof HostError && error.code === 'UpdateUnavailable') throw failed('CannotDownload', error.message)
    // As the bootstrap says it of the base.
    if (error instanceof NoRoom) throw failed('NotEnoughDisk', error.message)
    throw error
  } finally {
    await fs.rm(scratch, { recursive: true, force: true })
  }
  say(out, { step: 'get', state: 'done', bytes: total, totalBytes: total })
}

const latestManifest = async (fetcher: typeof fetch) => {
  const asset = `althar-worker-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}.json`
  const listed = JSON.parse(
    new TextDecoder().decode(
      await getUpdateBytes('https://api.github.com/repos/AltharIDE/althar/releases?per_page=30', 2_097_152, fetcher),
    ),
  ) as ReadonlyArray<{
    tag_name?: string
    draft?: boolean
    prerelease?: boolean
    assets?: ReadonlyArray<{ name?: string; browser_download_url?: string }>
  }>
  for (const release of listed) {
    if (release.draft === true || release.prerelease === true || !/^host-v\d+\.\d+\.\d+$/u.test(release.tag_name ?? '')) continue
    const url = release.assets?.find((one) => one.name === asset)?.browser_download_url
    if (url !== undefined) return getUpdateBytes(url, 262_144, fetcher)
  }
  throw failed('NoRelease', 'No release to update to.')
}

/** `althar-host worker …`: the window's, over SSH or with a code. Exits 1 with its words where it can't. */
export const workerMain = async (args: ReadonlyArray<string>, out: (text: string) => void): Promise<number> => {
  const [command, ...rest] = args
  const flag = (name: string) => {
    const at = rest.indexOf(name)
    return at === -1 ? undefined : rest[at + 1]
  }
  try {
    switch (command) {
      case 'install':
        await install(flag('--program') ?? '', out)
        return 0
      case 'enroll': {
        const grant: unknown = JSON.parse(Buffer.from(flag('--grant') ?? '', 'base64url').toString('utf8'))
        // The computer this was set up from, where that is the home: first, on the home's worker port.
        const host = flag('--first') ?? ''
        const port = (grant as { port?: unknown }).port
        const first = host === '' || typeof port !== 'number' ? [] : [`${host.includes(':') ? `[${host}]` : host}:${port}`]
        await enroll(grant, out, first)
        return 0
      }
      case 'join':
        await join_(flag('--code') ?? '', flag('--name') ?? '', out)
        return 0
      case 'agents':
        await listAgents(out)
        return 0
      case 'sign-in': {
        const way = flag('--way') === 'device' ? 'device' : 'browser'
        await signIn(flag('--agent') ?? '', way, out)
        return 0
      }
      case 'update':
        await update(out)
        return 0
      case 'check':
        await check(out)
        return 0
      case 'version':
        // What a release says it is, for its packaging to check against what it signs (updates/publish.ts).
        say(out, { step: 'version', state: 'done', version: HOST_VERSION, arch: process.arch === 'arm64' ? 'arm64' : 'x64' })
        return 0
      case 'sandbox':
        await allowSandbox(out)
        return 0
      case 'tools':
        // Plain lines, which the worker keeps as its setup's output: `path\t<folder>` for each tool, or why not.
        try {
          await installTools(join(workerFolder(), 'tools'), rest, out)
          return 0
        } catch (error) {
          out(`${error instanceof Error ? error.message : 'A tool couldn’t be installed.'}\n`)
          return 1
        }
      default:
        say(out, { step: 'worker', state: 'failed', code: 'InvalidRequest', message: 'Unknown worker command.' })
        return 64
    }
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'Failed'
    const message = error instanceof Error ? error.message : 'The worker couldn’t be set up.'
    say(out, { step: command ?? 'worker', state: 'failed', code, message })
    return 1
  }
}
