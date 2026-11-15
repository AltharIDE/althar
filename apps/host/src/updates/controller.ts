import * as fs from 'node:fs/promises'
import { join } from 'node:path'

import { HostError } from '../errors'
import { writePrivate } from '../privateFiles'
import { runRelease, systemServices, type UpdateServices } from './execute'
import { type ReleaseInfo } from './info'
import { verifyRelease } from './release'
import { checkCandidate, stageUpdate, type StageDependencies } from './stage'
import { assertReservation, releaseReservation, reserveDatabase } from './reservation'
import { pruneInstallation } from './retention'
import {
  compatible,
  controllerAlive,
  loadInstallation,
  lastUpdateResults,
  newUpdateId,
  pointRelease,
  processStamp,
  readReceipt,
  readRelease,
  readRequest,
  readState,
  receipt,
  restoreSnapshot,
  saveState,
  snapshotDatabase,
  updateError,
  writeJSON,
  type Installation,
  type ProcessStamp,
  type Transaction,
  type UpdateRequest,
  type UpdateState,
} from './store'

export interface ControllerDependencies extends StageDependencies {
  readonly services?: UpdateServices
}
const withoutTransaction = (state: UpdateState): UpdateState => {
  const { transaction: _, ...rest } = state
  return rest
}
const failedState = (state: UpdateState, transaction: Transaction): UpdateState => ({
  ...withoutTransaction(state),
  current: transaction.from,
  active: transaction.from,
  failed: transaction.to,
})
const pin = async (installation: Installation, transaction: Transaction) => {
  await pointRelease(installation.root, 'active', transaction.from)
  await saveState(installation.root, failedState(installation.state, transaction))
  await pointRelease(installation.root, 'current', transaction.from)
  await releaseReservation(installation, transaction.id)
}

/** Restore a pre-start migration only. Once a runtime may have acted, compatible rollback preserves its database. */
const recoverTransaction = async (installation: Installation) => {
  const transaction = installation.state.transaction
  if (transaction === undefined) return
  if (transaction.phase !== 'prepared') {
    try {
      await assertReservation(installation, transaction)
    } catch {
      await saveState(installation.root, { ...installation.state, transaction: { ...transaction, phase: 'recovery-required' } })
      throw updateError(
        'UpdateRecoveryRequired',
        'The update lost its database reservation. Data is retained; automatic restoration has been refused.',
      )
    }
  }
  if (transaction.phase === 'migrating') await restoreSnapshot(installation, transaction)
  if (
    !transaction.recoverable ||
    (transaction.phase === 'starting' && !transaction.compatible) ||
    transaction.phase === 'recovery-required'
  ) {
    await saveState(installation.root, {
      ...installation.state,
      transaction: { ...transaction, phase: 'recovery-required' },
      failed: transaction.to,
    })
    throw updateError(
      'UpdateRecoveryRequired',
      'The new host did not become ready after an incompatible update. Its data has been preserved. Install a corrected release; do not start the old code against this database.',
    )
  }
  await pin(installation, transaction)
}

/** Called before every managed service launch. A live controller owns its transaction; an abandoned one is recovered first. */
export const recoverBeforeStart = async (root: string, dependencies: ControllerDependencies = {}, automaticController?: ProcessStamp) => {
  let installation = await loadInstallation(root)
  const transaction = installation.state.transaction
  if (transaction !== undefined) {
    if (await controllerAlive(transaction.controller)) {
      if (transaction.phase !== 'starting')
        throw updateError('UpdateBusy', 'An update owns this home. It is not ready for the service to start yet.')
      return
    }
    await recoverTransaction(installation)
    installation = await loadInstallation(root)
  }
  await pointRelease(root, 'current', installation.state.current)
  await pointRelease(root, 'active', installation.state.current)
  if (!installation.config.automatic || installation.state.staged === undefined || installation.state.staged === installation.state.failed)
    return
  const from = await readRelease(installation, installation.state.current)
  const to = await readRelease(installation, installation.state.staged)
  if (!compatible(from.info, to.info) || to.signed === undefined) return
  try {
    fresh(installation, to.signed.envelope, dependencies.now?.() ?? Date.now(), from.info.version)
  } catch {
    return
  } // An expired/unavailable update must never prevent the known-good host from starting.
  const controller = automaticController ?? (await processStamp(process.ppid))
  if (controller === null) throw updateError('UpdateFailed', 'The managed service process could not be identified for update recovery.')
  await prepareActivation(installation, controller, dependencies, false)
}
const fresh = (installation: Installation, envelope: Uint8Array, now: number, installedVersion: string) =>
  verifyRelease(envelope, {
    keys: installation.config.keys,
    arch: process.arch === 'arm64' ? 'arm64' : 'x64',
    now,
    minimumSequence: installation.state.sequence - 1,
    installedVersion,
  })
const prepareActivation = async (
  installation: Installation,
  controller: ProcessStamp,
  dependencies: ControllerDependencies,
  stopService: boolean,
  allowIncompatible = false,
  requestId = newUpdateId(),
) => {
  const toId = installation.state.staged
  if (toId === undefined) throw updateError('UpdateFailed', 'No verified host release is staged.')
  const from = await readRelease(installation, installation.state.current)
  const to = await readRelease(installation, toId)
  if (to.signed === undefined) throw updateError('UpdateFailed', 'Only authenticated published releases can be activated as updates.')
  fresh(installation, to.signed.envelope, dependencies.now?.() ?? Date.now(), from.info.version)
  const safe = compatible(from.info, to.info) && installation.state.transaction?.phase !== 'recovery-required'
  if (!safe && !allowIncompatible)
    throw new HostError({
      code: 'UpdateIncompatible',
      message:
        'This release changes the API or stored-data format. Apply it explicitly with --allow-incompatible after planning client compatibility and recovery.',
    })
  await checkCandidate(to.folder, to.info, dependencies.execute)
  const transaction: Transaction = {
    id: requestId,
    from: from.id,
    to: to.id,
    phase: 'prepared',
    compatible: safe,
    recoverable: installation.state.transaction?.phase !== 'recovery-required',
    controller,
  }
  let state: UpdateState = { ...installation.state, transaction }
  await saveState(installation.root, state)
  const services = dependencies.services ?? systemServices(dependencies.execute)
  try {
    await reserveDatabase(installation, transaction)
    if (stopService) await services.stop(installation.config.serviceName)
    state = { ...state, transaction: { ...transaction, phase: 'stopped' } }
    await saveState(installation.root, state)
    await snapshotDatabase(installation, transaction.id)
    state = { ...state, transaction: { ...transaction, phase: 'migrating' } }
    await saveState(installation.root, state)
    const result: unknown = JSON.parse(
      await runRelease(to, ['prepare-update', '--installation', installation.root, '--json'], dependencies.execute),
    )
    if (typeof result !== 'object' || result === null || !('homeId' in result) || result.homeId !== installation.config.homeId)
      throw updateError('UpdateFailed', 'The candidate did not validate the expected home during migration.')
    state = { ...state, active: to.id, transaction: { ...transaction, phase: 'starting' } }
    await saveState(installation.root, state)
    await pointRelease(installation.root, 'active', to.id)
    return { transaction, to }
  } catch (error) {
    await recoverTransaction(await loadInstallation(installation.root))
    if (stopService) await services.start(installation.config.serviceName)
    throw error
  }
}

/** Explicit application is a maintenance operation: the service and its agents stop, then restart into the selected release. */
export const applyStaged = async (
  root: string,
  allowIncompatible: boolean,
  dependencies: ControllerDependencies = {},
  requestId?: string,
) => {
  let installation = await loadInstallation(root)
  if (installation.state.transaction !== undefined && installation.state.transaction.phase !== 'recovery-required') {
    if (await controllerAlive(installation.state.transaction.controller))
      throw updateError('UpdateBusy', 'Another update is already controlling this host.')
    await recoverTransaction(installation)
    installation = await loadInstallation(root)
  }
  const controller = await processStamp(process.pid)
  if (controller === null) throw updateError('UpdateFailed', 'The updater process could not be identified for crash recovery.')
  const prepared = await prepareActivation(installation, controller, dependencies, true, allowIncompatible, requestId)
  if (prepared === undefined) throw updateError('UpdateFailed', 'The candidate was not prepared.')
  const services = dependencies.services ?? systemServices(dependencies.execute)
  try {
    await services.start(installation.config.serviceName)
    const info: unknown = JSON.parse(
      await runRelease(prepared.to, ['status', '--profile', installation.config.profile, '--wait', '--json'], dependencies.execute),
    )
    if (
      typeof info !== 'object' ||
      info === null ||
      !('state' in info) ||
      info.state !== 'ready' ||
      !('homeId' in info) ||
      info.homeId !== installation.config.homeId ||
      !('version' in info) ||
      info.version !== prepared.to.info.version
    )
      throw updateError('UpdateFailed', 'The candidate did not pass authenticated API readiness.')
    const settled = await readState(root)
    if (settled.transaction !== undefined || settled.current !== prepared.to.id)
      throw updateError('UpdateFailed', 'The candidate did not commit its verified startup.')
    return prepared.to.info.version
  } catch (error) {
    const current = await loadInstallation(root)
    // The candidate commits only after its own authenticated API probe. Never rewind a confirmed running release.
    if (current.state.transaction === undefined && current.state.current === prepared.to.id) throw error
    await services.stop(installation.config.serviceName)
    await recoverTransaction(current)
    await services.start(installation.config.serviceName)
    throw error
  }
}

/** The host calls this after authenticating its own API, before announcing systemd readiness. */
export const commitReadyRelease = async (root: string, homeId: string, info: ReleaseInfo) => {
  const installation = await loadInstallation(root)
  if (homeId !== installation.config.homeId)
    throw updateError('UpdateRecoveryRequired', 'This service opened a different home than its managed installation.')
  const release = await readRelease(installation, installation.state.active)
  if (release.info.version !== info.version || !compatible(release.info, info))
    throw updateError('UpdateRecoveryRequired', 'The running host does not match its selected release.')
  const transaction = installation.state.transaction
  if (transaction === undefined) {
    await releaseReservation(installation)
    return
  }
  if (transaction.phase !== 'starting' || transaction.to !== release.id)
    throw updateError('UpdateBusy', 'The updater has not authorized this release to serve the home.')
  await assertReservation(installation, transaction)
  const { staged: _, failed: __, ...rest } = withoutTransaction(installation.state)
  await saveState(root, { ...rest, current: release.id, active: release.id })
  await pointRelease(root, 'current', release.id)
  await pointRelease(root, 'active', release.id)
  await releaseReservation(installation, transaction.id)
}

const failureMessage = (error: unknown) =>
  error instanceof HostError
    ? error.message
    : 'The update failed. The installed release and recovery journal have been retained; inspect the service journal.'
export const processRequest = async (root: string, request: UpdateRequest, dependencies: ControllerDependencies = {}) => {
  await receipt(root, { id: request.id, state: 'checking' })
  try {
    let installation = await loadInstallation(root)
    if (!request.apply || installation.state.staged === undefined) await stageUpdate(root, dependencies)
    installation = await loadInstallation(root)
    const selected = installation.state.staged
    if (request.apply && selected !== undefined) {
      await writeJSON(join(root, 'receipts', `${request.id}.json`), { id: request.id, state: 'checking', release: selected })
      const version = await applyStaged(root, request.allowIncompatible, dependencies, request.id)
      await receipt(root, { id: request.id, state: 'applied', version })
    } else {
      const selectedRelease = await readRelease(installation, selected ?? installation.state.current)
      await receipt(root, { id: request.id, state: selected === undefined ? 'current' : 'staged', version: selectedRelease.info.version })
    }
  } catch (error) {
    const state = error instanceof HostError && error.code === 'UpdateRecoveryRequired' ? 'recovery-required' : 'failed'
    await receipt(root, { id: request.id, state, message: failureMessage(error) })
  }
  await fs.rm(join(root, 'requests', `${request.id}.json`), { force: true })
}
/** The generated updater unit holds flock, independently of the host cgroup. */
export const runUpdateQueue = async (root: string, dependencies: ControllerDependencies = {}) => {
  const before = await loadInstallation(root)
  const abandoned = before.state.transaction
  if (abandoned !== undefined) {
    if (await controllerAlive(abandoned.controller)) return
    const services = dependencies.services ?? systemServices(dependencies.execute)
    await services.stop(before.config.serviceName)
    try {
      await recoverTransaction(before)
      await services.start(before.config.serviceName)
      await receipt(root, {
        id: abandoned.id,
        state: 'failed',
        message: 'The update controller was interrupted. Recovery completed; request a new update explicitly to retry.',
      })
    } catch (error) {
      await receipt(root, { id: abandoned.id, state: 'recovery-required', message: failureMessage(error) })
    }
    await fs.rm(join(root, 'requests', `${abandoned.id}.json`), { force: true })
  }
  for (;;) {
    const names = (await fs.readdir(join(root, 'requests'))).filter((name) => /^[a-f0-9]{32}\.json$/.test(name)).sort()
    if (names.length === 0) break
    for (const name of names) {
      const request = await readRequest(root, name.slice(0, -5))
      const recorded = await readReceipt(root, request.id)
      const current = await readState(root)
      if (recorded.state !== 'checking') {
        await fs.rm(join(root, 'requests', name), { force: true })
        continue
      }
      if (
        recorded.release !== undefined &&
        current.transaction === undefined &&
        (recorded.release === current.current || recorded.release === current.failed)
      ) {
        const applied = recorded.release === current.current
        const release = await readRelease(before, recorded.release)
        await receipt(root, {
          id: request.id,
          state: applied ? 'applied' : 'failed',
          version: release.info.version,
          ...(applied
            ? {}
            : { message: 'This interrupted update already failed and was recovered. Request a new update explicitly to retry.' }),
        })
        await fs.rm(join(root, 'requests', name), { force: true })
        continue
      }
      await processRequest(root, request, dependencies)
    }
  }
  // Timer invocations stage releases too; they never stop a running service.
  try {
    const result = await stageUpdate(root, dependencies)
    await writeJSON(join(root, 'last-check.json'), { ...result, at: new Date(dependencies.now?.() ?? Date.now()).toISOString() })
  } catch (error) {
    await writeJSON(join(root, 'last-check.json'), {
      state: 'failed',
      at: new Date(dependencies.now?.() ?? Date.now()).toISOString(),
      message: failureMessage(error),
    })
  }
  // Cleanup failure cannot turn a healthy installation into a failed update.
  await pruneInstallation(root).catch(() => undefined)
}
export const requestUpdate = async (
  root: string,
  apply: boolean,
  allowIncompatible: boolean,
  services: UpdateServices = systemServices(),
) => {
  const installation = await loadInstallation(root)
  const id = newUpdateId()
  await receipt(root, { id, state: 'checking' })
  await writePrivate(
    join(root, 'requests', `${id}.json`),
    JSON.stringify({ id, apply, allowIncompatible, createdAt: new Date().toISOString() }),
    false,
  )
  await services.kick(installation.config.serviceName)
  return id
}
export const updateStatus = async (root: string) => {
  const installation = await loadInstallation(root)
  const current = await readRelease(installation, installation.state.current)
  const staged = installation.state.staged === undefined ? undefined : await readRelease(installation, installation.state.staged)
  return {
    ...(await lastUpdateResults(root)),
    version: current.info.version,
    staged: staged?.info.version ?? null,
    automatic: installation.config.automatic ? 'on-start' : 'manual',
    recoveryRequired: installation.state.transaction?.phase === 'recovery-required',
  }
}
