import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'

import { readinessOf } from '../src/agentRuns.ts'
import { AgentWorkerReadinessSchema } from '../src/gen/althar/worker/v1/control_pb.ts'

/* What a worker says its check found, kept by the home to what it can show and trust. */

describe('a worker’s check, as its home keeps it', () => {
  it('keeps its sandbox, its fix to copy, its tools and its agents’ models', () => {
    expect(
      readinessOf(
        create(AgentWorkerReadinessSchema, {
          sandboxStarts: false,
          sandboxProblem: 'NoUserNamespaces',
          sandboxFix: "sudo sh -c 'apparmor_parser -r x'",
          tools: [
            { name: 'bun', version: '1.3.5' },
            { name: 'node', version: '24.11.0' },
          ],
          models: [{ providerId: 'claude-code', models: [{ id: 'opus', name: 'Claude Opus 5.5' }] }],
          agents: [
            { providerId: 'claude-code', starts: true, problem: '' },
            { providerId: 'codex', starts: false, problem: 'Not signed in.' },
          ],
        }),
      ),
    ).toEqual({
      sandbox: { starts: false, problem: 'NoUserNamespaces', fix: "sudo sh -c 'apparmor_parser -r x'" },
      tools: [
        { name: 'bun', version: '1.3.5' },
        { name: 'node', version: '24.11.0' },
      ],
      models: [{ providerId: 'claude-code', models: [{ id: 'opus', name: 'Claude Opus 5.5' }] }],
      agents: [
        { providerId: 'claude-code', starts: true },
        { providerId: 'codex', starts: false, problem: 'Not signed in.' },
      ],
    })
  })

  it('drops what it can’t trust: an unknown problem, a fix over lines, a tool or a model it couldn’t show', () => {
    expect(
      readinessOf(
        create(AgentWorkerReadinessSchema, {
          sandboxStarts: false,
          sandboxProblem: '<script>',
          sandboxFix: 'sudo x\nrm y',
          tools: [
            { name: 'Bad Name', version: '1' },
            { name: 'git', version: '' },
          ],
          models: [
            { providerId: 'Not A Provider', models: [{ id: 'x', name: 'X' }] },
            {
              providerId: 'codex',
              models: [
                { id: 'a\u0007', name: 'Bell' },
                { id: 'gpt', name: 'GPT' },
              ],
            },
          ],
        }),
      ),
    ).toEqual({
      sandbox: { starts: false, problem: 'Failed' },
      tools: [],
      models: [{ providerId: 'codex', models: [{ id: 'gpt', name: 'GPT' }] }],
      agents: [],
    })
    expect(readinessOf(create(AgentWorkerReadinessSchema, { sandboxStarts: true, sandboxProblem: 'Failed' })).sandbox).toEqual({
      starts: true,
    })
  })
})
