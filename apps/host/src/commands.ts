import { Cause, Effect, Option } from 'effect'

import { configuredHome } from './configuration'
import { HostError, storageFailure } from './errors'
import { HOST_VERSION, initializeHome, serveHome, type HostDependencies } from './home'
import { type HostOptions, USAGE } from './options'
import { installService, runExternal, type ServiceCommands } from './service'
import { hostStatus } from './status'

export interface HostIO extends ServiceCommands {
  readonly out: (text: string) => void
  readonly platform?: NodeJS.Platform
  readonly notifySocket?: string | undefined
}

/** Only the host keeps these service capabilities. They are not agent environment variables. */
export const clearServiceEnvironment = (env: NodeJS.ProcessEnv) => {
  const notifySocket = env.NOTIFY_SOCKET
  for (const key of ['CREDENTIALS_DIRECTORY', 'NOTIFY_SOCKET', 'WATCHDOG_USEC', 'WATCHDOG_PID', 'ALTHAR_HOST_KEY_FILE']) delete env[key]
  return { notifySocket }
}

export const runCommand = (options: HostOptions, io: HostIO, dependencies: HostDependencies = {}) =>
  Effect.gen(function* () {
    const out = (value: unknown, human: string) => Effect.sync(() => io.out(options.json ? `${JSON.stringify(value)}\n` : `${human}\n`))
    if (options.command === 'help') return yield* Effect.sync(() => io.out(`${USAGE}\n`))
    if (options.command === 'version') return yield* Effect.sync(() => io.out(`${HOST_VERSION}\n`))
    if ((io.platform ?? process.platform) !== 'linux')
      return yield* new HostError({
        code: 'UnsupportedPlatform',
        message: 'The standalone host currently supports Linux. Desktop clients remain available on macOS, Windows and Linux.',
      })
    switch (options.command) {
      case 'init': {
        const initialized = yield* initializeHome(options, dependencies)
        return yield* out(
          initialized,
          `Home initialized: ${initialized.homeId}\nProfile: ${initialized.profile}\nKeep the master key backup separate from this profile.`,
        )
      }
      case 'status': {
        const status = yield* hostStatus(options.profile, options.wait)
        return yield* out(status, `Home ready: ${status.homeId} (host ${status.version}, API ${status.apiVersion})`)
      }
      case 'install-service': {
        const configured = yield* configuredHome(options)
        const file = yield* installService(configured, io)
        return yield* out(
          { unit: file, name: `${options.serviceName}.service`, started: options.start },
          `Installed ${options.serviceName}.service.${options.start ? '' : `\nStart with systemctl --user enable --now ${options.serviceName}.service.`}\nRestart a running service explicitly to apply changes to its configuration.`,
        )
      }
      case 'serve':
        return yield* serveHome(
          options,
          (ready) =>
            Effect.gen(function* () {
              if (io.notifySocket !== undefined) {
                const run = io.run ?? runExternal
                yield* Effect.tryPromise({
                  try: (signal) =>
                    run('systemd-notify', ['--ready', `--pid=${process.pid}`], { ...process.env, NOTIFY_SOCKET: io.notifySocket }, signal),
                  catch: storageFailure,
                })
              }
              yield* out({ state: 'ready', ...ready }, `Home ready: ${ready.homeId}`)
            }),
          dependencies,
        )
    }
  })

/** Unknown exceptions are operational diagnostics, not safe terminal messages. */
export const failureMessage = (cause: Cause.Cause<unknown>) => {
  const found = Cause.findErrorOption(cause)
  const error = Option.getOrUndefined(found)
  if (error instanceof HostError) {
    return {
      message: error.message,
      exitCode:
        error.code === 'InvalidConfig'
          ? 64
          : ['NotInitialized', 'UnsafePermissions', 'UnsafeKeyLocation', 'WrongKey', 'CorruptVault', 'UnsupportedPlatform'].includes(
                error.code,
              )
            ? 78
            : 75,
    }
  }
  if (typeof error === 'object' && error !== null && '_tag' in error) {
    if (error._tag === 'DatabaseInUse')
      return { exitCode: 75, message: 'Another runtime owns this profile. Stop that service before provisioning or starting another home.' }
    if (['MigrationFailed', 'ForeignKeyViolations', 'BackupFailed'].some((tag) => tag === error._tag))
      return {
        exitCode: 78,
        message: 'The host could not prepare its database safely. Inspect its journal and the profile’s backups before retrying.',
      }
  }
  return { exitCode: 1, message: 'The host stopped unexpectedly. Inspect its operational journal for the cause.' }
}
