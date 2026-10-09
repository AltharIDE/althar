import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_PREFERENCES, holds, isPreferenceKey, preferencesIn } from '../src/main/appPreferences'
import { keepingAwake } from '../src/main/awake'
import { dockCount, soundOf, tells } from '../src/main/notify'
import { alertSounds, playSound } from '../src/main/sounds'
import { readAppPreferences, writeAppPreference } from '../src/main/preferences'

/* The app's own preferences, kept by the main process in the profile's desktop.json, and what it does with them. */

const profile = () => mkdtempSync(join(tmpdir(), 'althar-preferences-'))

describe('the app’s preferences kept in the profile', () => {
  it('start awake while plugged in, every notification on, the count on, silent, and the first editor found', async () => {
    expect(await readAppPreferences(profile())).toEqual({
      keepAwake: true,
      awakeOnBattery: false,
      editor: null,
      notifyCalls: true,
      notifyReady: true,
      notifyStopped: true,
      badge: true,
      sound: null,
    })
  })

  it('read each as kept, and where it starts where what is kept isn’t one it can hold', () => {
    expect(preferencesIn({ keepAwake: false, sound: true, editor: 'zed', badge: 0, notifyReady: false })).toEqual({
      ...DEFAULT_PREFERENCES,
      keepAwake: false,
      editor: 'zed',
      notifyReady: false,
    })
    expect(preferencesIn({ editor: '../../bin/sh' }).editor).toBeNull()
    expect(preferencesIn({ editor: '' }).editor).toBeNull()
  })

  it('keep a change across a restart, beside the icon and whatever else the file holds', async () => {
    const at = join(profile(), 'new')
    expect(await writeAppPreference(at, 'keepAwake', false)).toBe(false)
    writeFileSync(join(at, 'desktop.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(at, 'desktop.json'), 'utf8')), icon: 'ink' }))
    await writeAppPreference(at, 'editor', 'cursor')
    await writeAppPreference(at, 'sound', 'Glass')
    expect(await readAppPreferences(at)).toEqual({ ...DEFAULT_PREFERENCES, keepAwake: false, editor: 'cursor', sound: 'Glass' })
    expect(JSON.parse(readFileSync(join(at, 'desktop.json'), 'utf8'))).toMatchObject({ icon: 'ink', keepAwake: false })
  })

  it('refuse a value a key can’t hold, and know only their own keys', async () => {
    const at = profile()
    await expect(writeAppPreference(at, 'badge', 'yes')).rejects.toThrow('badge')
    expect(await readAppPreferences(at)).toEqual(DEFAULT_PREFERENCES)
    expect(isPreferenceKey('sound')).toBe(true)
    expect(isPreferenceKey('icon')).toBe(false)
    expect(isPreferenceKey('toString')).toBe(false)
    expect(holds('editor', null)).toBe(true)
  })
})

/** A power source as Electron's, with the holds it gives counted. */
const power = (battery = false) => {
  let onBattery = battery
  let next = 1
  const held = new Set<number>()
  return {
    power: {
      hold: vi.fn(() => {
        held.add(next)
        return next++
      }),
      release: vi.fn((id: number) => void held.delete(id)),
      onBattery: vi.fn(() => onBattery),
    },
    held,
    unplug: (now: boolean) => {
      onBattery = now
    },
  }
}

describe('keeping the Mac awake', () => {
  it('holds while work runs and the person wants it, once, and lets go when nothing runs', () => {
    const { power: source, held } = power()
    const awake = keepingAwake(source)
    awake.wants({ keepAwake: true, awakeOnBattery: false })
    expect(held.size).toBe(0)
    awake.working(true)
    awake.working(true)
    expect(source.hold).toHaveBeenCalledOnce()
    expect(awake.holding()).toBe(true)
    awake.working(false)
    expect(held.size).toBe(0)
    expect(awake.holding()).toBe(false)
  })

  it('lets go when it is turned off while work runs, and holds again when turned back on', () => {
    const { power: source, held } = power()
    const awake = keepingAwake(source)
    awake.wants({ keepAwake: true, awakeOnBattery: false })
    awake.working(true)
    awake.wants({ keepAwake: false, awakeOnBattery: false })
    expect(held.size).toBe(0)
    awake.wants({ keepAwake: true, awakeOnBattery: false })
    expect(held.size).toBe(1)
  })

  it('holds on battery only when asked to, following the power source as it changes', () => {
    const { power: source, held, unplug } = power(true)
    const awake = keepingAwake(source)
    awake.wants({ keepAwake: true, awakeOnBattery: false })
    awake.working(true)
    expect(held.size).toBe(0)
    unplug(false)
    awake.powerChanged()
    expect(held.size).toBe(1)
    unplug(true)
    awake.powerChanged()
    expect(held.size).toBe(0)
    awake.wants({ keepAwake: true, awakeOnBattery: true })
    expect(held.size).toBe(1)
  })

  it('never asks the power source while there is nothing to hold for', () => {
    const { power: source } = power()
    const awake = keepingAwake(source)
    awake.wants({ keepAwake: true, awakeOnBattery: false })
    awake.powerChanged()
    expect(source.onBattery).not.toHaveBeenCalled()
  })
})

describe('what the person is told', () => {
  it('tells each kind of nudge by its own switch, and an unknown kind as a call', () => {
    const only = (key: 'notifyCalls' | 'notifyReady' | 'notifyStopped') => ({
      ...DEFAULT_PREFERENCES,
      notifyCalls: false,
      notifyReady: false,
      notifyStopped: false,
      [key]: true,
    })
    expect(tells('ready', only('notifyReady'))).toBe(true)
    expect(tells('ready', only('notifyCalls'))).toBe(false)
    expect(tells('stopped', only('notifyStopped'))).toBe(true)
    expect(tells('stopped', only('notifyReady'))).toBe(false)
    expect(tells('call', only('notifyCalls'))).toBe(true)
    expect(tells(undefined, only('notifyCalls'))).toBe(true)
    expect(tells('call', only('notifyStopped'))).toBe(false)
  })

  it('is silent with no sound chosen, and plays the one chosen', () => {
    expect(soundOf(DEFAULT_PREFERENCES)).toEqual({ silent: true })
    expect(soundOf({ ...DEFAULT_PREFERENCES, sound: 'Glass' })).toEqual({ silent: false, sound: 'Glass' })
    expect(holds('sound', '../../etc/passwd')).toBe(false)
  })

  it('counts on the Dock only while its count is on', () => {
    expect(dockCount(3, DEFAULT_PREFERENCES)).toBe(3)
    expect(dockCount(3, { ...DEFAULT_PREFERENCES, badge: false })).toBe(0)
  })
})

describe('the Mac’s alert sounds', () => {
  it('are the sounds in its folder, by name, in order, and none off a Mac or where the folder is missing', async () => {
    const folder = profile()
    for (const name of ['Purr.aiff', 'Glass.aiff', 'notes.txt']) writeFileSync(join(folder, name), '')
    expect(await alertSounds(folder, 'darwin')).toEqual(['Glass', 'Purr'])
    expect(await alertSounds(folder, 'linux')).toEqual([])
    expect(await alertSounds(join(folder, 'gone'), 'darwin')).toEqual([])
  })

  it('play only one of them', async () => {
    await expect(playSound('Sosumi; rm -rf ~', profile())).rejects.toThrow('no sound')
    await expect(playSound(42, profile())).rejects.toThrow('no sound')
  })
})
