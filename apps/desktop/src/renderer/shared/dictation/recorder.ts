/*
 * The microphone, while someone dictates: mono, 16 kHz where the system can
 * give it (what the speech model hears), kept in memory until it stops, and
 * how loud it is as it goes, for the composer's bars and for hearing pauses.
 * What has been heard so far can be read while it goes on, to write down as
 * the person speaks. Nothing is written to disk, and nothing is kept once it
 * is written down or thrown away.
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
}

/** Starts recording; `onFrame` hears each moment, about fifteen times a second. Rejects as getUserMedia does. */
export type Record = (onFrame: (frame: Frame) => void) => Promise<Recording>

/* About 64 ms at 16 kHz: often enough for the bars to follow a voice. */
const FRAME = 1024

export const record: Record = async (onFrame) => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  let context: AudioContext
  try {
    context = new AudioContext({ sampleRate: 16_000 })
  } catch {
    // A system that can't resample to 16 kHz records at its own rate; the speech process resamples.
    context = new AudioContext()
  }
  const source = context.createMediaStreamSource(stream)
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
  }
}
