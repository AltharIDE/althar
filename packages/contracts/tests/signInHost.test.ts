import { describe, expect, it } from 'vitest'

import { signInHost } from '../src/signInHost'

describe('an enterprise sign-in address', () => {
  it.each(['company.ghe.com', 'https://company.ghe.com/', ' Company.GHE.com '])('accepts %s as a hostname', (input) => {
    expect(signInHost(input)).toBe('company.ghe.com')
  })

  it.each([
    '',
    'http://company.ghe.com',
    'https://name:secret@company.ghe.com',
    'https://company.ghe.com/login',
    'https://company.ghe.com?to=elsewhere',
    'https://company.ghe.com#fragment',
    'company.ghe.com:1234',
    'javascript:alert(1)',
    'not a host',
  ])('refuses %s', (input) => {
    expect(signInHost(input)).toBeNull()
  })
})
