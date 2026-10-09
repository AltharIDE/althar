/*
 * The microphone, while someone dictates: mono, 16 kHz where the system can
 * give it (what the speech model hears), kept in memory until it stops, and
 * how loud it is as it goes, for the composer's bars. Nothing is written to
 * disk, and nothing is kept once it is written down or thrown away.
 */

export interface Recorded {
  readonly samples: Float32Array
  readonly sampleRate: number
}

export interface Recording {
  /** Stops, and hands over what was heard. */
  readonly stop: () => Recorded
  /** Stops, and keeps nothing. */
  readonly cancel: () => void
}

/** Starts recording; `onLevel` hears how loud, from 0 to 1, about fifteen times a second. Rejects as getUserMedia does. */
export type Record = (onLevel: (level: number) => void) => Promise<Recording>

/* About 64 ms at 16 kHz: often enough for the bars to follow a voice. */
const FRAME = 1024

export const record: Record = async (onLevel) => {
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
  node.onaudioprocess = (event) => {
    const frame = event.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(frame))
    let sum = 0
    for (const sample of frame) sum += sample * sample
    // The square root of the RMS reads closer to how loud it sounds than the RMS does.
    onLevel(Math.min(1, Math.sqrt(Math.sqrt(sum / frame.length)) * 1.6))
  }
  source.connect(node)
  node.connect(context.destination)
  const end = () => {
    node.onaudioprocess = null
    source.disconnect()
    node.disconnect()
    for (const track of stream.getTracks()) track.stop()
    void context.close()
  }
  return {
    stop: () => {
      end()
      const samples = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
      let at = 0
      for (const chunk of chunks) {
        samples.set(chunk, at)
        at += chunk.length
      }
      return { samples, sampleRate: context.sampleRate }
    },
    cancel: end,
  }
}
