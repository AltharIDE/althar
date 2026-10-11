import { describe, expect, it, vi } from 'vitest'

import { notesOf, type UpdateGlance, updating } from '../src/main/updates'
import { glanceOf } from '../src/renderer/shared/useUpdate'

/* The updater as `updating` sees it: a check that resolves or fails, and an install that may throw. */
const port = (check: () => Promise<unknown> = async () => undefined) => ({ check: vi.fn(check), install: vi.fn() })

describe('updates', () => {
  it('restart into an update only once Squirrel has it in place, and never while work runs', () => {
    const updater = port()
    const told: Array<UpdateGlance> = []
    const updates = updating(updater, (glance) => told.push(glance))

    updates.checking()
    updates.available('0.1.1')
    // Downloaded is not in place: until Squirrel says so, nothing shows and nothing restarts.
    expect(updates.restart()).toBe(false)
    expect(told).toEqual([])

    updates.working(true)
    updates.staged()
    expect(updates.glance()).toEqual({ ready: '0.1.1', working: true, restarting: false, failed: null })
    expect(updates.restart()).toBe(false)
    expect(updater.install).not.toHaveBeenCalled()

    updates.working(false)
    expect(updates.restart()).toBe(true)
    expect(updater.install).toHaveBeenCalledOnce()
    // Asked twice, it restarts once.
    expect(updates.restart()).toBe(false)
    expect(told.at(-1)).toEqual({ ready: '0.1.1', working: false, restarting: true, failed: null })
  })

  it('say why a restart didn’t happen, and keep the update ready to try again', () => {
    const updater = port()
    const updates = updating(updater, () => undefined)
    updates.available('0.1.1')
    updates.staged()
    updates.restart()
    updates.failed('Code signature at URL … did not pass validation')
    expect(updates.glance()).toEqual({
      ready: '0.1.1',
      working: false,
      restarting: false,
      failed: 'Code signature at URL … did not pass validation',
    })
    expect(updates.restart()).toBe(true)
    expect(updates.glance().failed).toBeNull()

    updater.install.mockImplementation(() => {
      throw new Error('No update available, can’t quit and install')
    })
    updates.failed('again')
    expect(updates.restart()).toBe(false)
    expect(updates.glance().failed).toBe('No update available, can’t quit and install')
  })

  it('look for an update only while none is coming or ready, and say what was found, failures included', async () => {
    const updater = port(async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED')
    })
    const updates = updating(updater, () => undefined)
    expect(await updates.check()).toEqual({ kind: 'failed', why: 'net::ERR_INTERNET_DISCONNECTED' })

    updater.check.mockImplementation(async () => updates.none())
    updates.checking()
    expect(await updates.check()).toEqual({ kind: 'none' })

    updates.available('0.1.1')
    expect(await updates.check()).toEqual({ kind: 'downloading', version: '0.1.1' })
    updates.staged()
    // A later check failing doesn't take away an update already in place.
    updates.failed('No published versions on GitHub')
    expect(await updates.check()).toEqual({ kind: 'ready', version: '0.1.1' })
    expect(updater.check).toHaveBeenCalledTimes(2)
  })

  it('read in the window only a glance the main process could have sent', () => {
    expect(glanceOf({ ready: '0.1.1', working: false, restarting: false, failed: null })).toEqual({
      ready: '0.1.1',
      working: false,
      restarting: false,
      failed: null,
    })
    expect(glanceOf(null)).toBeNull()
    expect(glanceOf({ ready: 1, working: false, restarting: false, failed: null })).toBeNull()
    expect(glanceOf({ ready: null, working: 'no', restarting: false, failed: null })).toBeNull()
    expect(glanceOf({ ready: null, working: false, restarting: false, failed: 2 })).toBeNull()
    expect(notesOf('0.1.0')).toBe('https://github.com/AltharIDE/althar/releases/tag/v0.1.0')
  })
})
