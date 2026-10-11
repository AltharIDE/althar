import { afterEach, describe, expect, it, type Mock, vi } from 'vitest'

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

/** A microphone's one track, which says when it is pulled out. */
const fakeTrack = () => {
  const ended = new Set<() => void>()
  return {
    stop: vi.fn(),
    addEventListener: (_: string, listener: () => void) => ended.add(listener),
    pullOut: () => ended.forEach((listener) => listener()),
  }
}

type Constraints = { audio: { deviceId?: { exact: string } } }

const install = (
  options: { rate?: number; refuse16k?: boolean; fail?: DOMException; gone?: ReadonlyArray<string>; refuse?: ReadonlyArray<string> } = {},
) => {
  const track = fakeTrack()
  const node = new FakeNode()
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  /* Each stream after the first, by the microphone it came from. */
  const streams: Array<{ device: string | null; track: ReturnType<typeof fakeTrack>; source: { connect: Mock; disconnect: Mock } }> = []
  const close = vi.fn(async () => {})
  class FakeContext {
    readonly sampleRate: number
    readonly destination = {}
    constructor(init?: { sampleRate?: number }) {
      if (init?.sampleRate !== undefined && options.refuse16k === true) throw new DOMException('no', 'NotSupportedError')
      this.sampleRate = init?.sampleRate ?? options.rate ?? 48_000
    }
    createMediaStreamSource = (stream: { source?: unknown }) => stream.source ?? source
    createScriptProcessor = () => node
    close = close
  }
  vi.stubGlobal('AudioContext', FakeContext)
  let first = true
  const getUserMedia = vi.fn(async (constraints: Constraints) => {
    if (options.fail !== undefined) throw options.fail
    const device = constraints.audio.deviceId?.exact ?? null
    if (device !== null && options.gone?.includes(device)) throw new DOMException('gone', 'OverconstrainedError')
    if (device !== null && options.refuse?.includes(device)) throw new DOMException('no', 'NotAllowedError')
    if (first) {
      first = false
      return { getTracks: () => [track] }
    }
    const next = { device, track: fakeTrack(), source: { connect: vi.fn(), disconnect: vi.fn() } }
    streams.push(next)
    return { getTracks: () => [next.track], source: next.source }
  })
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  return { track, node, source, close, getUserMedia, streams }
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

describe('the microphone it hears', () => {
  const asked = (fake: ReturnType<typeof install>) => fake.getUserMedia.mock.calls.map(([c]) => c.audio.deviceId?.exact ?? null)

  it('hears the system’s default where none is chosen, and the chosen one by its id', async () => {
    const fake = install()
    ;(await record(() => {})).cancel()
    ;(await record(() => {}, 'usb')).cancel()
    expect(asked(fake)).toEqual([null, 'usb'])
    expect(fake.getUserMedia).toHaveBeenLastCalledWith({ audio: expect.objectContaining({ channelCount: 1, deviceId: { exact: 'usb' } }) })
  })

  it('hears the default where the chosen one is gone, without failing', async () => {
    const fake = install({ gone: ['usb'] })
    const recording = await record(() => {}, 'usb')
    expect(asked(fake)).toEqual(['usb', null])
    fake.node.hear(new Float32Array([0.25]))
    expect([...recording.stop().samples]).toEqual([0.25])
  })

  it('fails as before where the chosen one is refused, rather than hearing another', async () => {
    const fake = install({ refuse: ['usb'] })
    await expect(record(() => {}, 'usb')).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(asked(fake)).toEqual(['usb'])
  })

  it('goes on from another microphone, keeping what was heard, and lets go of the first', async () => {
    const fake = install()
    const recording = await record(() => {})
    fake.node.hear(new Float32Array([0.1, 0.2]))
    await recording.use('usb')
    expect(asked(fake)).toEqual([null, 'usb'])
    expect(fake.track.stop).toHaveBeenCalled()
    expect(fake.source.disconnect).toHaveBeenCalled()
    expect(fake.streams[0]?.source.connect).toHaveBeenCalledWith(fake.node)
    fake.node.hear(new Float32Array([0.3]))
    expect([...recording.stop().samples]).toEqual([0.1, 0.2, 0.3].map(Math.fround))
    expect(fake.streams[0]?.track.stop).toHaveBeenCalled()
  })

  it('goes on as it was where the other can’t be had', async () => {
    const fake = install({ refuse: ['usb'] })
    const recording = await record(() => {})
    await recording.use('usb')
    expect(fake.track.stop).not.toHaveBeenCalled()
    expect(fake.source.disconnect).not.toHaveBeenCalled()
  })

  it('hands over to the default when the chosen one is pulled out mid-way', async () => {
    const fake = install()
    const recording = await record(() => {}, 'usb')
    fake.track.pullOut()
    await vi.waitFor(() => expect(asked(fake)).toEqual(['usb', null]))
    await vi.waitFor(() => expect(fake.streams[0]?.source.connect).toHaveBeenCalledWith(fake.node))
    recording.stop()
    expect(fake.streams[0]?.track.stop).toHaveBeenCalled()
  })

  it('takes nothing up once it has stopped', async () => {
    const fake = install()
    const recording = await record(() => {})
    recording.cancel()
    await recording.use('usb')
    expect(fake.getUserMedia).toHaveBeenCalledTimes(1)
  })
})
