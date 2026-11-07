import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Composer, DictationTray } from '@althar/ui'

import { SettingsPage } from '../src/renderer/features/settings/SettingsPage'
import { useStart } from '../src/renderer/features/start/useStart'
import type { DictationHost, DictationState } from '../src/renderer/data/services'
import { chooseMicrophone } from '../src/renderer/shared/dictation/microphones'
import { forgetSessions } from '../src/renderer/shared/dictation/sessions'
import { useDictation } from '../src/renderer/shared/dictation/useDictation'
import { fakeClient, fakeHost } from './fixtures'
import { withServices } from './render'

/*
 * Settings, Dictation: the microphone chosen is kept and is the one the
 * recorder opens; the permission says where it stands; the speech model can
 * be removed, and dictating after that brings it down again.
 */

const SIZE = 670_478_772

const state = (overrides: Partial<DictationState> = {}, model: Partial<DictationState['model']> = {}): DictationState => ({
  platform: 'darwin',
  microphone: 'granted',
  settings: true,
  ...overrides,
  model: { name: 'Parakeet TDT 0.6B v3', ready: true, got: SIZE, size: SIZE, downloading: false, ...model },
})

const gone = { ready: false, got: 0 }

const fakeDictation = (initial: DictationState, overrides: Partial<DictationHost> = {}) => {
  let now = initial
  const listeners = new Set<(event: unknown) => void>()
  const dictation: DictationHost = {
    state: vi.fn(async () => now),
    allow: vi.fn(async () => true),
    download: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    remove: vi.fn(async () => {
      now = { ...now, model: { ...now.model, ...gone } }
    }),
    prepare: vi.fn(async () => {}),
    transcribe: vi.fn(async () => ''),
    openSettings: vi.fn(async () => true),
    onEvent: vi.fn((listener: (event: unknown) => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }),
    ...overrides,
  }
  return {
    dictation,
    set: (next: DictationState) => (now = next),
    send: (event: unknown) => act(() => listeners.forEach((listener) => listener(event))),
  }
}

const devices = (list: Array<{ deviceId: string; label: string }>) =>
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      enumerateDevices: vi.fn(async () => list.map((d) => ({ kind: 'audioinput' as const, groupId: '', toJSON: () => ({}), ...d }))),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    configurable: true,
  })

const INPUTS = [
  { deviceId: 'built-in', label: 'MacBook Pro Microphone' },
  { deviceId: 'usb', label: 'Shure MV7' },
]

function Page() {
  return <SettingsPage start={useStart({ recheck: true })} section="dictation" onSection={() => {}} />
}

const show = (dictation?: DictationHost) =>
  withServices(<Page />, fakeClient().client, fakeHost(dictation === undefined ? {} : { dictation }))

afterEach(() => {
  chooseMicrophone(null)
  forgetSessions()
  localStorage.clear()
})

describe('Settings, Dictation: the microphone', () => {
  it('keeps the choice across launches, and the recorder opens it', async () => {
    devices(INPUTS)
    const host = fakeDictation(state())
    const view = show(host.dictation)
    const choose = await screen.findByRole('combobox', { name: 'Microphone' })
    expect(choose.textContent).toContain('System default')

    await userEvent.click(choose)
    await userEvent.click(await screen.findByRole('option', { name: 'Shure MV7' }))
    expect(JSON.parse(localStorage.getItem('althar.dictation.microphone') ?? 'null')).toEqual({ id: 'usb', label: 'Shure MV7' })
    expect(screen.getByRole('combobox', { name: 'Microphone' }).textContent).toContain('Shure MV7')

    // A new launch reads it back.
    view.unmount()
    show(host.dictation)
    expect((await screen.findByRole('combobox', { name: 'Microphone' })).textContent).toContain('Shure MV7')

    // And back to the system's default is kept too.
    await userEvent.click(screen.getByRole('combobox', { name: 'Microphone' }))
    await userEvent.click(await screen.findByRole('option', { name: 'System default' }))
    expect(localStorage.getItem('althar.dictation.microphone')).toBeNull()
  })

  it('is the device the recorder is given', async () => {
    devices(INPUTS)
    chooseMicrophone({ id: 'usb', label: 'Shure MV7' })
    const host = fakeDictation(state())
    const record = vi.fn(async () => ({
      peek: () => ({ samples: new Float32Array(1), sampleRate: 16_000 }),
      stop: () => ({ samples: new Float32Array(1), sampleRate: 16_000 }),
      cancel: vi.fn(),
      use: vi.fn(async () => {}),
    }))
    function Harness() {
      const voice = useDictation('thread:x', { record: record as never })
      return (
        <Composer
          value=""
          onChange={() => {}}
          onSubmit={() => {}}
          placeholder="Tell"
          inputRef={voice.inputRef}
          dictation={voice.dictation}
          tray={voice.tray && <DictationTray {...voice.tray} />}
        />
      )
    }
    withServices(<Harness />, fakeClient().client, fakeHost({ dictation: host.dictation }))
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await waitFor(() => expect(record).toHaveBeenCalled())
    expect((record.mock.calls[0] as unknown as [unknown, string | null])[1]).toBe('usb')
  })
})

describe('Settings, Dictation: the permission', () => {
  it('says it is allowed, with no way to open the system’s settings', async () => {
    show(fakeDictation(state()).dictation)
    expect(await screen.findByText('Allowed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open System Settings' })).toBeNull()
  })

  it('offers Open System Settings where it is denied, on macOS and Windows', async () => {
    const host = fakeDictation(state({ microphone: 'denied' }))
    show(host.dictation)
    await userEvent.click(await screen.findByRole('button', { name: 'Open System Settings' }))
    expect(host.dictation.openSettings).toHaveBeenCalledWith('privacy')
  })

  it('says on Linux that it can’t check, with nothing to open', async () => {
    show(fakeDictation(state({ platform: 'linux', microphone: 'granted', settings: false })).dictation)
    expect(await screen.findByText(/Althar can’t check this on your system/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open System Settings' })).toBeNull()
  })
})

describe('Settings, Dictation: the speech model', () => {
  it('says so when Remove didn’t work, and keeps the model shown', async () => {
    const host = fakeDictation(state(), {
      remove: vi.fn(async () => {
        throw new Error('busy')
      }),
    })
    show(host.dictation)
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('The speech model couldn’t be removed. Try again.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
  })

  it('shows its name and size, then removes it, and says dictating downloads it again', async () => {
    const host = fakeDictation(state())
    show(host.dictation)
    expect(await screen.findByText(/Parakeet TDT 0.6B v3, 670 MB on disk/)).toBeTruthy()
    expect(screen.getByText(/downloads it again/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(host.dictation.remove).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/isn’t on this computer. Dictating downloads it first/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('shows a download under way, with nothing to remove', async () => {
    const host = fakeDictation(state({}, { ready: false, got: 240_000_000, downloading: true }))
    show(host.dictation)
    expect(await screen.findByText(/Downloading Parakeet TDT 0.6B v3: 240 MB of 670 MB/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('removed, the next press offers the download again instead of listening', async () => {
    const host = fakeDictation(state())
    await host.dictation.remove()
    const record = vi.fn()
    function Harness() {
      const voice = useDictation('thread:y', { record: record as never })
      return (
        <Composer
          value=""
          onChange={() => {}}
          onSubmit={() => {}}
          placeholder="Tell"
          inputRef={voice.inputRef}
          dictation={voice.dictation}
          tray={voice.tray && <DictationTray {...voice.tray} />}
        />
      )
    }
    withServices(<Harness />, fakeClient().client, fakeHost({ dictation: host.dictation }))
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText('Dictation needs a speech model on this Mac')).toBeTruthy()
    expect(record).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => expect(host.dictation.download).toHaveBeenCalledTimes(1))
  })

  it('hears the model come or go from elsewhere', async () => {
    const host = fakeDictation(state())
    show(host.dictation)
    await screen.findByRole('button', { name: 'Remove' })
    await host.dictation.remove()
    host.send({ type: 'removed' })
    expect(await screen.findByText(/isn’t on this computer/)).toBeTruthy()
    within(document.body)
  })
})

describe('Settings, Dictation: a download from another window', () => {
  it('shows a download that starts while Settings is open', async () => {
    const host = fakeDictation(state({}, gone))
    show(host.dictation)
    expect(await screen.findByText(/isn’t on this computer/)).toBeTruthy()
    host.set(state({}, { ...gone, got: 100_000_000, downloading: true }))
    host.send({ type: 'progress', got: 100_000_000, size: SIZE })
    expect(await screen.findByText(/Downloading Parakeet TDT 0.6B v3: 100 MB of 670 MB/)).toBeTruthy()
    host.send({ type: 'progress', got: 300_000_000, size: SIZE })
    expect(await screen.findByText(/Downloading Parakeet TDT 0.6B v3: 300 MB of 670 MB/)).toBeTruthy()
    host.send({ type: 'progress', got: 500_000_000, size: SIZE })
    expect(await screen.findByText(/Downloading Parakeet TDT 0.6B v3: 500 MB of 670 MB/)).toBeTruthy()
  })
})

describe('Settings, Dictation: where there is none', () => {
  it('says so where the window can’t dictate', async () => {
    show()
    expect(await screen.findByText('Dictation isn’t available on this system.')).toBeTruthy()
  })
})
