import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Composer, DictationTray } from '@althar/ui'

import type { DictationHost, DictationState } from '../src/renderer/data/services'
import { microphonesOf, microphoneToUse } from '../src/renderer/shared/dictation/microphones'
import type { Frame, Record } from '../src/renderer/shared/dictation/recorder'
import { forgetSessions } from '../src/renderer/shared/dictation/sessions'
import { bytes, lengthOf, timeLeft, trayText } from '../src/renderer/shared/dictation/text'
import { together, useDictation } from '../src/renderer/shared/dictation/useDictation'
import { draftOf, forgetDrafts, setDraftDictated, setDraftText, useDraft } from '../src/renderer/shared/drafts'
import { sentWith } from '../src/renderer/shared/useImages'
import { fakeClient, fakeHost } from './fixtures'
import { withServices } from './render'

/*
 * Dictation in a composer: the first press offers the speech model, the
 * microphone is asked for before anything comes down, it listens once the
 * model is here, and what is said lands at the cursor, never sent.
 */

const SIZE = 670_478_772

const state = (overrides: Partial<DictationState> = {}, model: Partial<DictationState['model']> = {}): DictationState => ({
  platform: 'darwin',
  microphone: 'granted',
  settings: true,
  ...overrides,
  model: { ready: false, got: 0, size: SIZE, downloading: false, ...model },
})

/** A host's dictation, with its events sent by hand. */
const fakeDictation = (initial: DictationState, overrides: Partial<DictationHost> = {}) => {
  let now = initial
  const listeners = new Set<(event: unknown) => void>()
  const dictation: DictationHost = {
    state: vi.fn(async () => now),
    allow: vi.fn(async () => true),
    download: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    prepare: vi.fn(async () => {}),
    transcribe: vi.fn(async () => 'check the retry path'),
    openSettings: vi.fn(async () => true),
    onEvent: vi.fn((listener: (event: unknown) => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }),
    ...overrides,
  }
  const send = (event: unknown) => act(() => listeners.forEach((listener) => listener(event)))
  const set = (next: DictationState) => (now = next)
  return { dictation, send, set }
}

/** A microphone that hears `seconds` of something; `hear` plays it moments by hand. */
const fakeRecord = (seconds = 2, fail?: DOMException) => {
  const cancel = vi.fn()
  const use = vi.fn(async (_deviceId: string | null) => {})
  let onFrame: (frame: Frame) => void = () => {}
  const heard = () => ({ samples: new Float32Array(16_000 * seconds), sampleRate: 16_000 })
  const record = vi.fn<Record>(async (listener) => {
    if (fail !== undefined) throw fail
    onFrame = listener
    // Before the recording is handed over: heard by the bars, not by the writer.
    listener({ level: 0.5, rms: 0.1, end: 1024, rate: 16_000 })
    return { peek: heard, stop: heard, cancel, use }
  })
  /** A moment `at` seconds in: speech, or quiet. */
  const hear = (at: number, loud = true) =>
    act(() => onFrame({ level: loud ? 0.5 : 0, rms: loud ? 0.1 : 0.001, end: Math.round(at * 16_000), rate: 16_000 }))
  return { record, cancel, use, hear }
}

function Harness({ record, onSubmit, thread = 'thread:th1' }: { record: Record; onSubmit?: (text: string) => void; thread?: string }) {
  const [draft, setDraft] = useDraft(thread)
  const voice = useDictation(thread, { record, projectId: 'p1' })
  return (
    <Composer
      value={draft}
      onChange={setDraft}
      onSubmit={onSubmit ?? (() => {})}
      placeholder="Tell the lead"
      inputRef={voice.inputRef}
      dictation={voice.dictation}
      tray={voice.tray && <DictationTray {...voice.tray} />}
    />
  )
}

const show = (
  dictation: DictationHost,
  record: Record,
  props: { onSubmit?: (text: string) => void; initial?: string } = {},
  client = fakeClient().client,
) => {
  if (props.initial !== undefined) setDraftText('thread:th1', props.initial)
  return withServices(
    <Harness record={record} {...(props.onSubmit ? { onSubmit: props.onSubmit } : {})} />,
    client,
    fakeHost({ dictation }),
  )
}

/** The faint words the composer draws where what is said will land. */
const faint = () => document.querySelector('[aria-hidden="true"][class*="interim"]')?.textContent ?? ''

const shortcut = (overrides: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(window, { key: 'D', metaKey: true, shiftKey: true, ...overrides })

const field = () => screen.getByRole('textbox', { name: 'Tell the lead' })

describe('dictating the first time', () => {
  it('offers the model, asks for the microphone, downloads, then listens and writes at the cursor without sending', async () => {
    const host = fakeDictation(state({ microphone: 'ask' }))
    const { record } = fakeRecord()
    const onSubmit = vi.fn()
    show(host.dictation, record, { onSubmit })
    // Nothing is asked until the microphone is pressed: no speech process for a window that never dictates.
    expect(host.dictation.state).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText('Dictation needs a speech model on this Mac')).toBeTruthy()
    expect(screen.getByText(/670 MB, downloaded once/)).toBeTruthy()
    expect(host.dictation.download).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(host.dictation.allow).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(host.dictation.download).toHaveBeenCalledTimes(1))

    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_000)
    host.send({ type: 'progress', got: 100_000_000, size: SIZE })
    host.send({ type: 'progress', got: 200_000_000, size: SIZE })
    vi.restoreAllMocks()
    expect(screen.getByText('Downloading the speech model')).toBeTruthy()
    expect(screen.getByText(/200 MB of 670 MB, about 5 s/)).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Speech model download' })).toBeTruthy()

    // It lands while the tray is open: it listens, and loads the model as it does.
    host.set(state({}, { ready: true, got: SIZE }))
    host.send({ type: 'downloaded' })
    const stop = await screen.findByRole('button', { name: /^Stop dictating/ })
    expect(host.dictation.prepare).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('group', { name: 'Dictation' })).toBeNull()

    await userEvent.click(stop)
    await waitFor(() => expect(field()).toHaveProperty('value', 'check the retry path'))
    expect(host.dictation.transcribe).toHaveBeenCalledWith(expect.any(Float32Array), 16_000)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('downloads nothing when the microphone is refused, and says where to allow it', async () => {
    const host = fakeDictation(state({ microphone: 'ask' }), { allow: vi.fn(async () => false) })
    show(host.dictation, fakeRecord().record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Download' }))
    expect(await screen.findByText('Althar can’t use the microphone')).toBeTruthy()
    expect(host.dictation.download).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Open System Settings' }))
    expect(host.dictation.openSettings).toHaveBeenCalledWith('privacy')
  })

  it('closes the offer for now, and opens it again on the next press', async () => {
    const host = fakeDictation(state())
    show(host.dictation, fakeRecord().record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('group', { name: 'Dictation' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(await screen.findByRole('group', { name: 'Dictation' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Dictation' })).toBeNull())
  })

  it('carries on downloading with the tray hidden, the microphone ringed, and doesn’t listen when it lands', async () => {
    const host = fakeDictation(state())
    const { record } = fakeRecord()
    show(host.dictation, record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Download' }))
    host.send({ type: 'progress', got: SIZE / 2, size: SIZE })
    await userEvent.click(screen.getByRole('button', { name: 'Hide; the download carries on' }))
    expect(await screen.findByRole('button', { name: 'Dictate. The speech model is downloading, 50%' })).toBeTruthy()
    host.send({ type: 'downloaded' })
    expect(record).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeTruthy()
  })

  it('cancels a download and keeps nothing', async () => {
    const host = fakeDictation(state())
    show(host.dictation, fakeRecord().record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Download' }))
    host.send({ type: 'progress', got: 1_000_000, size: SIZE })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(host.dictation.cancel).toHaveBeenCalledTimes(1)
    host.send({ type: 'cancelled' })
    expect(screen.queryByRole('group', { name: 'Dictation' })).toBeNull()
  })

  it('picks up a stopped download, and says when the disk has no room', async () => {
    const host = fakeDictation(state())
    show(host.dictation, fakeRecord().record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Download' }))
    host.send({ type: 'stopped', stop: { reason: 'network' }, got: 291_000_000, size: SIZE })
    expect(screen.getByText('The download stopped')).toBeTruthy()
    expect(screen.getByText('At 291 MB of 670 MB. It carries on from there.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(host.dictation.download).toHaveBeenCalledTimes(2)
    host.send({ type: 'stopped', stop: { reason: 'space', need: SIZE, free: 2_400_000_000 }, got: 0, size: SIZE })
    expect(screen.getByText('It needs 670 MB; 2.4 GB is free. Make room, then try again.')).toBeTruthy()
    // Closing it keeps the stop in view: the model isn't there yet.
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(screen.getByText('Not enough space for the speech model')).toBeTruthy()
  })
})

describe('dictating with the model here', () => {
  const ready = () => fakeDictation(state({}, { ready: true, got: SIZE }))

  it('listens at once, shows the voice and the time, and writes it in between the words around the cursor', async () => {
    const host = ready()
    show(host.dictation, fakeRecord().record, { initial: 'Before the PR,run it again.' })
    const box = field() as HTMLTextAreaElement
    box.setSelectionRange(14, 14)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(await screen.findByRole('button', { name: 'Stop dictating, 0:00' })).toBeTruthy()
    expect(screen.getByPlaceholderText('Listening…')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^Stop dictating/ }))
    await waitFor(() => expect(box.value).toBe('Before the PR, check the retry path run it again.'))
  })

  it('marks the draft as dictated, keeps the mark through the person’s edits, and forgets it with the words', async () => {
    const host = ready()
    show(host.dictation, fakeRecord().record, { initial: 'Typed first. ' })
    expect(draftOf('thread:th1').dictated).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Stop dictating/ }))
    await waitFor(() => expect(field()).toHaveProperty('value', expect.stringContaining('check the retry path')))
    expect(draftOf('thread:th1').dictated).toBe(true)
    // Typing more, and cutting some of it away, leaves it dictated: some of its words came from the voice.
    await userEvent.type(field(), ' and the docs')
    expect(draftOf('thread:th1')).toMatchObject({ dictated: true })
    // What goes with it when it is sent says so; a typed one carries nothing.
    expect(sentWith({ sent: [], pictures: [], dictated: true })).toEqual({ dictated: true })
    expect(sentWith({ sent: [], pictures: [] })).toEqual({})
    // Sent, the composer is empty again, and the next message starts typed.
    setDraftText('thread:th1', '')
    expect(draftOf('thread:th1').dictated).toBe(false)
    setDraftDictated('thread:th1', true)
    expect(draftOf('thread:th1').dictated).toBe(false)
  })

  it('keeps the mark of dictated words that were kept, as the draft is read again', () => {
    forgetDrafts()
    setDraftText('thread:kept', 'Ask Alpha')
    setDraftDictated('thread:kept', true)
    setDraftText('thread:typed', 'Ask Althar')
    // A window that starts again reads them from its storage.
    forgetDrafts()
    expect(draftOf('thread:kept')).toMatchObject({ text: 'Ask Alpha', dictated: true })
    expect(draftOf('thread:typed')).toMatchObject({ text: 'Ask Althar', dictated: false })
  })

  it('loads the model once, however often it listens', async () => {
    const host = ready()
    show(host.dictation, fakeRecord().record)
    for (let i = 0; i < 2; i += 1) {
      await userEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
      await userEvent.click(await screen.findByRole('button', { name: /^Stop dictating/ }))
      await waitFor(() => expect(host.dictation.transcribe).toHaveBeenCalledTimes(i + 1))
    }
    expect(host.dictation.prepare).toHaveBeenCalledTimes(1)
  })

  it('throws it away on Escape', async () => {
    const host = ready()
    const { record, cancel } = fakeRecord()
    show(host.dictation, record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    await userEvent.keyboard('{Escape}')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(host.dictation.transcribe).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeTruthy()
  })

  it('writes nothing for a tap', async () => {
    const host = ready()
    show(host.dictation, fakeRecord(0.1).record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Stop dictating/ }))
    expect(host.dictation.transcribe).not.toHaveBeenCalled()
  })

  it('keeps what was said when it couldn’t be written down, to try again or throw away', async () => {
    const transcribe = vi.fn<DictationHost['transcribe']>().mockRejectedValueOnce(new Error('no')).mockResolvedValueOnce('second time')
    const host = fakeDictation(state({}, { ready: true }), { transcribe })
    show(host.dictation, fakeRecord().record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Stop dictating/ }))
    expect(await screen.findByText('Couldn’t write that down')).toBeTruthy()
    expect(screen.getByText('What you said (0:00) is kept; try again.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(field()).toHaveProperty('value', 'second time'))
    expect(transcribe).toHaveBeenCalledTimes(2)
    expect(transcribe.mock.calls[0]?.[0]).toBe(transcribe.mock.calls[1]?.[0])
  })

  it('throws away what couldn’t be written down', async () => {
    const host = fakeDictation(state({}, { ready: true }), { transcribe: vi.fn(async () => Promise.reject(new Error('no'))) })
    show(host.dictation, fakeRecord().record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Stop dictating/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Throw it away' }))
    expect(screen.queryByRole('group', { name: 'Dictation' })).toBeNull()
  })

  it('says there is no microphone, and where to choose one', async () => {
    const host = ready()
    show(host.dictation, fakeRecord(2, new DOMException('none', 'NotFoundError')).record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText('No microphone found')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open Sound settings' }))
    expect(host.dictation.openSettings).toHaveBeenCalledWith('sound')
  })

  it('takes a refusal from the browser as the system’s', async () => {
    show(ready().dictation, fakeRecord(2, new DOMException('no', 'NotAllowedError')).record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText('Althar can’t use the microphone')).toBeTruthy()
  })

  it('says a microphone turned off before is off, without asking again', async () => {
    const host = fakeDictation(state({ microphone: 'denied' }, { ready: true }))
    show(host.dictation, fakeRecord().record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText('Althar can’t use the microphone')).toBeTruthy()
    expect(host.dictation.allow).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('group', { name: 'Dictation' })).toBeNull()
  })

  it('names Linux’s settings in words, with no button to a place it can’t open', async () => {
    const host = fakeDictation(state({ platform: 'linux', microphone: 'denied', settings: false }, { ready: true }))
    show(host.dictation, fakeRecord().record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText(/Allow it in your desktop’s privacy or sound settings/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Open/ })).toBeNull()
  })
})

describe('dictation’s edges', () => {
  it('says it is waiting while the system asks for the microphone', async () => {
    let answer: (allowed: boolean) => void = () => {}
    const host = fakeDictation(state({ microphone: 'ask' }, { ready: true }), {
      allow: vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve))),
    })
    show(host.dictation, fakeRecord().record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText('Waiting for macOS to allow the microphone')).toBeTruthy()
    // Pressed again while it asks: nothing more happens.
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    act(() => answer(true))
    expect(await screen.findByRole('button', { name: /^Stop dictating/ })).toBeTruthy()
    expect(host.dictation.allow).toHaveBeenCalledTimes(1)
  })

  it('shows a download another window started, as it goes', async () => {
    const host = fakeDictation(state({}, { got: 335_000_000, downloading: true }))
    show(host.dictation, fakeRecord().record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText(/335 MB of 670 MB/)).toBeTruthy()
    host.send({ type: 'progress', got: 400_000_000, size: SIZE })
    host.send({ type: 'progress', got: 450_000_000, size: SIZE })
    host.send({ type: 'progress', got: 500_000_000, size: SIZE })
    expect(screen.getByText(/500 MB of 670 MB/)).toBeTruthy()
    // What isn't one of dictation's events is ignored.
    host.send({ type: 'something else' })
    host.send(null)
    expect(screen.getByText(/500 MB of 670 MB/)).toBeTruthy()
  })

  it('says the download stopped when it couldn’t start', async () => {
    const host = fakeDictation(state(), { download: vi.fn(async () => Promise.reject(new Error('gone'))) })
    show(host.dictation, fakeRecord().record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Download' }))
    expect(await screen.findByText('The download stopped')).toBeTruthy()
    // Escape leaves it in view: the model isn't there yet.
    await userEvent.keyboard('{Escape}')
    expect(screen.getByText('The download stopped')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(host.dictation.cancel).toHaveBeenCalledTimes(1)
  })

  it('does nothing when it can’t say where dictation stands', async () => {
    const host = fakeDictation(state(), { state: vi.fn(async () => Promise.reject(new Error('gone'))) })
    show(host.dictation, fakeRecord().record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(screen.queryByRole('group', { name: 'Dictation' })).toBeNull()
  })

  it('writes nothing when nothing was heard, and ignores a press while it writes', async () => {
    let finish: (text: string) => void = () => {}
    const host = fakeDictation(state({}, { ready: true }), {
      transcribe: vi.fn(() => new Promise<string>((resolve) => (finish = resolve))),
    })
    show(host.dictation, fakeRecord().record, { initial: 'as it was' })
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Stop dictating/ }))
    const writing = await screen.findByRole('button', { name: 'Writing down what you said' })
    await userEvent.click(writing)
    act(() => finish(''))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dictate' })).toBeTruthy())
    expect(field()).toHaveProperty('value', 'as it was')
    expect(host.dictation.transcribe).toHaveBeenCalledTimes(1)
  })

  it('takes a microphone that fails some other way as no microphone', async () => {
    show(fakeDictation(state({}, { ready: true })).dictation, fakeRecord(2, new Error('odd') as DOMException).record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText('No microphone found')).toBeTruthy()
  })

  it('lets other keys through while listening, and stops by itself at five minutes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const host = fakeDictation(state({}, { ready: true }))
      show(host.dictation, fakeRecord().record)
      await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
      await screen.findByRole('button', { name: /^Stop dictating/ })
      await userEvent.keyboard('a')
      expect(screen.getByRole('button', { name: /^Stop dictating/ })).toBeTruthy()
      for (let i = 0; i < 300; i += 1)
        act(() => {
          vi.advanceTimersByTime(1000)
        })
      await waitFor(() => expect(host.dictation.transcribe).toHaveBeenCalledTimes(1))
    } finally {
      vi.useRealTimers()
    }
  })

  it('goes on listening when the composer goes, carried with the person, and is still listening as it is back', async () => {
    const { record, cancel } = fakeRecord()
    const host = fakeDictation(state({}, { ready: true }))
    const { unmount } = show(host.dictation, record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    unmount()
    expect(cancel).not.toHaveBeenCalled()
    expect(host.dictation.transcribe).not.toHaveBeenCalled()
    show(host.dictation, record)
    await userEvent.click(await screen.findByRole('button', { name: /^Stop dictating/ }))
    await waitFor(() => expect(field()).toHaveProperty('value', 'check the retry path'))
    // Back before it was written down: nothing to say.
    expect(screen.queryByText('What you said was written down while you were away.')).toBeNull()
  })
})

describe('writing down as it is said', () => {
  it('shows what is heard faint where it will land, keeps the field still meanwhile, then writes it there', async () => {
    const host = fakeDictation(state({}, { ready: true }))
    const mic = fakeRecord()
    show(host.dictation, mic.record, { initial: 'Before the PR,run it again.' })
    const box = field() as HTMLTextAreaElement
    box.setSelectionRange(14, 14)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    mic.hear(0.5)
    mic.hear(1.1)
    await waitFor(() => expect(faint()).toBe('Before the PR, check the retry path run it again.'))
    expect(box.readOnly).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: /^Stop dictating/ }))
    await waitFor(() => expect(box.value).toBe('Before the PR, check the retry path run it again.'))
    expect(faint()).toBe('')
    expect(box.readOnly).toBe(false)
  })

  it('spells the project’s own names as its code does, reading them once a window', async () => {
    const host = fakeDictation(state({}, { ready: true }), { transcribe: vi.fn(async () => 'open use effect in the refund ledger') })
    const { client } = fakeClient()
    show(host.dictation, fakeRecord().record, {}, client)
    for (let i = 0; i < 2; i += 1) {
      await userEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
      await userEvent.click(await screen.findByRole('button', { name: /^Stop dictating/ }))
      await waitFor(() => expect(host.dictation.transcribe).toHaveBeenCalledTimes(i + 1))
    }
    await waitFor(() => expect(field()).toHaveProperty('value', 'open useEffect in the RefundLedger open useEffect in the RefundLedger'))
    expect(client.getVocabulary).toHaveBeenCalledTimes(1)
    expect(client.getVocabulary).toHaveBeenCalledWith('p1')
  })

  it('goes on without the project’s names when they can’t be read', async () => {
    const host = fakeDictation(state({}, { ready: true }), { transcribe: vi.fn(async () => 'the refund ledger') })
    const { client } = fakeClient({ getVocabulary: vi.fn(async () => Promise.reject(new Error('gone'))) })
    show(host.dictation, fakeRecord().record, {}, client)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Stop dictating/ }))
    await waitFor(() => expect(field()).toHaveProperty('value', 'the refund ledger'))
  })
})

describe('the shortcut', () => {
  it('starts with ⌘⇧D, and stops with it again', async () => {
    const host = fakeDictation(state({}, { ready: true }))
    show(host.dictation, fakeRecord().record)
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeTruthy()
    shortcut()
    fireEvent.keyUp(window, { key: 'Meta' })
    await screen.findByRole('button', { name: /^Stop dictating/ })
    // Held down, the key repeats: nothing more happens.
    shortcut({ repeat: true })
    expect(screen.getByRole('button', { name: /^Stop dictating/ })).toBeTruthy()
    shortcut({ metaKey: false, ctrlKey: true })
    await waitFor(() => expect(host.dictation.transcribe).toHaveBeenCalledTimes(1))
  })

  it('stops when let go after being held down', async () => {
    const host = fakeDictation(state({}, { ready: true }))
    show(host.dictation, fakeRecord().record)
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    shortcut()
    await screen.findByRole('button', { name: /^Stop dictating/ })
    now.mockReturnValue(11_000)
    fireEvent.keyUp(window, { key: 'Shift' })
    await waitFor(() => expect(host.dictation.transcribe).toHaveBeenCalledTimes(1))
    now.mockRestore()
  })

  it('opens the offer where there is no model yet, and leaves other keys alone', async () => {
    const host = fakeDictation(state())
    show(host.dictation, fakeRecord().record)
    shortcut({ shiftKey: false })
    shortcut({ altKey: true })
    expect(host.dictation.state).not.toHaveBeenCalled()
    shortcut()
    expect(await screen.findByText('Dictation needs a speech model on this Mac')).toBeTruthy()
  })

  it('goes to the composer shown last', async () => {
    const host = fakeDictation(state({}, { ready: true }))
    const first = fakeRecord()
    const second = fakeRecord()
    const { client } = fakeClient()
    withServices(
      <>
        <Harness record={first.record} thread="thread:th1" />
        <Harness record={second.record} thread="thread:th2" />
      </>,
      client,
      fakeHost({ dictation: host.dictation }),
    )
    shortcut()
    await screen.findByRole('button', { name: /^Stop dictating/ })
    expect(second.record).toHaveBeenCalledTimes(1)
    expect(first.record).not.toHaveBeenCalled()
  })

  it('shows itself in the microphone’s tooltip', async () => {
    show(fakeDictation(state()).dictation, fakeRecord().record)
    await userEvent.hover(screen.getByRole('button', { name: 'Dictate' }))
    await waitFor(() => expect(document.body.textContent).toMatch(/⌘⇧D|Ctrl\+Shift\+D/))
  })
})

/** The system's microphones, named or not as it names them; `change` plugs one in or pulls one out. */
const fakeDevices = (devices: Array<{ deviceId: string; label: string }>) => {
  let now = devices
  const listeners = new Set<() => void>()
  const list = () => now.map((device) => ({ kind: 'audioinput' as const, groupId: '', toJSON: () => ({}), ...device }))
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      enumerateDevices: vi.fn(async () => list()),
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    },
    configurable: true,
  })
  const change = async (next: Array<{ deviceId: string; label: string }>) => {
    now = next
    await act(async () => listeners.forEach((listener) => listener()))
  }
  /** The system names its microphones, as once one may be used, without saying a device changed. */
  const name = (next: Array<{ deviceId: string; label: string }>) => (now = next)
  return { change, name }
}

const NAMED = [
  { deviceId: 'default', label: 'Default - MacBook Pro Microphone' },
  { deviceId: 'built-in', label: 'MacBook Pro Microphone' },
  { deviceId: 'usb', label: 'Shure MV7' },
]

const microphoneMenu = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Choose the microphone' }))
  return screen.findByRole('menu', { name: 'Microphone' })
}

describe('choosing the microphone', () => {
  const ready = () => fakeDictation(state({}, { ready: true, got: SIZE }))
  afterEach(() => void Reflect.deleteProperty(navigator, 'mediaDevices'))

  it('offers only the system’s default while the system names no microphone', async () => {
    fakeDevices([{ deviceId: 'a', label: '' }])
    show(ready().dictation, fakeRecord().record)
    const menu = await microphoneMenu()
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['System default'])
    expect(within(menu).getByRole('menuitemradio', { name: 'System default' }).getAttribute('aria-checked')).toBe('true')
    expect(within(menu).getByText(/Other microphones show here/)).toBeTruthy()
  })

  it('lists the microphones after the default, hears the chosen one, and keeps it for next time', async () => {
    fakeDevices(NAMED)
    const { record } = fakeRecord()
    const { unmount } = show(ready().dictation, record)
    const menu = await microphoneMenu()
    // The system's own stand-in for its default isn't offered twice.
    await waitFor(() =>
      expect(
        within(menu)
          .getAllByRole('menuitemradio')
          .map((item) => item.textContent),
      ).toEqual(['System default', 'MacBook Pro Microphone', 'Shure MV7']),
    )
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Shure MV7' }))
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    expect(record).toHaveBeenLastCalledWith(expect.any(Function), 'usb')
    unmount()

    // Another launch: the choice is still there, and nothing listens from the last.
    forgetSessions()
    const again = fakeRecord()
    show(ready().dictation, again.record)
    const next = await microphoneMenu()
    await waitFor(() => expect(within(next).getByRole('menuitemradio', { name: 'Shure MV7' }).getAttribute('aria-checked')).toBe('true'))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    expect(again.record).toHaveBeenLastCalledWith(expect.any(Function), 'usb')
  })

  it('hears the default where the chosen microphone is gone, and the chosen one again when it is back', async () => {
    const devices = fakeDevices(NAMED)
    const { record } = fakeRecord()
    show(ready().dictation, record)
    await userEvent.click(within(await microphoneMenu()).getByRole('menuitemradio', { name: 'Shure MV7' }))
    await devices.change(NAMED.slice(0, 2))
    const menu = await microphoneMenu()
    await waitFor(() =>
      expect(within(menu).getByRole('menuitemradio', { name: 'System default' }).getAttribute('aria-checked')).toBe('true'),
    )
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    expect(record).toHaveBeenLastCalledWith(expect.any(Function), null)
    await userEvent.click(screen.getByRole('button', { name: /^Stop dictating/ }))
    await screen.findByRole('button', { name: 'Dictate' })

    // Plugged in again, under a new id: known by its name.
    await devices.change([...NAMED.slice(0, 2), { deviceId: 'usb-2', label: 'Shure MV7' }])
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    expect(record).toHaveBeenLastCalledWith(expect.any(Function), 'usb-2')
  })

  it('goes on from another microphone chosen while listening, keeping what was said, and Escape there closes only the list', async () => {
    fakeDevices(NAMED)
    const host = ready()
    const { record, use, cancel } = fakeRecord()
    show(host.dictation, record)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    expect(record).toHaveBeenLastCalledWith(expect.any(Function), null)

    let menu = await microphoneMenu()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(menu.isConnected).toBe(false))
    expect(cancel).not.toHaveBeenCalled()

    menu = await microphoneMenu()
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'MacBook Pro Microphone' }))
    expect(use).toHaveBeenCalledWith('built-in')
    expect(record).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: /^Stop dictating/ }))
    await waitFor(() => expect(field()).toHaveProperty('value', 'check the retry path'))
    expect(host.dictation.transcribe).toHaveBeenCalledTimes(1)
  })

  it('hears the chosen microphone once the system names it under a new id, while listening', async () => {
    window.localStorage.setItem('althar.dictation.microphone', JSON.stringify({ id: 'usb-old', label: 'Shure MV7' }))
    const devices = fakeDevices([{ deviceId: 'a', label: '' }])
    const { record, use } = fakeRecord()
    show(ready().dictation, record)
    // Named only once the microphone may be used: read again as it starts listening.
    devices.name(NAMED)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    expect(record).toHaveBeenLastCalledWith(expect.any(Function), 'usb-old')
    await waitFor(() => expect(use).toHaveBeenLastCalledWith('usb'))
  })

  it('goes back to the chosen microphone plugged in again while listening', async () => {
    const devices = fakeDevices(NAMED)
    const { record, use } = fakeRecord()
    show(ready().dictation, record)
    await userEvent.click(within(await microphoneMenu()).getByRole('menuitemradio', { name: 'Shure MV7' }))
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    expect(record).toHaveBeenLastCalledWith(expect.any(Function), 'usb')
    await devices.change(NAMED.slice(0, 2))
    expect(use).toHaveBeenLastCalledWith(null)
    await devices.change(NAMED)
    expect(use).toHaveBeenLastCalledWith('usb')
    expect(use).toHaveBeenCalledTimes(2)
  })

  it('still says there is no microphone when none can be had', async () => {
    fakeDevices([])
    show(ready().dictation, fakeRecord(2, new DOMException('none', 'NotFoundError')).record)
    await userEvent.click(screen.getByRole('button', { name: 'Choose the microphone' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText('No microphone found')).toBeTruthy()
  })

  it('reads the system’s microphones, and which of them to hear', () => {
    const named = microphonesOf([
      ...NAMED.map((device) => ({ kind: 'audioinput' as const, ...device })),
      { kind: 'audioinput', deviceId: 'communications', label: 'Communications - Headset' },
      { kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' },
      { kind: 'audioinput', deviceId: 'unnamed', label: '' },
    ])
    expect(named).toEqual([
      { id: 'built-in', label: 'MacBook Pro Microphone' },
      { id: 'usb', label: 'Shure MV7' },
    ])
    expect(microphoneToUse(null, named)).toBeNull()
    expect(microphoneToUse({ id: 'usb', label: 'Shure MV7' }, named)).toBe('usb')
    expect(microphoneToUse({ id: 'old', label: 'Shure MV7' }, named)).toBe('usb')
    expect(microphoneToUse({ id: 'gone', label: 'Gone' }, named)).toBeNull()
    // While the system names none, the chosen one is tried, and the recorder passes over it if it isn't there.
    expect(microphoneToUse({ id: 'usb', label: 'Shure MV7' }, [])).toBe('usb')
  })
})

describe('a window without dictation', () => {
  it('shows no microphone', () => {
    withServices(<Harness record={fakeRecord().record} />, fakeClient().client, fakeHost())
    expect(screen.queryByRole('button', { name: 'Dictate' })).toBeNull()
  })
})

describe('dictation’s words', () => {
  it('names each system’s machine and settings', () => {
    expect(trayText('win32').offer).toBe('Dictation needs a speech model on this PC')
    expect(trayText('linux').offer).toBe('Dictation needs a speech model on this computer')
    expect(trayText('darwin')).toEqual({})
  })

  it('says sizes, time left and lengths as the tray and composer show them', () => {
    expect(bytes(670_478_772)).toBe('670 MB')
    expect(bytes(2_400_000_000)).toBe('2.4 GB')
    expect(bytes(10)).toBe('1 MB')
    expect(timeLeft(100, 0)).toBeUndefined()
    expect(timeLeft(5_000_000, 1_000_000)).toBe('about 5 s')
    expect(timeLeft(600_000_000, 1_000_000)).toBe('about 10 min')
    expect(lengthOf(72)).toBe('1:12')
  })
})

describe('what couldn’t be written down, twice', () => {
  it('keeps both, as one to try again, even heard at different rates', () => {
    const first = { samples: new Float32Array(48_000 * 2).fill(0.25), sampleRate: 48_000, seconds: 2 }
    const second = { samples: new Float32Array(16_000 * 3).fill(0.5), sampleRate: 16_000, seconds: 3 }
    const kept = together(first, second)
    expect(kept.sampleRate).toBe(16_000)
    expect(kept.seconds).toBe(5)
    expect(kept.samples.length).toBe(16_000 * 5)
    // The first, at the second's rate, then the second.
    expect(kept.samples[0]).toBeCloseTo(0.25)
    expect(kept.samples[16_000 * 2 - 1]).toBeCloseTo(0.25)
    expect(kept.samples[16_000 * 2]).toBeCloseTo(0.5)
    expect(together(null, second)).toBe(second)
  })
})
