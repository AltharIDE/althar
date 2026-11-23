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
import { newKey } from '@althar/transport-node'
import { Effect } from 'effect'

import { HOST_VERSION } from './home'
import { privateDirectory, readPrivate, writePrivate } from './privateFiles'
import { authenticateRelease, verifyRelease } from './updates/release'
import { downloadRelease, getUpdateBytes } from './updates/network'
import { extractRelease } from './updates/archive'

/*
 * A worker, set up from the window (ADR-103): the same signed release a home installs, run as a worker. Nobody types
 * any of this. The window's SSH setup runs it on the worker (`bootstrap/ssh.sh`'s `worker-` operations), and a machine
 * without SSH runs `join` with a one-time code. Each prints JSON lines the window reads.
 *
 * - `install --program <release>`: points the worker's `current` program at the release it was just given, makes the
 *   worker's own P-256 key where it has none, and says its public key. The key never leaves the worker.
 * - `enroll --grant <base64url>`: what the home gave once it signed that key, written to the worker's folder; its
 *   agents, from the release (the ACP adapters and the agents' own programs ship in it); and its services, started.
 * - `join --code <code>`: a code's way to the same, asking the home itself.
 * - `agents`: which agents it has and which are signed in, kept where the worker reads it at each hello.
 * - `sign-in --agent <id> --way <browser|device>`: the agent's own sign-in, as Althar runs it on a home, its steps
 *   said as JSON lines; a code pasted back comes in on stdin.
 * - `update`: its timer's, hourly: a newer signed release, from where the home's come from, verified, unpacked and
 *   switched to while the worker runs no task, and the worker started again on it.
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
    const env = Object.entries({ ...spec.env, PATH: `${dirname(node)}:/usr/local/bin:/usr/bin:/bin` })
      .map(([name, value]) => `export ${name}=${shellQuoted(stable(value, release, current))}`)
      .join('\n')
    const command = [stable(spec.command, release, current), ...spec.args.map((arg) => stable(arg, release, current))]
    const script = `#!/bin/sh\n${env}\nexec ${command.map(shellQuoted).join(' ')} "$@"\n`
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
  return { agents: checked, changed: was !== null && was !== now }
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
}
let system: WorkerSystem = {
  systemctl: async (args) => (await run('systemctl', ['--user', ...args], { timeout: 30_000 })).stdout,
  signedIn: async (agent) => (await Effect.runPromise(signInCheck(agent, process.execPath))).status === 'signed_in',
  agents: shipped,
}
/** For tests: the system it runs on, in part; puts it back when called. */
export const withWorkerSystem = (given: Partial<WorkerSystem>) => {
  const was = system
  system = { ...system, ...given }
  return () => {
    system = was
  }
}

/** The worker says its agents again once it starts again: then, unless it runs a task, when it would cut that off. */
const restartIdle = async () => {
  if (await busy()) return false
  await systemctl('try-restart', SERVICE)
  return true
}

const renderUnits = (folder: string, program: string) => {
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
ExecStart=${join(current, 'node', 'bin', 'node')} ${join(current, 'dist', 'althar-host.js')} worker update
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

const failed = (code: string, message: string) => Object.assign(new Error(message), { code })

/** Points `current` at a release, atomically: a link made beside it and renamed over it. */
const pointAt = async (program: string, release: string) => {
  const link = join(program, `.current-${process.pid}`)
  await fs.rm(link, { force: true })
  await fs.symlink(release, link)
  await fs.rename(link, join(program, 'current'))
}

export const install = async (releaseFolder: string, out: (text: string) => void) => {
  const folder = workerFolder()
  const program = programFolder()
  const release = resolve(releaseFolder)
  if (dirname(release) !== program || !basename(release).startsWith('bundle-')) throw failed('InvalidRequest', 'Not a worker release.')
  await fs.access(join(release, 'althar-worker'), fs.constants.X_OK).catch(() => {
    throw failed('NoWorker', 'This release carries no worker.')
  })
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
  const { agents: found } = await checkAgents(folder)
  const units = unitsFolder()
  await fs.mkdir(units, { recursive: true, mode: 0o700 })
  for (const [name, text] of Object.entries(renderUnits(folder, program))) await writePrivate(join(units, name), text, true)
  await systemctl('daemon-reload')
  await systemctl('enable', SERVICE, 'althar-worker-update.timer')
  await systemctl('restart', SERVICE)
  await systemctl('start', 'althar-worker-update.timer')
  say(out, { step: 'start', state: 'done', workerId: grant.workerId, agents: found })
}

/** A code's way to a grant: ask the home at each address it gave, trusting only the authority it carries. */
export const join_ = async (code: string, name: string, out: (text: string) => void) => {
  const { workerCodeOf } = await import('@althar/runtime/workerHome')
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
  const { agents: found, changed } = await checkAgents(folder)
  const restarted = changed ? await restartIdle() : false
  say(out, { step: 'agents', state: 'done', agents: found, restarted })
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
}

/** The newer signed release, where there is one: verified against the key the worker was installed with. */
export const update = async (out: (text: string) => void, fetcher: typeof fetch = fetch) => {
  const program = programFolder()
  const current = await fs.realpath(join(program, 'current'))
  const keys = [(await fs.readFile(join(current, '.release-key'), 'utf8')).trim()]
  const installed = authenticateRelease(await fs.readFile(join(current, '.manifest')), keys, process.arch === 'arm64' ? 'arm64' : 'x64')
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
    })
  } catch {
    return say(out, { step: 'update', state: 'current', version: HOST_VERSION })
  }
  if (await busy()) return say(out, { step: 'update', state: 'waiting', version: verified.manifest.version })
  const target = join(program, `bundle-${verified.manifest.archive.sha256}`)
  const scratch = join(program, `.update-${process.pid}`)
  await fs.rm(scratch, { recursive: true, force: true })
  await privateDirectory(scratch, true)
  try {
    await downloadRelease(verified.manifest.archive, join(scratch, 'release.tar.gz'), fetcher)
    await extractRelease(join(scratch, 'release.tar.gz'), join(scratch, 'release'), verified.manifest)
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
  await systemctl('daemon-reload')
  await systemctl('restart', SERVICE)
  // The release before it stays, for a step back; older ones go.
  for (const entry of await fs.readdir(program))
    if (entry.startsWith('bundle-') && join(program, entry) !== target && join(program, entry) !== current)
      await fs.rm(join(program, entry), { recursive: true, force: true })
  say(out, { step: 'update', state: 'done', version: verified.manifest.version })
}

const latestManifest = async (fetcher: typeof fetch) => {
  const asset = `althar-host-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}.json`
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
