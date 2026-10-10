import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/*
 * The speech model dictation runs on, and bringing it down (ADR-017). It
 * comes from one pinned revision, file by file, so a dropped connection
 * carries on where it stopped (an HTTP range), and each file is checked
 * against the SHA-256 written here before it counts. Until every file has
 * come down and been checked, the model isn't there: a `ready` mark is
 * written last. Nothing here runs a model; `speech.ts` does.
 */

export interface ModelFile {
  readonly name: string
  readonly size: number
  readonly sha256: string
}

export interface SpeechModel {
  /** Also the folder it is kept in. */
  readonly id: string
  /** Where its files are, at a pinned revision. */
  readonly base: string
  readonly files: ReadonlyArray<ModelFile>
}

/**
 * NVIDIA's Parakeet TDT 0.6B v3, quantised to int8 for sherpa-onnx by its
 * maintainers: 25 European languages, punctuated and capitalised.
 */
export const PARAKEET: SpeechModel = {
  id: 'parakeet-tdt-0.6b-v3-int8',
  base: 'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78',
  files: [
    { name: 'tokens.txt', size: 93_939, sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d' },
    { name: 'joiner.int8.onnx', size: 6_355_277, sha256: '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3' },
    { name: 'decoder.int8.onnx', size: 11_845_275, sha256: '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e' },
    { name: 'encoder.int8.onnx', size: 652_184_281, sha256: 'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247' },
  ],
}

export const sizeOf = (model: SpeechModel) => model.files.reduce((sum, file) => sum + file.size, 0)

const READY = 'ready.json'
/* Room left over on the disk beyond what the model needs. */
const MARGIN = 50_000_000
/* No bytes for this long, and the connection counts as dropped. */
const STALL = 30_000
/* Progress at most this often. */
const EVERY = 100

/** How much of the model is here, and whether all of it is, checked. */
export interface Presence {
  readonly ready: boolean
  readonly got: number
  readonly size: number
}

const sizeAt = async (path: string) => (await stat(path).catch(() => undefined))?.size ?? 0

export const presence = async (dir: string, model: SpeechModel): Promise<Presence> => {
  const size = sizeOf(model)
  const mark = await readFile(join(dir, READY), 'utf8').catch(() => undefined)
  if (mark !== undefined && (JSON.parse(mark) as { readonly id?: unknown }).id === model.id) return { ready: true, got: size, size }
  let got = 0
  for (const file of model.files)
    got += Math.min(file.size, (await sizeAt(join(dir, file.name))) || (await sizeAt(join(dir, `${file.name}.part`))))
  return { ready: false, got, size }
}

/** Why a download stopped short, other than being cancelled. */
export type Stop =
  | { readonly reason: 'network' }
  | { readonly reason: 'corrupt' }
  | { readonly reason: 'space'; readonly need: number; readonly free: number }

export class DownloadStopped extends Error {
  readonly stop: Stop
  /** How much had come down, in all, when it stopped. */
  readonly got: number
  constructor(stop: Stop, got: number) {
    super(`The speech model's download stopped: ${stop.reason}`)
    this.stop = stop
    this.got = got
  }
}

export interface DownloadOptions {
  readonly fetch?: typeof fetch
  readonly signal?: AbortSignal
  /** How much has come down in all, at most every 100 ms, and once at the end of each file. */
  readonly onProgress?: (got: number) => void
  /** The bytes free on the disk the folder is on. */
  readonly free?: (dir: string) => Promise<number>
}

const freeOn = async (dir: string) => {
  const fs = await statfs(dir)
  return fs.bavail * fs.bsize
}

/** Hashes what a part already holds, to carry on from it. */
const hashOf = (path: string) =>
  new Promise<ReturnType<typeof createHash>>((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash))
      .on('error', reject)
  })

/**
 * Brings the model into `dir`, carrying on from whatever is there. Resolves
 * once every file is checked and the model is marked ready; throws
 * `DownloadStopped` when it can't, and the signal's reason when cancelled.
 */
export const download = async (dir: string, model: SpeechModel, options: DownloadOptions = {}): Promise<void> => {
  const get = options.fetch ?? fetch
  await mkdir(dir, { recursive: true })
  const before = await presence(dir, model)
  if (before.ready) return
  const need = before.size - before.got
  const free = await (options.free ?? freeOn)(dir)
  if (free < need + MARGIN) throw new DownloadStopped({ reason: 'space', need, free }, before.got)

  let done = 0
  let said = 0
  const tell = (got: number, now = false) => {
    const at = Date.now()
    if (!now && at - said < EVERY) return
    said = at
    options.onProgress?.(got)
  }

  for (const file of model.files) {
    const final = join(dir, file.name)
    const part = `${final}.part`
    if ((await sizeAt(final)) === file.size) {
      done += file.size
      continue
    }
    let have = await sizeAt(part)
    if (have > file.size) {
      await rm(part, { force: true })
      have = 0
    }
    let hash = have > 0 ? await hashOf(part) : createHash('sha256')
    if (have < file.size) {
      const stalled = new AbortController()
      let timer = setTimeout(() => stalled.abort(), STALL)
      const signal = options.signal === undefined ? stalled.signal : AbortSignal.any([options.signal, stalled.signal])
      const out = await open(part, 'a')
      try {
        const response = await get(`${model.base}/${file.name}`, { signal, ...(have > 0 ? { headers: { Range: `bytes=${have}-` } } : {}) })
        if (response.status === 200 && have > 0) {
          // The server sent all of it rather than the rest: start the file again.
          await out.truncate(0)
          have = 0
          hash = createHash('sha256')
        } else if (response.status !== 200 && response.status !== 206) throw new DownloadStopped({ reason: 'network' }, done + have)
        if (response.body === null) throw new DownloadStopped({ reason: 'network' }, done + have)
        for await (const chunk of response.body) {
          // Cancelled or stalled: stop at once, whether or not the response stops by itself.
          signal.throwIfAborted()
          clearTimeout(timer)
          timer = setTimeout(() => stalled.abort(), STALL)
          await out.write(chunk)
          hash.update(chunk)
          have += chunk.byteLength
          tell(done + have)
        }
      } catch (error) {
        if (options.signal?.aborted === true) throw options.signal.reason
        if (error instanceof DownloadStopped) throw error
        if ((error as NodeJS.ErrnoException).code === 'ENOSPC')
          throw new DownloadStopped({ reason: 'space', need: before.size - done - have, free: 0 }, done + have)
        throw new DownloadStopped({ reason: 'network' }, done + have)
      } finally {
        clearTimeout(timer)
        await out.close()
      }
    }
    if (have !== file.size || hash.digest('hex') !== file.sha256) {
      await rm(part, { force: true })
      throw new DownloadStopped({ reason: 'corrupt' }, done)
    }
    await rename(part, final)
    done += file.size
    tell(done, true)
  }
  await markReady(dir, model)
}

/** Marks the model as all here and checked: written last, so a model without it isn't there. */
export const markReady = async (dir: string, model: SpeechModel) => {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, READY), `${JSON.stringify({ id: model.id })}\n`)
}

/** Takes away all of it, finished or not: a cancelled download keeps nothing. */
export const remove = (dir: string) => rm(dir, { recursive: true, force: true })
