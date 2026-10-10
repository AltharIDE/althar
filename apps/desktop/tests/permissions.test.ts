import { Decision, PermissionScope } from '@althar/ui'
import { describe, expect, it } from 'vitest'

import { permissionOf, replyOf, ruleWordsOf } from '../src/renderer/shared/permissions'

/*
 * A permission call as the kit's card asks it, and its answer as the
 * runtime takes it (ADR-017): only the always answers the runtime offers,
 * and only the scope of one goes back.
 */

const call = {
  id: 'a1',
  kind: 'permission' as const,
  title: 'Edit notes.md',
  reason: "Writing outside the task's worktree always asks: /Users/someone/notes.md",
  command: null,
  stuck: null,
  createdAt: '2026-10-10T09:00:00.000Z',
}

describe('a permission call, as the card asks it', () => {
  it('offers once and deny alone where the runtime says nothing of always', () => {
    expect(permissionOf(call)).toEqual({
      id: 'a1',
      what: 'Edit notes.md',
      cmd: 'Edit notes.md',
      why: call.reason,
      offers: [Decision.AllowOnce, Decision.Deny],
      scopes: { [Decision.AllowAlways]: [], [Decision.DenyAlways]: [] },
    })
  })

  it('offers an always by the scopes the runtime offers, a kind in its words', () => {
    const asked = permissionOf({ ...call, always: { command: null, prefix: null, kind: 'outside', allow: ['kind'], deny: ['kind'] } })
    expect([asked.kind, asked.prefix, asked.offers, asked.scopes]).toEqual([
      'writing outside the task’s worktree',
      undefined,
      [Decision.AllowOnce, Decision.AllowAlways, Decision.Deny, Decision.DenyAlways],
      { [Decision.AllowAlways]: [PermissionScope.Kind], [Decision.DenyAlways]: [PermissionScope.Kind] },
    ])
  })
})

describe('an answer, as the runtime takes it', () => {
  it('sends the decision, what to do instead, and the scope of an always', () => {
    expect(replyOf({ decision: Decision.AllowOnce, cmd: 'x' })).toEqual({ decision: 'allow' })
    expect(replyOf({ decision: Decision.AllowAlways, cmd: 'x', scope: PermissionScope.Exact })).toEqual({
      decision: 'allow',
      always: 'exact',
    })
    expect(replyOf({ decision: Decision.Deny, cmd: 'x', note: '' })).toEqual({ decision: 'reject' })
    expect(replyOf({ decision: Decision.Deny, cmd: 'x', note: 'Use the fixture' })).toEqual({
      decision: 'reject',
      reason: 'Use the fixture',
    })
    expect(replyOf({ decision: Decision.DenyAlways, cmd: 'x', scope: PermissionScope.Kind })).toEqual({
      decision: 'reject',
      always: 'kind',
    })
  })

  it('says the rule that let a request through', () => {
    expect(ruleWordsOf({ pattern: 'git status', match: 'prefix' })).toBe('commands starting “git status”')
    expect(ruleWordsOf({ pattern: 'git status -s', match: 'exact' })).toBe('this exact command')
    expect(ruleWordsOf({ kind: 'deploy' })).toBe('deploying and publishing')
  })
})
