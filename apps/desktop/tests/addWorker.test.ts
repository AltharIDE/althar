import { describe, expect, it } from 'vitest'

import { problemOf, sshTargetOf } from '../src/renderer/features/settings/useAddWorker'

describe('adding a worker, in words', () => {
  it('reads an address as it would be typed after ssh, with a port', () => {
    expect(sshTargetOf('ssh build@box:2222')).toEqual({ target: 'build@box', port: 2222 })
    expect(sshTargetOf('box')).toEqual({ target: 'box' })
    expect(sshTargetOf('box:70000')).toBeNull()
    expect(sshTargetOf('not an address')).toBeNull()
  })

  it('stops a login that doesn’t linger with the line for its administrator, and tries again once it has run', () => {
    const setup = { name: 'box', target: { target: 'build@box' } }
    expect(problemOf('LingerOff', setup, 'sudo loginctl enable-linger -- build')).toEqual({
      title: 'box would stop the worker whenever you log out.',
      body: 'Its login can’t keep services running on its own. Have its administrator run this, then try again:',
      command: 'sudo loginctl enable-linger -- build',
      retry: true,
    })
    expect(problemOf('NoRelease', setup).retry).toBe(false)
    expect(problemOf('AuthFailed', setup).command).toBe('ssh build@box')
  })
})
