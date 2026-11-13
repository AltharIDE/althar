import { describe, expect, it } from 'vitest'

import { agents } from '../src/registry'
import { startSignInFlow, type SignInFlowEvent } from '../src/signInFlow'

describe('Copilot without Copilot CLI', () => {
  it('runs the Copilot provider through OpenCode, with every command still asking', () => {
    const agent = agents['copilot-direct']
    const spec = agent.launch(process.execPath)
    expect(spec.command).toBe('opencode')
    expect(spec.args).toEqual(['acp', '--standalone'])
    const config = JSON.parse(spec.env?.OPENCODE_CONFIG_CONTENT ?? '{}')
    expect(config.enabled_providers).toEqual(['github-copilot'])
    expect(config.permission.bash).toBe('ask')
    expect(config.permission.edit).toBe('ask')
    expect(agent.signIn.paidBy?.('')).toBe('plan')
    expect(agent.signIn.read('[]', 0)).toBe(false)
    expect(agent.signIn.read('[{"id":"openai","connections":[{}]}]', 0)).toBe(false)
    expect(agent.signIn.read('[{"id":"github-copilot","connections":[{}]}]', 0)).toBe(true)
    expect(agent.signIn.login).toBe('')
    expect(agents.copilot.launch(process.execPath).command).toBe('copilot')
  })

  it('answers the enterprise form without a terminal or a shell command', () => {
    const run = agents['copilot-direct'].signIn.inApp?.run
    expect(run?.(process.execPath).args).toContain('deploymentType=github.com')
    expect(run?.(process.execPath, 'company.ghe.com').args).toEqual([
      'auth',
      'login',
      'github-copilot',
      '--standalone',
      '--method',
      'device',
      '--answer',
      'deploymentType=enterprise',
      '--answer',
      'enterpriseUrl=company.ghe.com',
    ])
  })

  it('shows a split device code and opens only the selected GitHub host', async () => {
    const opened: string[] = []
    const events: SignInFlowEvent[] = []
    await new Promise<void>((resolve) => {
      const agent = agents['copilot-direct']
      const handle = startSignInFlow(
        {
          ...agent,
          signIn: {
            ...agent.signIn,
            inApp: {
              kind: 'opencode-copilot',
              ways: ['browser'],
              run: () => ({
                command: process.execPath,
                args: [
                  '-e',
                  "process.stdout.write('\\x1b[32mEnter code: ABCD-'); process.stderr.write('https://company.ghe.com/login/device\\n'); process.stdout.write('1234\\x1b[0m\\n');",
                ],
              }),
            },
          },
        },
        (event) => {
          events.push(event)
          if (event.kind === 'done' || event.kind === 'failed') resolve()
        },
        { way: 'browser', host: 'company.ghe.com', openUrl: (url) => void opened.push(url) },
      )
      expect(handle).not.toBeNull()
    })
    expect(opened).toEqual(['https://company.ghe.com/login/device'])
    expect(events).toContainEqual({ kind: 'device', code: 'ABCD-1234', page: opened[0], minutes: 15 })
    expect(events.at(-1)?.kind).toBe('done')
  })
})
