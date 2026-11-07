import { mcpCallOf, type PermissionRequest } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'

import { irreversibleOf } from '../src/irreversible'
import { mcpActOf } from '../src/mcpActs'
import { decide, MVP_RULES, type RuleContext } from '../src/rules'

const context: RuleContext = { worktree: '/work/althar/runs', defaultBranch: 'main', taskBranch: 'althar/runs' }
const everything: RuleContext = { ...context, project: { ...MVP_RULES, mode: 'allow' } }

const call = (title: string, rawInput: unknown, meta?: unknown): PermissionRequest => {
  const mcp = mcpCallOf(title, meta)
  return {
    sessionId: 's',
    toolCallId: 't',
    title,
    kind: 'other',
    rawInput,
    paths: [],
    options: [],
    ...(mcp === undefined ? {} : { mcp }),
  }
}

describe('MCP calls', () => {
  it('names the server and tool, as each agent spells them, and never Althar’s own', () => {
    assert.deepStrictEqual(mcpCallOf('mcp__github__merge_pull_request'), { server: 'github', tool: 'merge_pull_request' })
    assert.deepStrictEqual(mcpCallOf('mcp.linear.update_issue'), { server: 'linear', tool: 'update_issue' })
    assert.deepStrictEqual(
      mcpCallOf('Merge pull request', { claudeCode: { toolName: 'mcp__gh__merge_pull_request', mcpServer: { name: 'gh' } } }),
      {
        server: 'gh',
        tool: 'merge_pull_request',
      },
    )
    assert.isUndefined(mcpCallOf('mcp__althar__push_task'))
    assert.isUndefined(mcpCallOf('git push origin HEAD'))
  })

  it('reads a read as a read, and an act by what it does', () => {
    assert.isFalse(mcpActOf({ server: 'github', tool: 'get_pull_request' }, { pull_number: 612 }).acts)
    assert.isFalse(mcpActOf({ server: 'playwright', tool: 'browser_take_screenshot' }, {}).acts)
    const moved = mcpActOf({ server: 'linear', tool: 'update_issue' }, { id: 'DEV-188', stateId: 'review' })
    assert.isTrue(moved.acts)
    assert.isUndefined(moved.kind)
    assert.strictEqual(moved.done, 'Update issue DEV-188')
  })

  it('reads a merge, a release, a post and a deletion as what can’t be undone', () => {
    const merge = mcpActOf({ server: 'github', tool: 'merge_pull_request' }, { pull_number: 635, base: 'main' })
    assert.strictEqual(merge.kind, 'publish')
    assert.strictEqual(merge.verb, 'Merge #635')
    assert.include(merge.stays ?? '', 'main’s history')
    assert.strictEqual(mcpActOf({ server: 'github', tool: 'create_release' }, {}).kind, 'publish')
    const post = mcpActOf({ server: 'github', tool: 'add_issue_comment' }, { issue_number: 640, body: 'This one may not be needed.' })
    assert.strictEqual(post.kind, 'speak')
    assert.strictEqual(post.verb, 'Post on #640')
    assert.strictEqual(post.words, 'This one may not be needed.')
    assert.strictEqual(mcpActOf({ server: 'slack', tool: 'send_message' }, { text: 'Shipped' }).kind, 'speak')
    assert.strictEqual(mcpActOf({ server: 'github', tool: 'delete_branch' }, { branch: 'feature' }).kind, 'history')
    assert.strictEqual(mcpActOf({ server: 'github', tool: 'push_files' }, { branch: 'main' }).kind, 'history')
    // A review still pending, or a draft, isn't anyone's to read yet; submitting it is.
    assert.isUndefined(mcpActOf({ server: 'github', tool: 'create_pending_pull_request_review' }, {}).kind)
    assert.strictEqual(mcpActOf({ server: 'github', tool: 'submit_pending_pull_request_review' }, { pullNumber: 612 }).kind, 'speak')
  })

  it('reads a general call by its mutation or its method', () => {
    assert.isFalse(mcpActOf({ server: 'github', tool: 'graphql' }, { query: '{ viewer { login } }' }).acts)
    assert.strictEqual(
      mcpActOf({ server: 'github', tool: 'graphql' }, { query: 'mutation { mergePullRequest(input: {}) { clientMutationId } }' }).kind,
      'publish',
    )
    assert.isFalse(mcpActOf({ server: 'gitlab', tool: 'api' }, { method: 'GET', path: '/projects/1/merge_requests' }).acts)
    assert.strictEqual(
      mcpActOf({ server: 'gitlab', tool: 'api' }, { method: 'PUT', path: '/projects/1/merge_requests/2/merge' }).kind,
      'publish',
    )
  })

  it('asks before a merge through the person’s server, with everything allowed, and lets the rest through', () => {
    const merge = decide(call('mcp__github__merge_pull_request', { pull_number: 635 }), everything)
    assert.strictEqual(merge.verdict, 'ask')
    assert.strictEqual(decide(call('mcp__github__get_pull_request', { pull_number: 635 }), everything).verdict, 'allow')
    assert.strictEqual(decide(call('mcp__linear__update_issue', { id: 'DEV-188' }), everything).verdict, 'allow')
    // Never for a kind holds for an MCP call of it too.
    const never: RuleContext = { ...context, project: { ...MVP_RULES, mode: 'allow', never: ['speak'] } }
    assert.strictEqual(decide(call('mcp__github__add_issue_comment', { issue_number: 1, body: 'hi' }), never).verdict, 'deny')
  })

  it('asks before publishing, a release, a merge or tearing down with everything allowed, and lets a deploy through', () => {
    const run = (command: string) => decide({ ...call(command, { command }), kind: 'execute' }, everything).verdict
    assert.strictEqual(run('npm publish'), 'ask')
    assert.strictEqual(run('terraform destroy'), 'ask')
    assert.strictEqual(run('fly deploy'), 'allow')
    assert.strictEqual(irreversibleOf({ ...call('npm publish', { command: 'npm publish' }), kind: 'execute' }, everything)?.kind, 'publish')
  })

  it('says on the card what can’t be undone and where the call goes', () => {
    assert.deepStrictEqual(
      irreversibleOf(call('mcp__github__add_issue_comment', { issue_number: 640, body: 'Not needed once #635 merges.' }), everything),
      {
        kind: 'speak',
        verb: 'Post on #640',
        done: 'Posted on #640.',
        stays: 'Everyone watching it is told at once; it can’t be called back.',
        words: 'Not needed once #635 merges.',
        through: { server: 'github', tool: 'add_issue_comment' },
      },
    )
    const forced: PermissionRequest = {
      ...call('git push --force origin main', { command: 'git push --force origin main' }),
      kind: 'execute',
    }
    assert.strictEqual(irreversibleOf(forced, everything)?.kind, 'history')
    assert.deepStrictEqual(irreversibleOf(forced, everything)?.through, { command: 'git push --force origin main' })
    assert.isUndefined(irreversibleOf(call('mcp__github__get_pull_request', { pull_number: 1 }), everything))
  })

  it('says each kind of command that can’t be undone in its own words, and a merge through a server with no words to post', () => {
    const card = (command: string) => {
      const found = irreversibleOf({ ...call(command, { command }), kind: 'execute' }, everything)
      return found === undefined ? undefined : `${found.kind}: ${found.verb}`
    }
    assert.strictEqual(card('git push origin main'), 'history: Push to main')
    assert.strictEqual(card('git push origin --delete feature/other'), 'history: Delete it')
    const merge = irreversibleOf(call('mcp__github__merge_pull_request', { pull_number: 635 }), everything)
    assert.strictEqual(merge?.kind, 'publish')
    assert.isUndefined(merge?.words)
    assert.deepStrictEqual(merge?.through, { server: 'github', tool: 'merge_pull_request' })
  })
})
