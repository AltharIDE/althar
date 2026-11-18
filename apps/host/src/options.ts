import type { NetworkConfiguration } from './network'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import { HostError } from './errors'

export const USAGE = `Usage: althar-host <command> [options]

Commands:
  configure-network  Configure opt-in direct HTTPS/WSS access; restart to apply
  disable-network  Disable direct access on the next restart
  pair             Print a single-use, five-minute device pairing code
  devices          List this home's registered client devices
  revoke-device    Revoke a connection device immediately
  init             Initialize a private profile and a separate encryption key
  serve            Run the home until stopped
  status           Check the running home's private API
  connect-stdio    Carry a socket-authority API connection over SSH stdio
  install-service  Install a systemd user service
  configure-updates  Configure verified release downloads and managed installation
  update           Check/download a release; --apply explicitly restarts the host
  update-status    Show installed/staged versions and the last update result
  release-info     Print this executable's update compatibility metadata
  package-release  Assemble and sign a release (release CI only)

Options:
  --origin <https-origin>    Address clients use to reach this home
  --listen-address <ip>      Bind address (default: 127.0.0.1)
  --listen-port <port>       HTTPS/WSS port (default: 6769)
  --tls-certificate <file>   Private RSA/ECDSA PEM certificate file
  --tls-key <file>           Matching PEM key outside profile/worktrees
  --after <dev_id>           Read the next page of devices
  --device-id <dev_id>       Connection device to revoke
  --profile <dir>             Host profile (default: XDG data/althar-host)
  --worktrees <dir>           Task worktrees (default: <profile>/worktrees)
  --key-file <file>           Separate 32-byte master key; never a project file
  --project <dir>             Add an existing repository during init; repeatable
  --json                     Print machine-readable command results
  --wait                     Wait for status (30s) or an update result (15min)
  --service-name <name>       systemd unit name (default: althar-host)
  --encrypted-credential <file>  Use systemd LoadCredentialEncrypted
  --start                    Enable and start the installed service
  --installation <dir>       Managed program directory, separate from project data
  --release-key <file>        Trusted Ed25519 public key; repeatable for rotation
  --update-feed <https-url>   Custom signed feed; otherwise use Althar GitHub releases
  --automatic-updates        Apply compatible staged releases on the next service start
  --manual-updates           Require explicit application (default)
  --apply                    Restart into the staged release; may interrupt work
  --allow-incompatible       Explicitly approve an API or storage-format change
  --help                     Show this help
  --home-id <home_id>         Expected home for connect-stdio
  --client-api-version <n>    Client API version for connect-stdio
  --version                  Print the host version

Local API access is private and restricted. SSH bootstrap, paired-client
setup and distributed workers are separate features.`

export interface HostOptions {
  readonly command:
    | 'configure-network'
    | 'disable-network'
    | 'pair'
    | 'devices'
    | 'revoke-device'
    | 'init'
    | 'serve'
    | 'status'
    | 'connect-stdio'
    | 'install-service'
    | 'configure-updates'
    | 'update'
    | 'update-status'
    | 'release-info'
    | 'verify-release'
    | 'package-release'
    | 'update-worker'
    | 'recover-update'
    | 'recover-locked'
    | 'prepare-update'
    | 'help'
    | 'version'
  readonly network?: NetworkConfiguration
  readonly deviceAfter?: string
  readonly revokeDeviceId?: string
  readonly profile: string
  readonly worktrees: string
  readonly worktreesExplicit: boolean
  readonly keyFile: string
  readonly projects: ReadonlyArray<string>
  readonly json: boolean
  readonly wait: boolean
  readonly start: boolean
  readonly serviceName: string
  readonly unitDirectory: string
  readonly encryptedCredential: string | undefined
  readonly installation: string | undefined
  readonly updateRoot: string
  readonly releaseKeys: ReadonlyArray<string>
  readonly updateFeed: string | undefined
  readonly automaticUpdates: boolean | undefined
  readonly applyUpdate: boolean
  readonly allowIncompatible: boolean
  readonly releaseBaseURL: string | undefined
  readonly releaseSequence: number | undefined
  readonly releaseOutput: string
  readonly controllerPid: number | undefined
  readonly expectedHome: string | undefined
  readonly clientApiVersion: number | undefined
}

const invalid = (message: string): never => {
  throw new HostError({ code: 'InvalidConfig', message })
}
const clean = (value: string) =>
  value.length > 0 && !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
const directory = (value: string | undefined, fallback: string) => {
  if (value === undefined || value === '') return fallback
  if (!isAbsolute(value) || !clean(value))
    return invalid('XDG directories and delivered credential directories must be absolute paths without control characters.')
  return value
}

/** Reads configuration only. In particular, serve never creates or rotates a missing key. */
export const parseOptions = (args: ReadonlyArray<string>, env: NodeJS.ProcessEnv = process.env, home = homedir()): HostOptions => {
  const flags = new Map<string, string>()
  const switches = new Set<string>()
  const projects: string[] = []
  const releaseKeys: string[] = []
  let command: HostOptions['command'] | undefined
  const values = new Set([
    '--origin',
    '--listen-address',
    '--listen-port',
    '--tls-certificate',
    '--tls-key',
    '--device-id',
    '--after',
    '--home-id',
    '--client-api-version',
    '--profile',
    '--worktrees',
    '--key-file',
    '--project',
    '--service-name',
    '--encrypted-credential',
    '--installation',
    '--release-key',
    '--update-feed',
    '--release-base-url',
    '--release-sequence',
    '--output',
    '--controller-pid',
  ])
  const commands = new Set([
    'configure-network',
    'disable-network',
    'pair',
    'devices',
    'revoke-device',
    'connect-stdio',
    'init',
    'serve',
    'status',
    'install-service',
    'configure-updates',
    'update',
    'update-status',
    'release-info',
    'verify-release',
    'package-release',
    'update-worker',
    'recover-update',
    'recover-locked',
    'prepare-update',
  ])
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (arg === '--help' || arg === '-h') {
      command = 'help'
      continue
    }
    if (arg === '--version') {
      command = 'version'
      continue
    }
    if (values.has(arg)) {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--') || !clean(value))
        return invalid('This host option needs a value without control characters.')
      if (arg === '--project') projects.push(resolve(value))
      else if (arg === '--release-key') releaseKeys.push(resolve(value))
      else {
        if (flags.has(arg)) return invalid('A host option was provided more than once.')
        flags.set(arg, value)
      }
      index += 1
    } else if (
      ['--json', '--wait', '--start', '--automatic-updates', '--manual-updates', '--apply', '--allow-incompatible'].includes(arg)
    ) {
      if (switches.has(arg)) return invalid('A host switch was provided more than once.')
      switches.add(arg)
    } else if (commands.has(arg) && command === undefined) {
      // Membership above is the complete command list; the explicit switch keeps the public union checked.
      switch (arg) {
        case 'configure-network':
        case 'disable-network':
        case 'pair':
        case 'devices':
        case 'revoke-device':
        case 'init':
        case 'serve':
        case 'status':
        case 'connect-stdio':
        case 'install-service':
        case 'configure-updates':
        case 'update':
        case 'update-status':
        case 'release-info':
        case 'verify-release':
        case 'package-release':
        case 'update-worker':
        case 'recover-update':
        case 'recover-locked':
        case 'prepare-update':
          command = arg
      }
    } else return invalid('Unknown host command or option. Run althar-host --help.')
  }
  command ??= 'help'
  if (command === 'connect-stdio') {
    if (
      !/^home_[a-f0-9]{32}$/.test(flags.get('--home-id') ?? '') ||
      !Number.isSafeInteger(Number(flags.get('--client-api-version'))) ||
      Number(flags.get('--client-api-version')) < 1
    )
      return invalid('connect-stdio requires --home-id and a positive --client-api-version.')
    if (switches.has('--json')) return invalid('connect-stdio uses framed binary output, not JSON lines.')
  } else if (flags.has('--home-id') || flags.has('--client-api-version'))
    return invalid('Connection identity options require connect-stdio.')
  if (projects.length > 0 && command !== 'init') return invalid('--project is available only during init.')
  if (switches.has('--wait') && command !== 'status' && command !== 'update')
    return invalid('--wait is available only for status or update.')
  if (
    (switches.has('--start') || flags.has('--service-name') || flags.has('--encrypted-credential')) &&
    command !== 'install-service' &&
    command !== 'configure-updates'
  )
    return invalid('Service options are available only for install-service.')
  if (
    (releaseKeys.length > 0 || flags.has('--update-feed') || switches.has('--automatic-updates') || switches.has('--manual-updates')) &&
    command !== 'configure-updates'
  )
    return invalid('Update configuration options require configure-updates.')
  if (switches.has('--automatic-updates') && switches.has('--manual-updates')) return invalid('Choose one update application policy.')
  if ((switches.has('--apply') || switches.has('--allow-incompatible')) && command !== 'update')
    return invalid('Update application options require update.')
  if (switches.has('--allow-incompatible') && !switches.has('--apply')) return invalid('--allow-incompatible requires --apply.')
  if ((flags.has('--release-base-url') || flags.has('--release-sequence') || flags.has('--output')) && command !== 'package-release')
    return invalid('Release packaging options require package-release.')
  if (flags.has('--controller-pid') && command !== 'recover-update' && command !== 'recover-locked')
    return invalid('The controller process option is internal to managed service startup.')
  if (
    ['--origin', '--listen-address', '--listen-port', '--tls-certificate', '--tls-key'].some((flag) => flags.has(flag)) &&
    command !== 'configure-network'
  )
    return invalid('Network settings require configure-network.')
  if (flags.has('--after') && (command !== 'devices' || !/^dev_[0-9a-f]{32}$/.test(flags.get('--after') ?? '')))
    return invalid('--after requires devices and a device id from the previous page.')
  if (flags.has('--device-id') && command !== 'revoke-device') return invalid('--device-id requires revoke-device.')
  if (command === 'revoke-device' && !/^dev_[0-9a-f]{32}$/.test(flags.get('--device-id') ?? ''))
    return invalid('Choose a device id from althar-host devices.')
  if (command === 'configure-network') {
    if (!flags.has('--origin') || !flags.has('--tls-certificate') || !flags.has('--tls-key'))
      return invalid('configure-network requires --origin, --tls-certificate and --tls-key.')
    const port = Number(flags.get('--listen-port') ?? '6769')
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return invalid('Use a listen port from 1 to 65535.')
  }
  const serviceName = flags.get('--service-name') ?? 'althar-host'
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(serviceName))
    return invalid('Use 1–60 letters, numbers, hyphens or underscores for the service name.')
  const data = directory(env.XDG_DATA_HOME, join(home, '.local', 'share'))
  const config = directory(env.XDG_CONFIG_HOME, join(home, '.config'))
  const profileValue = flags.get('--profile') ?? env.ALTHAR_HOST_PROFILE ?? join(data, 'althar-host')
  if (!clean(profileValue)) return invalid('The profile path must not be empty or contain control characters.')
  const profile = resolve(profileValue)
  const releaseSequence = flags.has('--release-sequence') ? Number(flags.get('--release-sequence')) : undefined
  if (releaseSequence !== undefined && (!Number.isSafeInteger(releaseSequence) || releaseSequence < 1))
    return invalid('The release sequence must be a positive safe integer.')
  const controllerPid = flags.has('--controller-pid') ? Number(flags.get('--controller-pid')) : undefined
  if (controllerPid !== undefined && (!Number.isSafeInteger(controllerPid) || controllerPid < 1))
    return invalid('The update controller process is invalid.')
  const delivered =
    command === 'serve' && env.CREDENTIALS_DIRECTORY ? join(directory(env.CREDENTIALS_DIRECTORY, ''), 'master-key') : undefined
  const keyValue = flags.get('--key-file') ?? delivered ?? join(config, 'althar-host', 'master-key')
  return {
    command,
    ...(command !== 'configure-network'
      ? {}
      : {
          network: {
            version: 1 as const,
            origin: flags.get('--origin') ?? '',
            address: flags.get('--listen-address') ?? '127.0.0.1',
            port: Number(flags.get('--listen-port') ?? '6769'),
            certificate: resolve(flags.get('--tls-certificate') ?? ''),
            key: resolve(flags.get('--tls-key') ?? ''),
          },
        }),
    ...(flags.has('--after') ? { deviceAfter: flags.get('--after') ?? '' } : {}),
    ...(flags.has('--device-id') ? { revokeDeviceId: flags.get('--device-id') ?? '' } : {}),
    profile,
    worktrees: resolve(flags.get('--worktrees') ?? join(profile, 'worktrees')),
    worktreesExplicit: flags.has('--worktrees'),
    keyFile: resolve(keyValue),
    projects,
    json: switches.has('--json'),
    wait: switches.has('--wait'),
    start: switches.has('--start'),
    serviceName,
    unitDirectory: join(config, 'systemd', 'user'),
    encryptedCredential: flags.has('--encrypted-credential') ? resolve(flags.get('--encrypted-credential') ?? '') : undefined,
    installation: flags.has('--installation') ? resolve(flags.get('--installation') ?? '') : undefined,
    updateRoot: resolve(flags.get('--installation') ?? join(data, 'althar-host-program')),
    releaseKeys,
    updateFeed: flags.get('--update-feed'),
    automaticUpdates: switches.has('--automatic-updates') ? true : switches.has('--manual-updates') ? false : undefined,
    applyUpdate: switches.has('--apply'),
    allowIncompatible: switches.has('--allow-incompatible'),
    releaseBaseURL: flags.get('--release-base-url'),
    releaseSequence,
    releaseOutput: resolve(flags.get('--output') ?? 'out/host'),
    controllerPid,
    expectedHome: flags.get('--home-id'),
    clientApiVersion: flags.has('--client-api-version') ? Number(flags.get('--client-api-version')) : undefined,
  }
}
