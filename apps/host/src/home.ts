import { hostname, homedir } from 'node:os'
import { join } from 'node:path'

import { API_VERSION } from '@althar/contracts'
import { Context, Effect, Layer } from 'effect'
import { Instance, listenLocalApi, Projects, Runtime, services } from '@althar/runtime'

import metadata from '../package.json'
import { configuredHome } from './configuration'
import type { HostOptions } from './options'
import { initializeVault, openVault } from './vault'

export const HOST_VERSION = metadata.version
export type HostDependencies = Pick<
  Runtime.RuntimeLayerOptions,
  'agents' | 'connectors' | 'agentSearch' | 'agentConfigs' | 'usage' | 'fetch'
> & { readonly maintenanceToken?: string }
export interface HomeReady {
  readonly homeId: string
  readonly hostDeviceId: string
  readonly apiVersion: number
  readonly version: string
  readonly pid: number
}

const runtime = (options: HostOptions, secrets: Layer.Layer<import('@althar/runtime').Secrets>, dependencies: HostDependencies) => {
  const { maintenanceToken, ...runtimeDependencies } = dependencies
  return services({
    database: join(options.profile, 'althar.sqlite'),
    backups: join(options.profile, 'backups'),
    worktreeRoot: options.worktrees,
    accountsRoot: join(options.profile, 'accounts'),
    artifactsRoot: join(options.profile, 'artifacts'),
    agentsRoot: join(options.profile, 'agents'),
    skills: { root: join(options.profile, 'skills') },
    agentConfigs: { homeDir: homedir(), folder: join(options.profile, 'agent-sync') },
    appVersion: HOST_VERSION,
    deviceName: hostname(),
    secrets,
    ...(maintenanceToken === undefined ? {} : { databaseMaintenanceToken: maintenanceToken }),
    ...runtimeDependencies,
  })
}

/** Local operator provisioning opens no person-authority socket and starts no input turn. */
export const initializeHome = (given: HostOptions, dependencies: HostDependencies = {}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const options = yield* configuredHome(given, true)
      yield* initializeVault(options)
      const vault = yield* openVault(options)
      const context = yield* Layer.build(runtime(options, vault.secrets, dependencies))
      const instance = Context.get(context, Instance)
      const projects = Context.get(context, Projects)
      const opened = yield* Effect.forEach(options.projects, (path) =>
        Effect.gen(function* () {
          const envelope = yield* Runtime.envelope('project.open', { path }).pipe(Effect.provideContext(context))
          return yield* projects.open({ path, envelope })
        }),
      )
      return {
        homeId: instance.homeId,
        profile: options.profile,
        worktrees: options.worktrees,
        projects: opened.map((project) => project.projectId),
      }
    }),
  )

/** The home owns the runtime scope. No client connection, terminal input or desktop first-screen signal owns its lifetime. */
export const serveHome = (
  given: HostOptions,
  ready: (info: HomeReady) => Effect.Effect<void, import('./errors').HostError>,
  dependencies: HostDependencies = {},
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const options = yield* configuredHome(given)
      const vault = yield* openVault(options)
      const context = yield* Layer.build(runtime(options, vault.secrets, dependencies))
      const endpoint = yield* listenLocalApi(options.profile).pipe(Effect.provideContext(context))
      const instance = Context.get(context, Instance)
      yield* ready({
        homeId: endpoint.homeId,
        hostDeviceId: instance.deviceId,
        apiVersion: API_VERSION,
        version: HOST_VERSION,
        pid: process.pid,
      })
      yield* Effect.never
    }),
  )
