import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'

import { type AgentId, agents } from '../../src/registry'
import { signInStatus } from '../../src/signIn'
import { contract } from '../contract'

/*
 * The adapter contract against the real agents, as installed and signed in on
 * this machine: `bun run test:agents`. It sends a short prompt and a long one
 * that it cancels, so it costs a little usage. Pick agents with
 * CHARRETTE_AGENTS=codex,opencode.
 */

const cwd = mkdtempSync(join(tmpdir(), 'charrette-agents-'))

/** A model other than each agent's default, to switch to. */
const otherModel: Record<AgentId, string> = {
  'claude-code': 'sonnet',
  codex: 'gpt-5.6-luna',
  opencode: 'opencode-go/deepseek-v4-flash',
}

const only = process.env.CHARRETTE_AGENTS?.split(',')

for (const agent of Object.values(agents)) {
  if (only !== undefined && !only.includes(agent.id)) continue
  it.live(`${agent.name} is signed in`, () =>
    Effect.map(signInStatus(agent), (status) =>
      assert.notStrictEqual(status, 'signed_out', `${agent.name} is not signed in. Run: ${agent.signIn.login}`),
    ),
  )
  contract({
    name: agent.name,
    transport: (directory) => ({ _tag: 'Process', spec: agent.launch(process.execPath), cwd: directory }),
    cwd,
    modes: agent.modes,
    model: { optionId: agent.options.model, switchTo: otherModel[agent.id] },
    prompts: {
      short: 'Reply with exactly the word ok, and nothing else.',
      long: 'Count from 1 to 400, one number per line, with no other text.',
    },
  })
}
