import { Schema } from 'effect'

export const WORKER_PREVIEW_SCHEME = 'althar-preview'
export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024
export const MAX_PREVIEW_SOCKET_CHUNK = 32 * 1024
const project = /^proj_[a-f0-9]{32}$/
const launch = /^proc_[a-f0-9]{32}$/

export const WorkerPreviewRun = Schema.Struct({
  projectId: Schema.String.check(Schema.isPattern(project)),
  id: Schema.String.check(Schema.isPattern(launch)),
})
export type WorkerPreviewRun = typeof WorkerPreviewRun.Type

export const WorkerPreviewRequest = Schema.Struct({
  ...WorkerPreviewRun.fields,
  path: Schema.String.check(Schema.isMaxLength(8_192)),
  method: Schema.Literals(['GET', 'HEAD']),
})
export type WorkerPreviewRequest = typeof WorkerPreviewRequest.Type

export const WorkerPreviewResponse = Schema.Struct({
  status: Schema.Int.check(Schema.isBetween({ minimum: 200, maximum: 599 })),
  contentType: Schema.String.check(Schema.isMaxLength(512)),
  location: Schema.NullOr(Schema.String.check(Schema.isMaxLength(8_192))),
  bodyBase64: Schema.String.check(Schema.isMaxLength(Math.ceil(MAX_PREVIEW_BYTES / 3) * 4)),
})
export type WorkerPreviewResponse = typeof WorkerPreviewResponse.Type

export const WorkerPreviewSocketId = Schema.String.check(Schema.isPattern(/^pvs_[a-f0-9]{32}$/u))
export const WorkerPreviewSocketData = Schema.String.check(Schema.isMaxLength(Math.ceil(MAX_PREVIEW_SOCKET_CHUNK / 3) * 4))

export const workerPreviewAddress = (projectId: string, launchId: string, path = '/') =>
  `${WORKER_PREVIEW_SCHEME}://${launchId}.${projectId}${path}`

export const workerPreviewTarget = (address: string) => {
  try {
    const url = new URL(address)
    const [id, projectId, rest] = url.hostname.split('.')
    if (
      url.protocol !== `${WORKER_PREVIEW_SCHEME}:` ||
      url.username ||
      url.password ||
      url.port ||
      id === undefined ||
      projectId === undefined ||
      rest !== undefined ||
      !launch.test(id) ||
      !project.test(projectId)
    )
      return null
    return { id, projectId, path: `${url.pathname || '/'}${url.search}`, host: url.hostname }
  } catch {
    return null
  }
}
