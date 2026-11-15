import { describe, expect, it } from '@effect/vitest'
import { agents } from '../src/registry'
import { startSignInFlow } from '../src/signInFlow'

describe('Althar’s native Copilot connection', () => {
  it('is bundled, owns its account and loop, and requires no engine download', () => {
    const agent = agents['copilot-direct']
    expect(agent.native).toBe('copilot')
    expect(agent.source).toBe('bundled')
    expect(agent.cli).toBeUndefined()
    expect(agent.signIn.status).toBeUndefined()
    expect(agent.signIn.inApp).toEqual({ kind: 'copilot-device', ways: ['browser'] })
    expect(agent.permissions).toMatchObject({ reasonInBand: true, allowScopes: { allow: 'once' } })
    expect(agent.home.shared(['auth.json', 'settings.json'])).toEqual([])
  })

  it('does not spawn a sign-in process or fall back to OpenCode', () => {
    expect(startSignInFlow(agents['copilot-direct'], () => undefined, { way: 'browser' })).toBeNull()
    expect(() => agents['copilot-direct'].launch(process.execPath)).toThrow('no external command')
    expect(agents.copilot.name).toBe('GitHub Copilot CLI')
  })
})
