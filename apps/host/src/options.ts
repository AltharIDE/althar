import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import { HostError } from './errors'

export const USAGE = `Usage: althar-host <command> [options]

Commands:
  init             Initialize a private profile and a separate encryption key
  serve            Run the home until stopped
  status           Check the running home's private API
  install-service  Install a systemd user service

Options:
  --profile <dir>             Host profile (default: XDG data/althar-host)
  --worktrees <dir>           Task worktrees (default: <profile>/worktrees)
  --key-file <file>           Separate 32-byte master key; never a project file
  --project <dir>             Add an existing repository during init; repeatable
  --json                     Print machine-readable command results
  --wait                     Wait up to 30 seconds for status to become ready
  --service-name <name>       systemd unit name (default: althar-host)
  --encrypted-credential <file>  Use systemd LoadCredentialEncrypted
  --start                    Enable and start the installed service
  --help                     Show this help
  --version                  Print the host version

Local API access is private and restricted. SSH bootstrap, paired-client
setup and distributed workers are separate features.`

export interface HostOptions {
  readonly command: 'init' | 'serve' | 'status' | 'install-service' | 'help' | 'version'
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
  let command: HostOptions['command'] | undefined
  const values = new Set(['--profile', '--worktrees', '--key-file', '--project', '--service-name', '--encrypted-credential'])
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
      else {
        if (flags.has(arg)) return invalid('A host option was provided more than once.')
        flags.set(arg, value)
      }
      index += 1
    } else if (['--json', '--wait', '--start'].includes(arg)) {
      if (switches.has(arg)) return invalid('A host switch was provided more than once.')
      switches.add(arg)
    } else if (['init', 'serve', 'status', 'install-service'].includes(arg) && command === undefined) {
      // Membership above is the complete command list; the explicit switch keeps the public union checked.
      switch (arg) {
        case 'init':
        case 'serve':
        case 'status':
        case 'install-service':
          command = arg
      }
    } else return invalid('Unknown host command or option. Run althar-host --help.')
  }
  command ??= 'help'
  if (projects.length > 0 && command !== 'init') return invalid('--project is available only during init.')
  if (switches.has('--wait') && command !== 'status') return invalid('--wait is available only for status.')
  if ((switches.has('--start') || flags.has('--service-name') || flags.has('--encrypted-credential')) && command !== 'install-service')
    return invalid('Service options are available only for install-service.')
  const serviceName = flags.get('--service-name') ?? 'althar-host'
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(serviceName))
    return invalid('Use 1–60 letters, numbers, hyphens or underscores for the service name.')
  const data = directory(env.XDG_DATA_HOME, join(home, '.local', 'share'))
  const config = directory(env.XDG_CONFIG_HOME, join(home, '.config'))
  const profileValue = flags.get('--profile') ?? env.ALTHAR_HOST_PROFILE ?? join(data, 'althar-host')
  if (!clean(profileValue)) return invalid('The profile path must not be empty or contain control characters.')
  const profile = resolve(profileValue)
  const delivered =
    command === 'serve' && env.CREDENTIALS_DIRECTORY ? join(directory(env.CREDENTIALS_DIRECTORY, ''), 'master-key') : undefined
  const keyValue = flags.get('--key-file') ?? delivered ?? join(config, 'althar-host', 'master-key')
  return {
    command,
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
  }
}
