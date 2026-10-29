import { describe, expect, it } from 'vitest'

import { commandStartOf, hostOf, runsOutside } from '../src/sandbox'

describe('a host a lead’s sandbox lets through', () => {
  it('takes its name alone, in lower case, from an address or a name with a port', () => {
    expect(hostOf('github.com')).toBe('github.com')
    expect(hostOf('  API.GitHub.com  ')).toBe('api.github.com')
    expect(hostOf('https://registry.npmjs.org/some/package')).toBe('registry.npmjs.org')
    expect(hostOf('example.com:8443')).toBe('example.com')
    expect(hostOf('localhost:5173')).toBe('localhost')
  })

  it('takes nothing that isn’t one host’s name', () => {
    expect(hostOf('')).toBeNull()
    expect(hostOf('   ')).toBeNull()
    expect(hostOf('*.github.com')).toBeNull()
    expect(hostOf('http://[')).toBeNull()
    expect(hostOf('intranet')).toBeNull()
    expect(hostOf('192.168.0.1')).toBe('192.168.0.1')
  })
})

describe('a command a lead’s sandbox lets through', () => {
  it('runs outside the sandbox unless it starts with bun, wherever bun is', () => {
    expect(runsOutside('bunx vitest run')).toBe(true)
    expect(runsOutside('npx playwright test')).toBe(true)
    expect(runsOutside('bun run test')).toBe(false)
    expect(runsOutside('  /usr/local/bin/bun test')).toBe(false)
    expect(runsOutside('')).toBe(true)
  })

  it('takes how it starts, with single spaces, and nothing that would stay inside', () => {
    expect(commandStartOf('  bunx   vitest  run ')).toBe('bunx vitest run')
    expect(commandStartOf('npx playwright *')).toBe('npx playwright')
    expect(commandStartOf('')).toBeNull()
    expect(commandStartOf(' * ')).toBeNull()
    expect(commandStartOf('bun run dev')).toBeNull()
  })
})
