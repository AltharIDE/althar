import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { configureWorkers, openWorkerStore, workerCertificate } from '@althar/runtime/workerHome'
import { apiClient, openLocalConnection } from '@althar/transport-node'
import { Effect } from 'effect'

export const WORKER_USAGE = `Usage:
  althar workers configure --ca <pem> --certificate <pem> --key <pem>
                         [--address <ip>] [--port <port>] [--relay <file>]
  althar workers disable
  althar workers enroll --certificate <pem> --project <id>
  althar workers revoke --worker <id> [--project <id>]

Use --profile <dir> for another local Desktop profile. Configure also accepts
--worktrees <dir> if the profile uses a custom worktree directory.`

const options = {
  profile: { type: 'string' },
  worktrees: { type: 'string' },
  address: { type: 'string' },
  port: { type: 'string' },
  ca: { type: 'string' },
  certificate: { type: 'string' },
  key: { type: 'string' },
  relay: { type: 'string' },
  project: { type: 'string' },
  worker: { type: 'string' },
} as const

const flags = {
  configure: ['worktrees', 'address', 'port', 'ca', 'certificate', 'key', 'relay'],
  disable: [],
  enroll: ['certificate', 'project'],
  revoke: ['worker', 'project'],
} as const

const required = (value: string | undefined, flag: string) => {
  if (value === undefined || value.trim() === '') throw new Error(`Give --${flag} a value.`)
  return value
}

const workerError = (error: unknown) => (error instanceof Error ? error : new Error('Could not access the home’s worker store.'))

export const runWorkers = (argv: ReadonlyArray<string>, defaults: { readonly profile: string; readonly worktrees: string }) => {
  const [command, ...args] = argv
  if (command !== 'configure' && command !== 'disable' && command !== 'enroll' && command !== 'revoke')
    throw new Error('Choose configure, disable, enroll or revoke.')
  const { values } = parseArgs({ args, options })
  const enabledFlags: readonly string[] = flags[command]
  const invalid = Object.keys(values).find((name) => name !== 'profile' && !enabledFlags.includes(name))
  if (invalid !== undefined) throw new Error(`--${invalid} is unavailable for workers ${command}.`)
  const profile = resolve(values.profile ?? defaults.profile)
  if (command === 'configure' || command === 'disable') {
    const port = values.port ?? '6770'
    if (!/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Choose a port from 1 to 65535.')
    const config =
      command === 'disable'
        ? undefined
        : {
            version: 1 as const,
            address: values.address ?? '127.0.0.1',
            port: Number(port),
            ca: resolve(required(values.ca, 'ca')),
            certificate: resolve(required(values.certificate, 'certificate')),
            key: resolve(required(values.key, 'key')),
            ...(values.relay === undefined ? {} : { relay: resolve(values.relay) }),
          }
    return configureWorkers({ profile, worktrees: resolve(values.worktrees ?? defaults.worktrees) }, config).pipe(
      Effect.map(({ enabled }) => `Worker listener ${enabled ? 'configured' : 'disabled'}. Restart Desktop to apply it.`),
    )
  }
  const selection =
    command === 'enroll'
      ? {
          action: 'enroll' as const,
          certificate: resolve(required(values.certificate, 'certificate')),
          projectId: required(values.project, 'project'),
        }
      : {
          action: 'revoke' as const,
          workerId: required(values.worker, 'worker'),
          projectId: values.project === undefined ? undefined : required(values.project, 'project'),
        }
  return Effect.scoped(
    Effect.gen(function* () {
      const { api, info } = yield* apiClient(yield* openLocalConnection(profile))
      if (selection.action === 'enroll') {
        const { projects } = yield* api.ListProjects()
        if (!projects.some((project) => project.id === selection.projectId))
          return yield* Effect.fail(new Error('That project is unavailable on this home.'))
      }
      return yield* Effect.tryPromise({
        try: async () => {
          const store = await openWorkerStore(profile, info.identity.homeId, Date.now)
          try {
            if (selection.action === 'enroll') {
              const workerId = store.enroll(await workerCertificate(selection.certificate), selection.projectId)
              return JSON.stringify({ homeId: info.identity.homeId, workerId, projectId: selection.projectId })
            }
            if (selection.projectId === undefined) store.revoke(selection.workerId)
            else store.unassign(selection.workerId, selection.projectId)
            return JSON.stringify({ workerId: selection.workerId, projectId: selection.projectId, revoked: true })
          } finally {
            store.close()
          }
        },
        catch: workerError,
      })
    }),
  )
}
