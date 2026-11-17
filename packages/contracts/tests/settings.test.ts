import { describe, expect, it } from 'vitest'

import { MOVED_SETTINGS_SECTIONS, SETTINGS_SECTIONS, settingsSectionOf } from '../src/settings'

describe('a Settings address', () => {
  it('opens every current section and takes old links to the section their settings moved to', () => {
    for (const section of SETTINGS_SECTIONS) expect(settingsSectionOf(section)).toBe(section)
    for (const [before, after] of Object.entries(MOVED_SETTINGS_SECTIONS)) expect(settingsSectionOf(before)).toBe(after)
  })

  it('refuses unknown sections, inherited properties and values that are not strings', () => {
    for (const id of ['missing', '', 'toString', '__proto__', null, undefined, 1, {}, ['agents']])
      expect(settingsSectionOf(id)).toBeUndefined()
  })
})
