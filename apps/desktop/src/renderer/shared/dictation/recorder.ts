/*
 * The microphone, while someone dictates: mono, 16 kHz where the system can
 * give it (what the speech model hears), kept in memory until it stops, and
 * how loud it is as it goes, for the composer's bars and for hearing pauses.
 * What has been heard so far can be read while it goes on, to write down as
 * the person speaks. Nothing is written to disk, and nothing is kept once it
 * is written down or thrown away.
 *
 * It hears the microphone the person chose, or the system's default where
 * they chose none or the one they chose is gone. Another can be chosen while
 * it goes on: what was heard stays, and what follows comes from the new one.
 * A microphone pulled out mid-way hands over to the default, and goes on.
 */

export interface Recorded {
  readonly samples: Float32Array
  readonly sampleRate: number
}

/** A moment of the recording: how loud it looks (0 to 1, for the bars), how loud it is (RMS), how many samples there are so far, and how many a second. */
export interface Frame {
  readonly level: number
  readonly rms: number
  readonly end: number
  readonly rate: number
}

export interface Recording {
  /** What has been heard from sample `from` on, while it goes on. */
  readonly peek: (from: number) => Recorded
  /** Stops, and hands over all that was heard. */
  readonly stop: () => Recorded
  /** Stops, and keeps nothing. */
  readonly cancel: () => void
  /** Goes on from another microphone (null: the system's default), keeping what was heard. Where it can't be had, it goes on as it was. */
  readonly use: (deviceId: string | null) => Promise<void>
}

/** Starts recording from `deviceId`, or the system's default; `onFrame` hears each moment, about fifteen times a second. Rejects as getUserMedia does. */
export type Record = (onFrame: (frame: Frame) => void, deviceId?: string | null) => Promise<Recording>

/* About 64 ms at 16 kHz: often enough for the bars to follow a voice. */
const FRAME = 1024

const AUDIO = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }

/* What getUserMedia says when the microphone asked for by id isn't there. */
const isGone = (error: unknown) => {
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined
  return name === 'OverconstrainedError' || name === 'NotFoundError'
}

/** The chosen microphone, or the system's default where none is chosen or it is gone. */
const open = async (deviceId: string | null): Promise<MediaStream> => {
  if (deviceId !== null) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...AUDIO, deviceId: { exact: deviceId } } })
    } catch (error) {
      if (!isGone(error)) throw error
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: AUDIO })
}

export const record: Record = async (onFrame, deviceId = null) => {
  let stream = await open(deviceId)
  let context: AudioContext
  try {
    context = new AudioContext({ sampleRate: 16_000 })
  } catch {
    // A system that can't resample to 16 kHz records at its own rate; the speech process resamples.
    context = new AudioContext()
  }
  let source = context.createMediaStreamSource(stream)
  // A ScriptProcessor rather than a worklet: the page's policy loads scripts from its own files only, and a worklet needs a module.
  const node = context.createScriptProcessor(FRAME, 1, 1)
  const chunks: Array<Float32Array> = []
  let length = 0
  node.onaudioprocess = (event) => {
    const frame = new Float32Array(event.inputBuffer.getChannelData(0))
    chunks.push(frame)
    length += frame.length
    let sum = 0
    for (const sample of frame) sum += sample * sample
    const rms = Math.sqrt(sum / frame.length)
    // The square root of the RMS reads closer to how loud it sounds than the RMS does.
    onFrame({ level: Math.min(1, Math.sqrt(rms) * 1.6), rms, end: length, rate: context.sampleRate })
  }
  source.connect(node)
  node.connect(context.destination)
  let ended = false
  /* Each change of microphone has a number; one overtaken by a later one is let go. */
  let changes = 0
  const use = async (next: string | null) => {
    if (ended) return
    const change = ++changes
    let fresh: MediaStream
    try {
      fresh = await open(next)
    } catch {
      return
    }
    if (ended || change !== changes) {
      for (const track of fresh.getTracks()) track.stop()
      return
    }
    const was = { stream, source }
    stream = fresh
    source = context.createMediaStreamSource(fresh)
    source.connect(node)
    was.source.disconnect()
    for (const track of was.stream.getTracks()) track.stop()
    watch(fresh, next)
  }
  /* A chosen microphone pulled out mid-way hands over to the default. */
  const watch = (heard: MediaStream, chosen: string | null) => {
    if (chosen === null) return
    for (const track of heard.getTracks())
      track.addEventListener?.('ended', () => {
        if (stream === heard) void use(null)
      })
  }
  watch(stream, deviceId)
  const from = (start: number) => {
    const samples = new Float32Array(Math.max(0, length - start))
    let at = 0
    let skip = start
    for (const chunk of chunks) {
      if (skip >= chunk.length) {
        skip -= chunk.length
        continue
      }
      const part = skip > 0 ? chunk.subarray(skip) : chunk
      skip = 0
      samples.set(part, at)
      at += part.length
    }
    return { samples, sampleRate: context.sampleRate }
  }
  const end = () => {
    ended = true
    node.onaudioprocess = null
    source.disconnect()
    node.disconnect()
    for (const track of stream.getTracks()) track.stop()
    void context.close()
  }
  return {
    peek: from,
    stop: () => {
      end()
      return from(0)
    },
    cancel: end,
    use,
  }
}
