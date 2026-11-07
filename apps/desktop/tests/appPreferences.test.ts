import { describe, expect, it } from 'vitest'

import { DEFAULT_PREFERENCES, holds, preferencesIn } from '../src/main/appPreferences'

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
