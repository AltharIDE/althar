import { describe, expect, it } from 'vitest'

import { settingsSectionOf } from '../src/settings'

/* An address of Althar's Settings, as a link, a bookmark or an agent names it (ADR-097). */

describe('a Settings address', () => {
  it('opens its own section, an old one where its settings went, and nothing for anything else', () => {
    expect(settingsSectionOf('agents')).toBe('agents')
    expect(settingsSectionOf('plans-and-reviews')).toBe('tasks')
    expect(settingsSectionOf('dictation')).toBe('this-mac')
    expect(settingsSectionOf('toString')).toBeUndefined()
    expect(settingsSectionOf('nowhere')).toBeUndefined()
    expect(settingsSectionOf(7)).toBeUndefined()
  })
})
