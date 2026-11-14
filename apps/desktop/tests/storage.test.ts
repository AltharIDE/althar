import { describe, expect, it } from 'vitest'

import { isPlace, showPlace } from '../src/main/storage'

/* What of About › Storage the main process does: names a place by id, and opens it in the file manager. */

describe('showing a place in the file manager', () => {
  const where = { profile: '/p', logs: '/p/logs', worktrees: '/w' }
  it('opens the folder the place names, and no other', async () => {
    const opened: string[] = []
    await showPlace(where, 'worktrees', async (path) => {
      opened.push(path)
      return ''
    })
    expect(opened).toEqual(['/w'])
  })
  it('fails with what the system said where it could not open it', async () => {
    await expect(showPlace(where, 'logs', async () => 'no file manager')).rejects.toThrow('no file manager')
  })
  it('knows only the places Althar keeps', () => {
    expect(isPlace('logs')).toBe(true)
    expect(isPlace('/etc')).toBe(false)
  })
})
