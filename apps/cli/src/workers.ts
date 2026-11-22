import { createHash } from 'node:crypto'
import { link, mkdtemp, open, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { configureWorkers, withWorkerStore, workerCertificate } from '@althar/runtime/workerHome'
import { apiClient, openLocalConnection } from '@althar/transport-node'
import { Effect } from 'effect'

export const WORKER_USAGE = `Usage:
  althar workers configure --ca <pem> --certificate <pem> --key <pem>
                         [--address <ip>] [--port <port>] [--relay <file>]
  althar workers disable
  althar workers enroll --certificate <pem> --project <id>
  althar workers revoke --worker <id> [--project <id>]
  althar workers fetch-file --project <id> --task <id> --path <checkout-relative>
                           --out <local-file> [--workspace <id>]

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
  task: { type: 'string' },
  workspace: { type: 'string' },
  path: { type: 'string' },
  out: { type: 'string' },
} as const

const flags = {
  configure: ['worktrees', 'address', 'port', 'ca', 'certificate', 'key', 'relay'],
  disable: [],
  enroll: ['certificate', 'project'],
  revoke: ['worker', 'project'],
  'fetch-file': ['project', 'task', 'workspace', 'path', 'out'],
} as const

const required = (value: string | undefined, flag: string) => {
  if (value === undefined || value.trim() === '') throw new Error(`Give --${flag} a value.`)
  return value
}

const workerError = (error: unknown) => (error instanceof Error ? error : new Error('Could not access the home’s worker store.'))

export const saveFetchedFile = async (
  out: string,
  file: { readonly size: number; readonly sha256: string; readonly bodyBase64: string },
) => {
  const bytes = Buffer.from(file.bodyBase64, 'base64')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (bytes.length !== file.size || sha256 !== file.sha256 || bytes.toString('base64') !== file.bodyBase64)
    throw new Error('The file did not match its verified size and checksum.')
  const staging = await mkdtemp(join(dirname(out), '.althar-file-'))
  try {
    const temporary = join(staging, 'contents')
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await link(temporary, out).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new Error('That output file already exists.')
      throw error
    })
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  return JSON.stringify({ path: out, bytes: bytes.length, sha256 })
}

export const runWorkers = (argv: ReadonlyArray<string>, defaults: { readonly profile: string; readonly worktrees: string }) => {
  const [command, ...args] = argv
  if (command !== 'configure' && command !== 'disable' && command !== 'enroll' && command !== 'revoke' && command !== 'fetch-file')
    throw new Error('Choose configure, disable, enroll, revoke or fetch-file.')
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
  if (command === 'fetch-file') {
    const out = resolve(required(values.out, 'out'))
    const request = {
      projectId: required(values.project, 'project'),
      taskId: required(values.task, 'task'),
      relativePath: required(values.path, 'path'),
      ...(values.workspace === undefined ? {} : { workspaceId: required(values.workspace, 'workspace') }),
    }
    return Effect.scoped(
      Effect.gen(function* () {
        const { api } = yield* apiClient(yield* openLocalConnection(profile))
        const file = yield* api.ReadWorkerFile(request)
        return yield* Effect.tryPromise({ try: () => saveFetchedFile(out, file), catch: workerError })
      }),
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
      return yield* withWorkerStore(profile, info.identity.homeId, async (store) => {
        if (selection.action === 'enroll') {
          const workerId = store.enroll(await workerCertificate(selection.certificate), selection.projectId)
          return JSON.stringify({ homeId: info.identity.homeId, workerId, projectId: selection.projectId })
        }
        if (selection.projectId === undefined) store.revoke(selection.workerId)
        else store.unassign(selection.workerId, selection.projectId)
        return JSON.stringify({ workerId: selection.workerId, projectId: selection.projectId, revoked: true })
      }).pipe(Effect.mapError(workerError))
    }),
  )
}
