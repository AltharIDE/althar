import { configureNetwork, disableNetwork } from './network'
import { issuePairing, listConnectionDevices, revokeConnectionDevice } from './pairing'
import { join } from 'node:path'

import { Cause, Effect, Option } from 'effect'

import { configuredHome } from './configuration'
import { HostError, storageFailure } from './errors'
import { HOST_VERSION, initializeHome, serveHome, type HostDependencies } from './home'
import { type HostOptions, USAGE } from './options'
import { installService, runExternal, type ServiceCommands } from './service'
import { hostStatus } from './status'
import { setupHome, setupStatus } from './sshSetup'
import { serveStdio, type BridgeStreams } from './stdioBridge'
import {
  commitReadyRelease,
  recoverBeforeStart,
  requestUpdate,
  runUpdateQueue,
  updateStatus,
  type ControllerDependencies,
} from './updates/controller'
import { executeUpdate } from './updates/execute'
import { releaseInfo } from './updates/info'
import { assertManagedProgram, prepareCandidate } from './updates/prepare'
import { packageRelease } from './updates/publish'
import { verifyBundledPrograms } from './updates/preflight'
import { configureUpdates, type SetupDependencies } from './updates/setup'
import { controllerAlive, loadInstallation, processStamp, readReceipt, updateError } from './updates/store'
import { databasePermit } from './updates/reservation'
import { configureWorkers, workerCertificate, workerOperation } from './workers'

export interface HostIO extends ServiceCommands {
  readonly stdio?: BridgeStreams
  readonly out: (text: string) => void
  readonly platform?: NodeJS.Platform
  readonly notifySocket?: string | undefined
  readonly updateLocked?: string | undefined
  readonly releaseSigningKey?: string | undefined
  readonly updates?: ControllerDependencies & SetupDependencies
}

/** Only the host keeps these service capabilities. They are not agent environment variables. */
export const clearServiceEnvironment = (env: NodeJS.ProcessEnv) => {
  const notifySocket = env.NOTIFY_SOCKET
  for (const key of [
    'CREDENTIALS_DIRECTORY',
    'NOTIFY_SOCKET',
    'WATCHDOG_USEC',
    'WATCHDOG_PID',
    'ALTHAR_HOST_KEY_FILE',
    'ALTHAR_HOST_UPDATE_LOCKED',
    'ALTHAR_HOST_RELEASE_SIGNING_KEY',
  ])
    delete env[key]
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
    const update = <A>(run: () => Promise<A>) =>
      Effect.tryPromise({
        try: run,
        catch: (error) =>
          error instanceof HostError
            ? error
            : updateError(
                'UpdateFailed',
                'The managed host operation failed. Inspect its update status and journal; its existing data and key are retained.',
              ),
      })
    switch (options.command) {
      case 'configure-network': {
        const configured = yield* configuredHome(options)
        const network = yield* configureNetwork(configured)
        return yield* out(network, `Direct access configured: ${network.origin}\nRestart the host explicitly to apply this setting.`)
      }
      case 'disable-network': {
        const configured = yield* configuredHome(options)
        yield* disableNetwork(configured.profile)
        return yield* out({ enabled: false }, 'Direct access disabled for the next start. Restart the host to close its listener.')
      }
      case 'configure-workers':
      case 'disable-workers': {
        const configured = yield* configuredHome(options)
        const result = yield* configureWorkers(configured, options.workerConfiguration)
        return yield* out(result, `Worker listener ${result.enabled ? 'configured' : 'disabled'}. Restart the home to apply this setting.`)
      }
      case 'enroll-worker': {
        const configured = yield* configuredHome(options)
        const projectId = options.workerProjectId
        const workerId = yield* workerOperation(
          configured.profile,
          async (store) => store.enroll(await workerCertificate(options.workerCertificate ?? ''), projectId),
          projectId,
        )
        return yield* out(
          { workerId, ...(projectId === undefined ? {} : { projectId }) },
          projectId === undefined ? `Enrolled worker ${workerId}` : `Enrolled worker ${workerId} for project ${projectId}`,
        )
      }
      case 'revoke-worker': {
        const configured = yield* configuredHome(options)
        const projectId = options.workerProjectId
        if (projectId === undefined) {
          yield* workerOperation(configured.profile, (store) => store.revoke(options.workerId ?? ''))
          return yield* out({ workerId: options.workerId, revoked: true }, 'Worker certificate revoked')
        }
        yield* workerOperation(configured.profile, (store) => store.unassign(options.workerId ?? '', projectId))
        return yield* out({ workerId: options.workerId, projectId, revoked: true }, 'Worker access to the project revoked')
      }
      case 'worker-run': {
        const configured = yield* configuredHome(options)
        const attemptId = yield* workerOperation(configured.profile, (store) => store.enqueue(options.workerId ?? ''))
        return yield* out({ attemptId, state: 'queued' }, `Diagnostic queued as ${attemptId}`)
      }
      case 'worker-project-run': {
        const configured = yield* configuredHome(options)
        const command = options.workerProject
        if (command === undefined) return yield* new HostError({ code: 'InvalidConfig', message: 'Choose a project and command name' })
        const attemptId = yield* workerOperation(
          configured.profile,
          (store) => store.enqueue(options.workerId ?? '', command),
          command.projectId,
        )
        return yield* out({ attemptId, state: 'queued' }, `Project run queued as ${attemptId}`)
      }
      case 'worker-cancel': {
        const configured = yield* configuredHome(options)
        const result = yield* workerOperation(configured.profile, (store) => store.cancel(options.workerAttemptId ?? ''))
        return yield* out(
          result,
          `${result.attemptId} ${result.state === 'claimed' && result.cancellationRequested ? 'cancellation requested' : result.state}`,
        )
      }
      case 'worker-result': {
        const configured = yield* configuredHome(options)
        const result = yield* workerOperation(configured.profile, (store) => store.result(options.workerAttemptId ?? ''))
        return yield* out(
          result,
          `${result.attemptId} ${result.state}${result.output === null ? '' : `\n${JSON.stringify(result.output)}`}`,
        )
      }
      case 'worker-log': {
        const configured = yield* configuredHome(options)
        const log = yield* workerOperation(configured.profile, (store) =>
          store.log(options.workerAttemptId ?? '', options.workerLogOffset ?? 0),
        )
        const readable = JSON.stringify(Buffer.from(log.bytesBase64, 'base64').toString('utf8')).replace(
          /[\p{Cc}\p{Cf}]/gu,
          (character) => `\\u{${character.codePointAt(0)?.toString(16)}}`,
        )
        return yield* out(
          log,
          `${log.attemptId} ${log.state} (${log.offset}–${log.nextOffset})
${readable}`,
        )
      }
      case 'pair': {
        const configured = yield* configuredHome(options)
        const invitation = yield* issuePairing(configured)
        return yield* out(invitation, `Home: ${invitation.homeId}\nPairing code (single use, expires in five minutes):\n${invitation.code}`)
      }
      case 'devices': {
        const page = yield* listConnectionDevices(options)
        return yield* out(
          page,
          page.clients
            .map((device) => `${device.deviceId}  ${device.name}  ${device.role}  ${device.revokedAt === null ? 'active' : 'revoked'}`)
            .join('\n') + (page.next === null ? '' : `\nMore devices: run devices --after ${page.next}`),
        )
      }
      case 'revoke-device': {
        yield* revokeConnectionDevice(options)
        return yield* out(
          { deviceId: options.revokeDeviceId, revoked: true },
          'Device access revoked. Its live connections close; work already admitted may finish.',
        )
      }
      case 'connect-stdio':
        return yield* serveStdio(
          options.profile,
          options.expectedHome ?? '',
          options.clientApiVersion ?? 0,
          io.stdio ?? { input: process.stdin, output: process.stdout },
        )
      case 'release-info':
        return yield* out(releaseInfo(), JSON.stringify(releaseInfo()))
      case 'verify-release': {
        yield* update(() => verifyBundledPrograms(io.entry))
        return yield* out(releaseInfo(), JSON.stringify(releaseInfo()))
      }
      case 'package-release': {
        const result = yield* update(() =>
          packageRelease(options, {
            source: io.updates?.source ?? { entry: io.entry, node: io.node, version: HOST_VERSION },
            signingKey: io.releaseSigningKey,
            ...(io.updates?.assemble === undefined ? {} : { assemble: io.updates.assemble }),
            ...(io.updates?.execute === undefined ? {} : { execute: io.updates.execute }),
          }),
        )
        return yield* out(result, `Signed host release assembled: ${result.archive}`)
      }
      case 'setup':
        return yield* update(() => setupHome(options, io, io.out, dependencies))
      case 'setup-status': {
        const result = yield* update(() => setupStatus(options))
        return yield* out(result, JSON.stringify(result))
      }
      case 'configure-updates': {
        const configured = yield* configuredHome(options)
        const result = yield* update(() => configureUpdates(configured, io, io.updates))
        return yield* out(
          result,
          `Verified updates configured at ${result.root}.\nApplication policy: ${result.automatic ? 'compatible releases on the next service start' : 'explicit apply'}.\nStart the home with systemctl --user enable --now ${options.serviceName}.service.`,
        )
      }
      case 'update-status': {
        const result = yield* update(() => updateStatus(options.updateRoot))
        return yield* out(
          result,
          `Installed: ${result.version}\nStaged: ${result.staged ?? 'none'}\nApplication policy: ${result.automatic}${result.recoveryRequired ? '\nRecovery is required before the host can start.' : ''}`,
        )
      }
      case 'update': {
        const id = yield* update(() =>
          requestUpdate(options.updateRoot, options.applyUpdate, options.allowIncompatible, io.updates?.services),
        )
        if (!options.wait)
          return yield* out(
            { requestId: id, state: 'queued' },
            `Update request queued: ${id}.\nUse update-status to inspect the installed and staged release.`,
          )
        const result = yield* Effect.gen(function* () {
          for (;;) {
            const value = yield* update(() => readReceipt(options.updateRoot, id))
            if (value.state !== 'checking') return value
            yield* Effect.sleep('500 millis')
          }
        }).pipe(
          Effect.timeoutOrElse({
            duration: '15 minutes',
            orElse: () =>
              Effect.fail(
                updateError(
                  'UpdateFailed',
                  'The update is still running independently of this command. Inspect update-status and the updater service journal.',
                ),
              ),
          }),
        )
        if (result.state === 'failed' || result.state === 'recovery-required')
          return yield* updateError(
            result.state === 'failed' ? 'UpdateFailed' : 'UpdateRecoveryRequired',
            result.message ?? 'Inspect the updater service journal.',
          )
        return yield* out(result, `Update ${result.state}: ${result.version ?? HOST_VERSION}`)
      }
      case 'update-worker': {
        if (io.updateLocked !== options.updateRoot)
          return yield* updateError('UpdateBusy', 'Run the updater through its configured systemd unit, which holds the installation lock.')
        return yield* update(() => runUpdateQueue(options.updateRoot, io.updates))
      }
      case 'recover-update': {
        const installation = yield* update(() => loadInstallation(options.updateRoot))
        const transaction = installation.state.transaction
        if (transaction?.phase === 'recovery-required')
          return yield* updateError('UpdateRecoveryRequired', 'The managed home requires a corrected release before it can start.')
        if (transaction !== undefined && (yield* update(() => controllerAlive(transaction.controller)))) {
          if (transaction.phase !== 'starting')
            return yield* updateError('UpdateBusy', 'The update controller is still preparing this home.')
          return
        }
        const execute = io.updates?.execute ?? executeUpdate
        const parent = options.controllerPid ?? process.ppid
        yield* update(() =>
          execute('/usr/bin/flock', [
            '--exclusive',
            '--nonblock',
            '--conflict-exit-code',
            '0',
            '--no-fork',
            join(options.updateRoot, 'update.lock'),
            io.node,
            io.entry,
            'recover-locked',
            '--installation',
            options.updateRoot,
            '--controller-pid',
            String(parent),
          ]),
        )
        const after = yield* update(() => loadInstallation(options.updateRoot))
        const pending = after.state.transaction
        if (pending !== undefined && (pending.phase !== 'starting' || !(yield* update(() => controllerAlive(pending.controller)))))
          return yield* updateError('UpdateRecoveryRequired', 'The update transaction must be recovered before this home starts.')
        return
      }
      case 'recover-locked': {
        const parent = yield* update(() => processStamp(options.controllerPid ?? process.ppid))
        if (parent === null) return yield* updateError('UpdateFailed', 'The managed service process is no longer present.')
        return yield* update(() => recoverBeforeStart(options.updateRoot, io.updates, parent))
      }
      case 'prepare-update': {
        const result = yield* prepareCandidate(options, io.entry, releaseInfo()).pipe(
          Effect.mapError((error) =>
            error instanceof HostError
              ? error
              : updateError('UpdateFailed', 'The candidate could not migrate and validate the existing database.'),
          ),
        )
        return yield* out(result, JSON.stringify(result))
      }
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
        const root = options.installation
        if (root !== undefined) {
          const installation = yield* update(() => loadInstallation(root))
          if (
            installation.config.profile !== configured.profile ||
            installation.config.worktrees !== configured.worktrees ||
            installation.config.serviceName !== configured.serviceName
          )
            return yield* updateError('UpdateFailed', 'This installation belongs to another home, worktree location or service.')
        }
        const file = yield* installService(configured, io)
        return yield* out(
          { unit: file, name: `${options.serviceName}.service`, started: options.start },
          `Installed ${options.serviceName}.service.${options.start ? '' : `\nStart with systemctl --user enable --now ${options.serviceName}.service.`}\nRestart a running service explicitly to apply changes to its configuration.`,
        )
      }
      case 'serve': {
        let hostDependencies = dependencies
        if (options.installation !== undefined) {
          const installation = yield* update(() => assertManagedProgram(options.installation ?? '', io.entry, releaseInfo(), 'serve'))
          const maintenanceToken = yield* update(() => databasePermit(installation))
          hostDependencies = { ...dependencies, ...(maintenanceToken === undefined ? {} : { maintenanceToken }) }
        }
        return yield* serveHome(
          options,
          (ready) =>
            Effect.gen(function* () {
              if (options.installation !== undefined) {
                const checked = yield* hostStatus(options.profile)
                yield* update(() => commitReadyRelease(options.installation ?? '', checked.homeId, releaseInfo())).pipe(
                  Effect.uninterruptible,
                )
              }
              if (io.notifySocket !== undefined) {
                const run = io.run ?? runExternal
                yield* Effect.tryPromise({
                  try: (signal) =>
                    run('systemd-notify', ['--ready', `--pid=${process.pid}`], { ...process.env, NOTIFY_SOCKET: io.notifySocket }, signal),
                  catch: storageFailure,
                })
              }
              yield* out(
                { state: 'ready', ...ready },
                `Home ready: ${ready.homeId}${ready.workerPort === undefined ? '' : `\nWorker listener on port ${ready.workerPort}`}`,
              )
            }),
          hostDependencies,
        )
      }
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
          : [
                'NotInitialized',
                'UnsafePermissions',
                'UnsafeKeyLocation',
                'WrongKey',
                'CorruptVault',
                'UnsupportedPlatform',
                'UpdateRecoveryRequired',
                'UpdateNotConfigured',
                'ReleaseRejected',
              ].includes(error.code)
            ? 78
            : 75,
    }
  }
  if (typeof error === 'object' && error !== null && '_tag' in error) {
    if (error._tag === 'DatabaseInUse')
      return { exitCode: 75, message: 'Another runtime owns this profile. Stop that service before provisioning or starting another home.' }
    if (error._tag === 'DatabaseInMaintenance')
      return {
        exitCode: 75,
        message: 'This profile is reserved for update or recovery. Check its managed host update status before opening it.',
      }
    if (error._tag === 'DatabaseSchemaTooNew')
      return {
        exitCode: 78,
        message: 'This database was updated by newer code. Start a compatible host release; do not downgrade it in place.',
      }
    if (['MigrationFailed', 'ForeignKeyViolations', 'BackupFailed'].some((tag) => tag === error._tag))
      return {
        exitCode: 78,
        message: 'The host could not prepare its database safely. Inspect its journal and the profile’s backups before retrying.',
      }
  }
  return { exitCode: 1, message: 'The host stopped unexpectedly. Inspect its operational journal for the cause.' }
}
