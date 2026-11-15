import { execFile } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

import { Effect, Schema } from 'effect'

import { HostError, storageFailure } from './errors'
import type { HostOptions } from './options'
import { privateDirectory, readPrivate, writePrivate } from './privateFiles'
import { externalKeyFile, openVault, VaultMetadata } from './vault'

const MARKER = '# Althar host service v1'
export interface ServiceCommands {
  readonly node: string
  readonly entry: string
  readonly path: string
  readonly run?: (command: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv, signal?: AbortSignal) => Promise<void>
}

const quote = (value: string, specifier = false) => {
  if (Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    throw new HostError({ code: 'InvalidConfig', message: 'Service paths and environment must not contain control characters.' })
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('%', specifier ? '%' : '%%')}"`
}

/** No PrivateTmp: clients outside the unit must reach the already-private API socket through SSH forwarding. */
export const renderService = (options: HostOptions, commands: ServiceCommands): string => {
  if (![commands.node, commands.entry, options.profile, options.worktrees, options.keyFile].every(isAbsolute))
    throw new HostError({ code: 'InvalidConfig', message: 'The service requires absolute executable, profile and credential paths.' })
  const credential = options.encryptedCredential ?? options.keyFile
  const program =
    options.installation === undefined
      ? [commands.node, commands.entry, 'serve']
      : ['/bin/sh', join(options.installation, 'launcher'), 'serve', '--installation', options.installation]
  const start = [...program, '--profile', options.profile, '--worktrees', options.worktrees].map((part) => quote(part)).join(' ')
  return `${MARKER}
[Unit]
Description=Althar project home
After=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=notify
NotifyAccess=all
${options.encryptedCredential === undefined ? 'LoadCredential' : 'LoadCredentialEncrypted'}=${quote(`master-key:${credential}`)}
ExecStart=:${start} "--key-file" ${quote('%d/master-key', true)}
WorkingDirectory=%h
Environment=${quote(`PATH=${commands.path}`)}
UMask=0077
NoNewPrivileges=true
ProtectSystem=full
RestrictSUIDSGID=true
Restart=on-failure
RestartPreventExitStatus=64 78
RestartSec=5s
TimeoutStartSec=120s
TimeoutStopSec=90s
KillMode=control-group
LogRateLimitIntervalSec=30s
LogRateLimitBurst=1000

[Install]
WantedBy=default.target
`
}

export const runExternal = async (
  command: string,
  args: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
) => {
  try {
    await promisify(execFile)(command, [...args], {
      env,
      ...(signal === undefined ? {} : { signal }),
      timeout: 30_000,
      maxBuffer: 65_536,
      windowsHide: true,
    })
  } catch {
    throw new HostError({
      code: 'ServiceUnavailable',
      message:
        'The Linux service manager could not complete this request. Check the systemd user session, credentials and service journal.',
    })
  }
}

export const installService = (options: HostOptions, commands: ServiceCommands) =>
  Effect.gen(function* () {
    if (options.encryptedCredential === undefined) yield* Effect.scoped(openVault(options))
    else
      yield* Effect.tryPromise({
        try: async () => {
          const profile = await privateDirectory(options.profile)
          const metadata = await readPrivate(join(profile, 'host-vault.json'), 4096)
          if (metadata === null)
            throw new HostError({ code: 'NotInitialized', message: 'Initialize this host before installing its service.' })
          Schema.decodeUnknownSync(VaultMetadata)(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadata)))
          const path = await externalKeyFile({ ...options, keyFile: options.encryptedCredential ?? '' }, profile)
          const credential = await readPrivate(path, 65_536)
          if (credential === null || credential.length === 0)
            throw new HostError({ code: 'InvalidConfig', message: 'The OS-sealed service credential is missing or empty.' })
        },
        catch: storageFailure,
      })
    const path = yield* Effect.tryPromise({
      try: async () => {
        await privateDirectory(options.unitDirectory, true)
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(options.serviceName))
          throw new HostError({ code: 'InvalidConfig', message: 'The service name is invalid.' })
        const path = join(options.unitDirectory, `${options.serviceName}.service`)
        const previous = await readPrivate(path, 65_536)
        if (previous !== null && !previous.toString('utf8').startsWith(`${MARKER}\n`))
          throw new HostError({
            code: 'InvalidConfig',
            message: 'This unit is not managed by Althar. Choose another service name or move the existing unit first.',
          })
        await writePrivate(path, renderService(options, commands), true)
        return path
      },
      catch: storageFailure,
    })
    const run = commands.run ?? runExternal
    yield* Effect.tryPromise({
      try: (signal) => run('systemctl', ['--user', 'daemon-reload'], undefined, signal),
      catch: (error) =>
        error instanceof HostError
          ? error
          : new HostError({ code: 'ServiceUnavailable', message: 'The systemd user manager could not reload the installed service.' }),
    })
    if (options.start)
      yield* Effect.tryPromise({
        try: (signal) => run('systemctl', ['--user', 'enable', '--now', `${options.serviceName}.service`], undefined, signal),
        catch: (error) =>
          error instanceof HostError
            ? error
            : new HostError({
                code: 'ServiceUnavailable',
                message: 'The systemd user manager could not start the installed service. Read its journal for the cause.',
              }),
      })
    return path
  })
