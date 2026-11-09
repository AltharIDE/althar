import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

// Run the installed adapter's actual sendPrompt method against a recording app-server.
// This catches an upstream turn policy overriding the session's CODEX_CONFIG.
const source = readFileSync(createRequire(import.meta.url).resolve('@agentclientprotocol/codex-acp'), 'utf8')
const start = source.indexOf('  async sendPrompt(')
const end = source.indexOf('  async setCollaborationMode(', start)
const method = source.slice(start, end).trim().replace('async sendPrompt(', 'async function(')
const sendPrompt = new Function('buildPromptItems', 'addAdditionalDirectoriesToSandboxPolicy', `return (${method})`)(
  () => [],
  (policy: unknown) => policy,
) as (this: unknown, ...args: unknown[]) => Promise<unknown>

describe('Codex’s sandbox on every turn', () => {
  for (const type of ['workspaceWrite', 'readOnly'])
    for (const network of [true, false])
      it(`${type} respects network_access=${network} without changing approval policy`, async () => {
        let sent: Record<string, unknown> = {}
        const client = {
          config: { 'sandbox_workspace_write.network_access': network },
          refreshSkills: () => Promise.resolve(),
          codexClient: {
            runTurn: (turn: Record<string, unknown>) => {
              sent = turn
              return Promise.resolve()
            },
          },
        }
        const policy = { type, networkAccess: false, writableRoots: ['/work'] }
        const mode = { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: policy }
        await sendPrompt.call(
          client,
          { sessionId: 'probe', prompt: [] },
          mode,
          { model: 'test', effort: 'low' },
          null,
          false,
          '/work',
          [],
          undefined,
          undefined,
        )
        expect(sent.sandboxPolicy).toEqual({ ...policy, networkAccess: network })
        expect(sent.approvalPolicy).toBe('on-request')
        expect(sent.approvalsReviewer).toBe('user')
        expect(policy.networkAccess).toBe(false)
      })

  // Codex reads only its own safe list without asking: anything else, an irreversible host command included, reaches Althar.
  it('takes Althar’s approval policy for the turn when it sets one', async () => {
    process.env.ALTHAR_APPROVAL_POLICY = 'untrusted'
    try {
      let sent: Record<string, unknown> = {}
      const client = {
        config: { 'sandbox_workspace_write.network_access': true },
        refreshSkills: () => Promise.resolve(),
        codexClient: {
          runTurn: (turn: Record<string, unknown>) => {
            sent = turn
            return Promise.resolve()
          },
        },
      }
      const policy = { type: 'workspaceWrite', networkAccess: false, writableRoots: ['/work'] }
      await sendPrompt.call(
        client,
        { sessionId: 'probe', prompt: [] },
        { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: policy },
        { model: 'test', effort: 'low' },
        null,
        false,
        '/work',
        [],
        undefined,
        undefined,
      )
      expect(sent.approvalPolicy).toBe('untrusted')
      expect(sent.sandboxPolicy).toEqual({ ...policy, networkAccess: true })
    } finally {
      delete process.env.ALTHAR_APPROVAL_POLICY
    }
  })
})
