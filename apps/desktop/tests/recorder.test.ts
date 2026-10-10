import { afterEach, describe, expect, it, vi } from 'vitest'

import { type Frame, record } from '../src/renderer/shared/dictation/recorder'

/*
 * The microphone while someone dictates: mono at 16 kHz where the system
 * gives it, how loud as it goes, and all of it handed over on stop, or
 * nothing kept on cancel. The browser's audio is faked: jsdom has none.
 */

class FakeNode {
  onaudioprocess: ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null = null
  connect = vi.fn()
  disconnect = vi.fn()
  /** What the microphone hears, a frame at a time. */
  hear(frame: Float32Array) {
    this.onaudioprocess?.({ inputBuffer: { getChannelData: () => frame } })
  }
}

const install = (options: { rate?: number; refuse16k?: boolean; fail?: DOMException } = {}) => {
  const track = { stop: vi.fn() }
  const node = new FakeNode()
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  const close = vi.fn(async () => {})
  class FakeContext {
    readonly sampleRate: number
    readonly destination = {}
    constructor(init?: { sampleRate?: number }) {
      if (init?.sampleRate !== undefined && options.refuse16k === true) throw new DOMException('no', 'NotSupportedError')
      this.sampleRate = init?.sampleRate ?? options.rate ?? 48_000
    }
    createMediaStreamSource = () => source
    createScriptProcessor = () => node
    close = close
  }
  vi.stubGlobal('AudioContext', FakeContext)
  const getUserMedia = vi.fn(async () => {
    if (options.fail !== undefined) throw options.fail
    return { getTracks: () => [track] }
  })
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  return { track, node, source, close, getUserMedia }
}

afterEach(() => vi.unstubAllGlobals())

describe('recording what is said', () => {
  it('asks for mono audio, says how loud each moment is, and hands over every frame at 16 kHz', async () => {
    const fake = install()
    const frames: Array<Frame> = []
    const recording = await record((frame) => frames.push(frame))
    expect(fake.getUserMedia).toHaveBeenCalledWith({ audio: expect.objectContaining({ channelCount: 1 }) })
    fake.node.hear(new Float32Array([0.5, -0.5, 0.5, -0.5]))
    fake.node.hear(new Float32Array([0, 0]))
    expect(frames[0]).toMatchObject({ rms: 0.5, end: 4, rate: 16_000 })
    expect(frames[0]?.level).toBeGreaterThan(0.5)
    expect(frames[1]).toMatchObject({ level: 0, rms: 0, end: 6 })
    // What was heard so far, from any point, while it goes on.
    expect([...recording.peek(3).samples]).toEqual([-0.5, 0, 0])
    expect([...recording.peek(4).samples]).toEqual([0, 0])
    expect(recording.peek(9).samples).toHaveLength(0)
    const { samples, sampleRate } = recording.stop()
    expect(sampleRate).toBe(16_000)
    expect([...samples]).toEqual([0.5, -0.5, 0.5, -0.5, 0, 0])
    expect(fake.track.stop).toHaveBeenCalled()
    expect(fake.close).toHaveBeenCalled()
  })

  it('records at the system’s own rate where it can’t give 16 kHz', async () => {
    install({ refuse16k: true, rate: 44_100 })
    const recording = await record(() => {})
    expect(recording.stop().sampleRate).toBe(44_100)
  })

  it('keeps nothing when cancelled', async () => {
    const fake = install()
    const recording = await record(() => {})
    recording.cancel()
    expect(fake.track.stop).toHaveBeenCalled()
    expect(fake.node.onaudioprocess).toBeNull()
  })

  it('fails as the browser does, so the composer can say why', async () => {
    install({ fail: new DOMException('none', 'NotFoundError') })
    await expect(record(() => {})).rejects.toMatchObject({ name: 'NotFoundError' })
  })
})
