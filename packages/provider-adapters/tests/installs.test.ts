import { describe, expect, it } from 'vitest'

import { locate, usingLocated } from '../src/installs'
import { agents } from '../src/registry'

/* Finding an agent's command: the person's own first, Althar's copy where they have none. */

const is =
  (...paths: Array<string>) =>
  (path: string) =>
    paths.includes(path)

describe('finding an agent’s command', () => {
  it('is the bare name on the PATH, else the full path where an installer put it, else Althar’s copy', () => {
    expect(locate('opencode', '/kept/opencode', { PATH: '/a:/b' }, ['/usual'], is('/b/opencode', '/usual/opencode'))).toEqual({
      command: 'opencode',
      whose: 'theirs',
    })
    expect(locate('opencode', '/kept/opencode', { PATH: '/a' }, ['/usual'], is('/usual/opencode', '/kept/opencode'))).toEqual({
      command: '/usual/opencode',
      whose: 'theirs',
    })
    expect(locate('opencode', '/kept/opencode', { PATH: '' }, [], is('/kept/opencode'))).toEqual({
      command: '/kept/opencode',
      whose: 'althar',
    })
    expect(locate('opencode', null, { PATH: '' }, [], is())).toBeNull()
  })

  it('points every command the agent runs at it, looked up each time, and leaves an agent Althar can’t fetch as it is', () => {
    let found: { command: string; whose: 'theirs' | 'althar' } | null = null
    const pointed = usingLocated(agents.opencode, () => found)
    expect(pointed.launch('node').command).toBe('opencode')
    found = { command: '/kept/opencode', whose: 'althar' }
    expect(pointed.launch('node')).toMatchObject({ command: '/kept/opencode', args: ['acp'] })
    expect(pointed.signIn.status('node').command).toBe('/kept/opencode')
    expect(pointed.version?.('node').command).toBe('/kept/opencode')
    expect(usingLocated(agents.codex, () => found)).toBe(agents.codex)
  })
})
