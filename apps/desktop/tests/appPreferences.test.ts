import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { chosenWorktrees } from '@althar/runtime/locations'

import { DEFAULT_PREFERENCES, holds, preferencesIn } from '../src/main/appPreferences'
import { writeAppPreference } from '../src/main/preferences'

describe('the task folder preference', () => {
  it('starts as the platform’s default', () => {
    expect(DEFAULT_PREFERENCES.worktrees).toBeNull()
  })

  it('holds a full path, or none', () => {
    expect(holds('worktrees', null)).toBe(true)
    expect(holds('worktrees', '/data/tasks')).toBe(true)
    expect(holds('worktrees', 'C:\\Tasks')).toBe(true)
    expect(holds('worktrees', 'tasks')).toBe(false)
    expect(holds('worktrees', '')).toBe(false)
    expect(holds('worktrees', 3)).toBe(false)
  })

  it('is read back as kept, and as the default where what is kept is no path', () => {
    expect(preferencesIn({ worktrees: '/data/tasks' }).worktrees).toBe('/data/tasks')
    expect(preferencesIn({ worktrees: 'tasks' }).worktrees).toBeNull()
  })
})

describe('the task folder the app keeps', () => {
  it('is the one the command line reads, from the same profile', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'althar-profile-'))
    await writeAppPreference(profile, 'keepAwake', false)
    await writeAppPreference(profile, 'worktrees', '/Volumes/Ext/Althar')
    expect(chosenWorktrees(profile)).toBe('/Volumes/Ext/Althar')
    await writeAppPreference(profile, 'worktrees', null)
    expect(chosenWorktrees(profile)).toBeNull()
    rmSync(profile, { recursive: true, force: true })
  })
})
