import * as fs from 'node:fs/promises'
import { join } from 'node:path'

import type { HostOptions } from '../options'
import { privateDirectory, readPrivate, writePrivate } from '../privateFiles'
import { installService, type ServiceCommands } from '../service'
import { assembleBundle, readReleaseKey, type BundleSource } from './bundle'
import { syncReleaseTree } from './archive'
import { checkCandidate } from './stage'
import { executeUpdate, systemServices, type UpdateServices } from './execute'
import type { UpdateExecutor } from './execute'
import { Effect } from 'effect'
import { releaseInfo } from './info'
import { digest, httpsURL, releaseIdentity } from './release'
import {
  contains,
  createInstallationFolders,
  loadInstallation,
  pointRelease,
  readHomeId,
  saveState,
  storeBootstrap,
  updateError,
  writeJSON,
  type UpdateConfig,
} from './store'

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const marker = '# Althar host updater v1'
/** The stable launcher contains no downloaded code. Resolve one immutable release before executing Node and JavaScript. */
export const renderLauncher = (root: string) => `#!/bin/sh
set -eu
root=${shellQuote(root)}
export NODE_OPTIONS= NODE_PATH=
control=$(/usr/bin/readlink -f "$root/current")
case "\${1-}" in
  update-worker)
    shift
    exec /usr/bin/flock --exclusive --no-fork "$root/update.lock" /bin/sh "$root/launcher" update-locked "$@"
    ;;
  update-locked)
    shift
    export ALTHAR_HOST_UPDATE_LOCKED="$root"
    exec "$control/node/bin/node" "$control/dist/althar-host.js" update-worker "$@"
    ;;
  serve)
    "$control/node/bin/node" "$control/dist/althar-host.js" recover-update --installation "$root" --controller-pid "$$"
    active=$(/usr/bin/readlink -f "$root/active")
    exec "$active/node/bin/node" "$active/dist/althar-host.js" "$@"
    ;;
  status|connect-stdio)
    active=$(/usr/bin/readlink -f "$root/active")
    exec "$active/node/bin/node" "$active/dist/althar-host.js" "$@"
    ;;
  *) exec "$control/node/bin/node" "$control/dist/althar-host.js" "$@" ;;
esac
`
const unitQuote = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`
export const renderUpdateUnits = (options: Pick<HostOptions, 'serviceName' | 'updateRoot'>) => {
  const name = options.serviceName
  const root = options.updateRoot
  if (root.includes('\\') || Array.from(root).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
    throw updateError('UpdateFailed', 'The managed program directory cannot contain backslashes or control characters.')
  const service = `${marker}
[Unit]
Description=Check, stage or explicitly apply Althar host releases
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=oneshot
ExecStart=:/bin/sh ${unitQuote(join(root, 'launcher'))} "update-worker" "--installation" ${unitQuote(root)}
UMask=0077
NoNewPrivileges=true
ProtectSystem=full
RestrictSUIDSGID=true
TimeoutStartSec=15min
TimeoutStopSec=90s
KillMode=control-group
Restart=on-failure
RestartSec=10s
`
  const timer = `${marker}
[Unit]
Description=Prepare verified Althar host updates

[Timer]
OnBootSec=5min
OnUnitInactiveSec=1h
RandomizedDelaySec=10min
Unit=${name}-update.service
Persistent=true

[Install]
WantedBy=timers.target
`
  // PathExistsGlob is a scalar path, not ExecStart's quoted word syntax.
  // Its final suffix avoids a trailing-space ambiguity in the directory name.
  const path = `${marker}
[Unit]
Description=Process explicit Althar host update requests

[Path]
PathExistsGlob=${join(root, 'requests/*.json').replaceAll('%', '%%')}
Unit=${name}-update.service

[Install]
WantedBy=default.target
`
  return { service, timer, path }
}
export interface SetupDependencies {
  readonly services?: UpdateServices
  readonly assemble?: typeof assembleBundle
  readonly source?: BundleSource
  readonly execute?: UpdateExecutor
}
const finishSetup = async (options: HostOptions, commands: ServiceCommands, execute: UpdateExecutor = executeUpdate) => {
  const installed = await readPrivate(join(options.unitDirectory, `${options.serviceName}.service`), 65_536)
  if (installed === null || !installed.toString().includes(unitQuote(join(options.updateRoot, 'launcher')))) {
    await Effect.runPromise(installService({ ...options, installation: options.updateRoot, start: false }, commands))
  }
  const units = renderUpdateUnits(options)
  await privateDirectory(options.unitDirectory, true)
  const entries = [
    ['service', units.service],
    ['timer', units.timer],
    ['path', units.path],
  ] as const
  for (const [suffix] of entries) {
    const previous = await readPrivate(join(options.unitDirectory, `${options.serviceName}-update.${suffix}`), 65_536)
    if (previous !== null && !previous.toString().startsWith(`${marker}\n`))
      throw updateError('UpdateFailed', 'An updater unit already exists and is not managed by Althar.')
  }
  for (const [suffix, value] of entries)
    await writePrivate(join(options.unitDirectory, `${options.serviceName}-update.${suffix}`), value, true)
  const run =
    commands.run ??
    (async (command, args) => {
      await execute(command, args)
    })
  await run('systemctl', ['--user', 'daemon-reload'])
  await run('systemctl', ['--user', 'enable', '--now', `${options.serviceName}-update.timer`, `${options.serviceName}-update.path`])
  if (options.start) await run('systemctl', ['--user', 'enable', '--now', `${options.serviceName}.service`])
}
export const configureUpdates = async (given: HostOptions, commands: ServiceCommands, dependencies: SetupDependencies = {}) => {
  const services = dependencies.services ?? systemServices()
  const profile = await privateDirectory(given.profile)
  const worktrees = await privateDirectory(given.worktrees)
  if (
    contains(given.updateRoot, profile) ||
    contains(profile, given.updateRoot) ||
    contains(given.updateRoot, worktrees) ||
    contains(worktrees, given.updateRoot)
  )
    throw updateError('UpdateFailed', 'Keep the program installation separate from the home profile and worktrees.')
  const root = await createInstallationFolders(given.updateRoot)
  if (
    root.includes('\\') ||
    contains(root, profile) ||
    contains(profile, root) ||
    contains(root, worktrees) ||
    contains(worktrees, root) ||
    contains(root, given.keyFile) ||
    (given.encryptedCredential !== undefined && contains(root, given.encryptedCredential))
  )
    throw updateError('UpdateFailed', 'Keep the program installation separate from the home profile, worktrees and credential files.')
  const existing = await readPrivate(join(root, 'updates.json'), 131_072)
  const supplied = await Promise.all(given.releaseKeys.map(readReleaseKey))
  const keys = [...new Map(supplied.map((key) => [releaseIdentity(key), key])).values()]
  if (keys.length > 8) throw updateError('UpdateFailed', 'At most eight release verification keys can be retained.')
  if (existing !== null) {
    const installation = await loadInstallation(root)
    if (
      installation.config.profile !== profile ||
      installation.config.worktrees !== worktrees ||
      installation.config.serviceName !== given.serviceName
    )
      throw updateError('UpdateFailed', 'This program directory already belongs to another home or service.')
    // Key rotation keeps old verification keys until retained releases no longer need them.
    const merged = [...new Map([...installation.config.keys, ...keys].map((key) => [releaseIdentity(key), key])).values()]
    if (merged.length > 8) throw updateError('UpdateFailed', 'At most eight release verification keys can be retained.')
    await writeJSON(join(root, 'updates.json'), {
      ...installation.config,
      keys: merged,
      automatic: given.automaticUpdates ?? installation.config.automatic,
      ...(given.updateFeed === undefined ? {} : { feed: { kind: 'manifest', url: httpsURL(given.updateFeed).href } }),
    })
    await finishSetup({ ...given, updateRoot: root, installation: root }, commands, dependencies.execute)
    return { root, automatic: given.automaticUpdates ?? installation.config.automatic }
  }
  if (keys.length === 0)
    throw updateError('UpdateNotConfigured', 'Supply --release-key with the independently trusted Ed25519 host-release public key.')
  if (await services.active(given.serviceName))
    throw updateError('UpdateBusy', 'Stop the existing host after its work finishes before converting it to a managed installation.')
  const homeId = readHomeId(join(profile, 'althar.sqlite'))
  const info = releaseInfo()
  const source = dependencies.source ?? { node: commands.node, entry: commands.entry, version: info.version }
  const id = digest(Buffer.concat([Buffer.from(JSON.stringify(info)), await fs.readFile(source.entry)]))
  const target = join(root, 'releases', id)
  try {
    await fs.rm(target, { recursive: true, force: true })
    await (dependencies.assemble ?? assembleBundle)(source, target)
  } catch {
    throw updateError(
      'UpdateFailed',
      'The initial host could not be captured completely, including Node’s LICENSE and its locked adapters. Use an official Node distribution and a built host with dependencies installed.',
    )
  }
  if ((await services.active(given.serviceName)) || readHomeId(join(profile, 'althar.sqlite')) !== homeId)
    throw updateError('UpdateBusy', 'The home started while its installation was being prepared. Stop it before completing setup.')
  await syncReleaseTree(target)
  await checkCandidate(target, info, dependencies.execute)
  const config: UpdateConfig = {
    format: 1,
    profile,
    worktrees,
    homeId,
    serviceName: given.serviceName,
    keys,
    bootstrap: id,
    automatic: given.automaticUpdates ?? false,
    feed:
      given.updateFeed === undefined
        ? { kind: 'github', repository: 'AltharIDE/althar' }
        : { kind: 'manifest', url: httpsURL(given.updateFeed).href },
  }
  await storeBootstrap(root, id, info)
  await saveState(root, { format: 1, current: id, active: id, sequence: 0 })
  await pointRelease(root, 'current', id)
  await pointRelease(root, 'active', id)
  await writePrivate(join(root, 'launcher'), renderLauncher(root), true)
  await writeJSON(join(root, 'updates.json'), config)
  const options = { ...given, profile, worktrees, updateRoot: root, installation: root }
  await finishSetup(options, commands, dependencies.execute)
  return { root, automatic: config.automatic }
}
