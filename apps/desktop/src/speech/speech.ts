import { availableParallelism } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { DownloadStopped, download, markReady, PARAKEET, remove, sizeOf } from './model'

/*
 * Dictation's speech process (ADR-017): a utility process of its own, which
 * the main process starts the first time someone dictates and stops once it
 * has sat idle. It brings the speech model down and turns speech into text
 * with it, on this machine, through sherpa-onnx's native addon. It is apart
 * from the runtime, so native code going wrong never takes agents' sessions
 * with it, and the model's memory goes when the process does.
 *
 * It answers the main process's requests by id, and says how a download goes
 * as it goes. ALTHAR_SPEECH is the folder models are kept in. Whether the
 * model is there, the main process reads from the folder itself, so asking
 * never starts this process.
 */

interface Request {
  readonly id?: string
  readonly type?: string
  readonly samples?: unknown
  readonly sampleRate?: unknown
}

interface Recognizer {
  createStream(): { acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void }
  decodeAsync(stream: unknown): Promise<unknown>
  getResult(stream: unknown): { text: string }
}

interface Sherpa {
  readonly OfflineRecognizer: { createAsync(config: unknown): Promise<Recognizer> }
}

const port = process.parentPort
const dir = join(process.env.ALTHAR_SPEECH ?? '.', PARAKEET.id)
/* The end-to-end tests' stand-in: a model that comes down at once and hears the same words every time. */
const fake = __ALTHAR_TEST_HOOKS__ && process.env.ALTHAR_FAKE_SPEECH === '1'

const say = (message: Record<string, unknown>) => port.postMessage(message)

/* The download under way: how to stop it, and when it has stopped. */
let downloading: { readonly controller: AbortController; readonly run: Promise<void> } | undefined
let recognizer: Promise<Recognizer> | undefined
/* The transcription under way, the next waits for. */
let turn: Promise<unknown> = Promise.resolve()

const load = (): Promise<Recognizer> => {
  recognizer ??= (async () => {
    // A native addon, loaded as Node finds it: it stays out of the bundle (vite.node.config.ts).
    const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as Sherpa
    const at = (name: string) => join(dir, name)
    return sherpa.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: 16_000, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: at('encoder.int8.onnx'), decoder: at('decoder.int8.onnx'), joiner: at('joiner.int8.onnx') },
        tokens: at('tokens.txt'),
        modelType: 'nemo_transducer',
        numThreads: Math.max(1, Math.min(4, availableParallelism() - 1)),
        provider: 'cpu',
        debug: 0,
      },
      decodingMethod: 'greedy_search',
    })
  })()
  // A model that wouldn't load is tried again next time, rather than kept as a failure.
  recognizer.catch(() => (recognizer = undefined))
  return recognizer
}

/* The stand-in's download: a dozen steps a tenth of a second apart, then marked as there. */
const fakeDownload = async (signal: AbortSignal) => {
  const size = sizeOf(PARAKEET)
  for (let got = 0; got < size; got += size / 12) {
    if (signal.aborted) throw signal.reason
    say({ type: 'progress', got: Math.round(got), size })
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  await markReady(dir, PARAKEET)
}

const startDownload = () => {
  if (downloading !== undefined) return
  const controller = new AbortController()
  const size = sizeOf(PARAKEET)
  const run = fake
    ? fakeDownload(controller.signal)
    : download(dir, PARAKEET, { signal: controller.signal, onProgress: (got) => say({ type: 'progress', got, size }) })
  run.then(
    () => say({ type: 'downloaded' }),
    (error: unknown) => {
      if (controller.signal.aborted) return
      if (error instanceof DownloadStopped) say({ type: 'stopped', stop: error.stop, got: error.got, size })
      else say({ type: 'stopped', stop: { reason: 'network' }, got: 0, size })
    },
  )
  const settled = run.then(
    () => undefined,
    () => undefined,
  )
  downloading = { controller, run: settled }
  void settled.then(() => {
    if (downloading?.controller === controller) downloading = undefined
  })
}

const answer = async (request: Request): Promise<unknown> => {
  switch (request.type) {
    case 'download':
      return startDownload()
    case 'cancel': {
      // Stopped, and its files closed, before they go: a file still open can't be removed on Windows.
      const was = downloading
      downloading = undefined
      was?.controller.abort(new Error('Cancelled'))
      await was?.run
      await remove(dir)
      return undefined
    }
    case 'prepare':
      if (!fake) await load()
      return undefined
    case 'transcribe': {
      const { samples, sampleRate } = request
      if (!(samples instanceof Float32Array) || typeof sampleRate !== 'number') throw new Error('Nothing to write down.')
      if (fake) return 'Also check the webhook retry path.'
      // One at a time: the window writes down as someone speaks, and again as they stop.
      const run = turn.then(async () => {
        const model = await load()
        const stream = model.createStream()
        stream.acceptWaveform({ samples, sampleRate })
        await model.decodeAsync(stream)
        return model.getResult(stream).text.trim()
      })
      turn = run.catch(() => undefined)
      return run
    }
    default:
      throw new Error(`The speech process doesn't know ${String(request.type)}.`)
  }
}

port.on('message', (event: { readonly data: Request }) => {
  const request = event.data
  if (request.id === undefined) return
  const { id } = request
  answer(request).then(
    (value) => say({ type: 'answer', id, value }),
    (error: unknown) => say({ type: 'answer', id, error: error instanceof Error ? error.message : String(error) }),
  )
})
