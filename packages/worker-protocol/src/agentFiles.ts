import { createHash, randomBytes } from 'node:crypto'
import { create } from '@bufbuild/protobuf'
import { AgentFileRequestSchema, type AgentHomeFrame, type AgentWorkerFrame } from './gen/althar/worker/v1/control_pb.ts'
import { deferred, type Deferred } from './deferred.ts'

const MAX_FILE = 16 * 1024 * 1024
const MAX_CHUNK = 2048
const FILE_TIMEOUT = 60_000

export interface WorkerFile {
  readonly bytes: Uint8Array
  readonly sha256: string
}

export const validWorkerFilePath = (path: string) =>
  Buffer.byteLength(path) <= 512 &&
  !/[\\\p{Cc}]/u.test(path) &&
  path.split('/').every((piece) => piece !== '' && piece !== '..' && piece !== '.' && piece.toLowerCase() !== '.git')

interface PendingFile {
  readonly id: string
  readonly done: Deferred<WorkerFile>
  readonly timer: ReturnType<typeof setTimeout>
  transfer?: { hash: Uint8Array; bytes: Buffer; offset: number }
}

export type FilePayload = Extract<NonNullable<AgentWorkerFrame['payload']>, { case: 'fileResult' | 'fileChunk' }>

export const makeWorkerFiles = (
  runId: string,
  owns: () => boolean,
  send: (payload: AgentHomeFrame['payload']) => void,
  invalid: (message: string) => void,
) => {
  let active: PendingFile | undefined
  const clear = () => {
    const file = active
    active = undefined
    if (file !== undefined) clearTimeout(file.timer)
    return file
  }
  const finish = (file: PendingFile) => {
    const transfer = file.transfer
    if (transfer === undefined || transfer.offset !== transfer.bytes.length) return
    const actual = createHash('sha256').update(transfer.bytes).digest()
    if (!actual.equals(transfer.hash)) return invalid('The worker returned the wrong file checksum.')
    clear()
    file.done.resolve({ bytes: transfer.bytes, sha256: actual.toString('hex') })
  }
  return {
    read(workspaceId: string, relativePath: string) {
      if (!owns() || active !== undefined || !validWorkerFilePath(relativePath))
        return Promise.reject(new Error('This worker file is unavailable.'))
      const fileId = 'wfl_' + randomBytes(16).toString('hex')
      const done = deferred<WorkerFile>()
      void done.promise.catch(() => undefined)
      active = { id: fileId, done, timer: setTimeout(() => invalid('The worker did not return the requested file.'), FILE_TIMEOUT).unref() }
      send({ case: 'fileRequest', value: create(AgentFileRequestSchema, { file: { runId, fileId }, workspaceId, relativePath }) })
      return done.promise
    },
    receive(frame: FilePayload) {
      const pending = active
      if (pending === undefined || !owns() || frame.value.file?.runId !== runId || frame.value.file.fileId !== pending.id)
        return invalid('The worker sent a file for a different request.')
      if (frame.case === 'fileResult') {
        const { unavailable, size, sha256 } = frame.value
        if (pending.transfer !== undefined || size > MAX_FILE || (unavailable ? size !== 0 || sha256.length !== 0 : sha256.length !== 32))
          return invalid('The worker sent an invalid file header.')
        if (unavailable) {
          clear()
          pending.done.reject(new Error('The file is unavailable in this worker checkout.'))
          return
        }
        pending.transfer = { hash: sha256, bytes: Buffer.alloc(size), offset: 0 }
        finish(pending)
      } else {
        const transfer = pending.transfer
        const bytes = frame.value.data
        if (
          transfer === undefined ||
          bytes.length === 0 ||
          bytes.length > MAX_CHUNK ||
          transfer.offset + bytes.length > transfer.bytes.length
        )
          return invalid('The worker sent an invalid file chunk.')
        transfer.bytes.set(bytes, transfer.offset)
        transfer.offset += bytes.length
        finish(pending)
      }
    },
    close: (cause: Error) => clear()?.done.reject(cause),
  }
}
