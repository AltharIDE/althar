import { createHash, type Hash } from 'node:crypto'
import { createWriteStream, mkdtempSync, readFileSync, rmSync, statfsSync, type WriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sendSizeWords } from './agentCheckout.ts'

/** Bytes a worker sent back, kept in a private file as they arrived: a checkpoint's patch or commits can be large. */
export interface ReceivedFile {
  readonly file: string
  readonly size: number
}

/** A part of a worker's checkpoint: in memory where it was made here (tests, an empty part), else in a private file. */
export type WorkerBytes = Uint8Array | ReceivedFile

/** A part's bytes, read whole: for what is known to be small, such as a test's. */
export const readBytes = (bytes: WorkerBytes): Buffer => (bytes instanceof Uint8Array ? Buffer.from(bytes) : readFileSync(bytes.file))

export const sizeOfBytes = (bytes: WorkerBytes): number => (bytes instanceof Uint8Array ? bytes.byteLength : bytes.size)

/** What stays free on the home's disk however large a checkpoint is: the home keeps working while one arrives. */
const KEPT_FREE = 256 * 1024 * 1024

interface Part {
  readonly size: number
  readonly sha256: Uint8Array
  readonly file?: string
  readonly stream?: WriteStream
  readonly hash: Hash
  written: number
}

/**
 * Receives the parts of a worker's checkpoint, each into a private file as its bytes arrive and hashed as they do, so
 * none is ever held whole in memory. Refused at once, in words to show, where the home's disk hasn't room for them.
 */
export const receiveParts = (parts: ReadonlyArray<{ readonly size: number; readonly sha256: Uint8Array }>) => {
  const total = parts.reduce((sum, part) => sum + part.size, 0)
  const folder = total === 0 ? undefined : mkdtempSync(join(tmpdir(), 'althar-worker-checkpoint-'))
  let failure: Error | undefined
  const received: Array<Part> = []
  const discard = () => {
    for (const part of received) part.stream?.destroy()
    if (folder !== undefined) rmSync(folder, { recursive: true, force: true })
  }
  if (folder !== undefined) {
    const { bavail, bsize } = statfsSync(folder)
    const free = Number(bavail) * Number(bsize)
    if (total + KEPT_FREE > free) {
      rmSync(folder, { recursive: true, force: true })
      throw new Error(
        `This computer has ${sendSizeWords(free)} free; the worker’s changes need ${sendSizeWords(total)} here. Free space on this computer, then try again: the changes stay on the worker meanwhile.`,
      )
    }
  }
  parts.forEach((part, at) => {
    const file = folder === undefined || part.size === 0 ? undefined : join(folder, `part-${at}`)
    const stream = file === undefined ? undefined : createWriteStream(file, { flags: 'wx', mode: 0o600 })
    stream?.on('error', (error) => {
      failure ??= error
    })
    received.push({
      ...part,
      hash: createHash('sha256'),
      written: 0,
      ...(file === undefined ? {} : { file }),
      ...(stream === undefined ? {} : { stream }),
    })
  })
  return {
    /** Takes the next bytes of part `at`: false where they don't fit it; else whether to wait for `drained` before more. */
    write: (at: number, data: Uint8Array): 'invalid' | 'more' | 'wait' => {
      const part = received[at]
      if (part?.stream === undefined || data.byteLength === 0 || part.written + data.byteLength > part.size) return 'invalid'
      part.written += data.byteLength
      part.hash.update(data)
      return part.stream.write(data) ? 'more' : 'wait'
    },
    /** Settles once part `at` can take more. */
    drained: (at: number): Promise<void> =>
      new Promise((resolve) => {
        const stream = received[at]?.stream
        if (stream === undefined || !stream.writableNeedDrain) return resolve()
        stream.once('drain', () => resolve())
        stream.once('close', () => resolve())
      }),
    complete: () => received.every((part) => part.written === part.size),
    /** Every part, once all have arrived and been written: in its file, checked against the digest the worker gave. */
    finish: async (): Promise<ReadonlyArray<WorkerBytes>> => {
      await Promise.all(
        received.map((part) =>
          part.stream === undefined
            ? Promise.resolve()
            : new Promise<void>((resolve, reject) => {
                part.stream?.end((error?: Error | null) => (error ? reject(error) : resolve()))
              }),
        ),
      )
      if (failure !== undefined) throw new Error('The home couldn’t write the worker’s changes to its disk.', { cause: failure })
      if (received.some((part) => !part.hash.digest().equals(part.sha256)))
        throw new Error('The worker returned the wrong workspace transfer digest.')
      return received.map((part) => (part.file === undefined ? new Uint8Array() : { file: part.file, size: part.size }))
    },
    /** Lets every file go: once what was received has been taken in, or it never will be. */
    discard,
  }
}

export type ReceivingParts = ReturnType<typeof receiveParts>
