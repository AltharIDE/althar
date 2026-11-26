import { assert, describe, it } from '@effect/vitest'

import { unwatchedStep } from '../src/errandWaits'

describe('a step nothing of Althar’s would watch', () => {
  const head = { head: 'abc', branch: 'main' }
  it('is any merge not kept by its task: merge_pull_request keeps and binds one that is open already', () => {
    // 15 Nov's "merge the pull request once it's open".
    const branch = {
      tool: 'merge_pull_request',
      target: 'AltharIDE/althar pull request from althar/release-prep-althar-0-9-0',
      request: { pull_request: 'the one opened from althar/release-prep-althar-0-9-0' },
      waits: [{ kind: 'checks_passed' }],
    }
    assert.include(unwatchedStep(branch), 'can’t find a pull request by its title or branch')
    // Even its link, number, head and branch, which the merge line drops unless merge_pull_request bound them.
    const linked = {
      ...branch,
      head: 'abc',
      branch: 'main',
      target: 'https://github.com/AltharIDE/althar/pull/957',
      request: { repository: 'github:AltharIDE/althar', number: 957 },
      waits: [{ kind: 'checks' }],
    }
    assert.include(unwatchedStep(linked), 'call merge_pull_request on the person’s message')
    assert.include(unwatchedStep({ ...linked, target: 'althar/release-prep' }), 'call merge_pull_request')
    assert.isNull(unwatchedStep({ ...branch, target: 'task:release-prep', request: {}, waits: [{ kind: 'task_pull_request' }] }))
  })
  it('is a release step whose target doesn’t name its repository and tag', () => {
    const tag = { tool: 'push_tag', target: 'AltharIDE/althar tag v0.9.0', request: { tag: 'v0.9.0' }, waits: [{ kind: 'task_merged' }] }
    assert.isNull(unwatchedStep(tag))
    assert.include(unwatchedStep({ ...tag, target: 'v0.9.0' }), '<owner/repo> tag <tag>')
    assert.include(unwatchedStep({ ...tag, request: {} }), 'request {tag, …}')
    assert.isNull(unwatchedStep({ ...tag, tool: 'approve_release_run', target: 'AltharIDE/althar tag v0.9.0 approval' }))
    assert.include(unwatchedStep({ ...tag, tool: 'approve_release_run' }), '<owner/repo> tag <tag> approval')
    assert.isNull(unwatchedStep({ ...tag, tool: 'publish_release', target: 'AltharIDE/althar release v0.9.0' }))
  })
  it('is any other tool’s step waiting on anything but a task’s result; an unknown kind is keep’s to refuse', () => {
    const other = { tool: 'start_task', target: 'task:next', request: {} }
    assert.isNull(unwatchedStep({ ...other, waits: [{ kind: 'review_settled' }, { kind: 'lead_done' }] }))
    assert.include(
      unwatchedStep({ ...other, waits: [{ kind: 'checks' }, { kind: 'merge_line' }] }),
      'Althar watches checks, merge_line only for',
    )
    assert.isNull(unwatchedStep({ ...other, waits: [{ kind: 'merged' }] }))
  })
})
