import type { AllowedBy, AlwaysScope, AttentionRequest, RuleKind } from '@althar/contracts'
import { Decision, type PermissionAnswer, type PermissionRequest, PermissionScope } from '@althar/ui'

/*
 * A permission call as the kit asks it, and its answer as the runtime takes
 * it (ADR-018). The runtime says what an "always" would keep and the scopes
 * each always holds for; the card offers those and nothing else, so an
 * Allow always that the always-ask list would override is never offered.
 * The answer names only the scope: the runtime keeps the rule it offered.
 */

export const text = {
  /** Each kind of request, as the scope of an always: "Yes, and always allow ___ in meridian". */
  kinds: {
    'default-branch': 'pushes to the default branch',
    'force-push': 'force pushes',
    'many-branches': 'pushes of every branch, tags or a pattern of branches',
    'delete-branch': 'deleting branches that aren’t the task’s',
    deploy: 'deploying and publishing',
    outside: 'writing outside the task’s worktree',
  } satisfies Record<RuleKind, string>,
  /** A rule that let a request through, as its receipt says it. */
  prefix: (pattern: string) => `commands starting “${pattern}”`,
  exact: 'this exact command',
}

const toScope = (scope: AlwaysScope): PermissionScope => {
  switch (scope) {
    case 'exact':
      return PermissionScope.Exact
    case 'prefix':
      return PermissionScope.Prefix
    case 'kind':
      return PermissionScope.Kind
  }
}

const fromScope = (scope: PermissionScope): AlwaysScope => {
  switch (scope) {
    case PermissionScope.Exact:
      return 'exact'
    case PermissionScope.Prefix:
      return 'prefix'
    case PermissionScope.Kind:
      return 'kind'
  }
}

/** A permission call as the kit's card takes it: what it asks, why it waits, and the always answers the runtime offers, by scope. */
export const permissionOf = (call: AttentionRequest): PermissionRequest => {
  const allow = call.always?.allow ?? []
  const deny = call.always?.deny ?? []
  const prefix = call.always?.prefix ?? null
  const kind = call.always?.kind ?? null
  return {
    id: call.id,
    what: call.title,
    cmd: call.command ?? call.title,
    why: call.reason,
    ...(prefix === null ? {} : { prefix }),
    ...(kind === null ? {} : { kind: text.kinds[kind] }),
    offers: [
      Decision.AllowOnce,
      ...(allow.length > 0 ? [Decision.AllowAlways] : []),
      Decision.Deny,
      ...(deny.length > 0 ? [Decision.DenyAlways] : []),
    ],
    scopes: { [Decision.AllowAlways]: allow.map(toScope), [Decision.DenyAlways]: deny.map(toScope) },
  }
}

/** An answer as the runtime takes it: allowed or refused, with what to do instead, and the scope of an always. */
export interface Reply {
  readonly decision: 'allow' | 'reject'
  readonly reason?: string
  readonly always?: AlwaysScope
}

export const replyOf = (answer: PermissionAnswer): Reply => {
  switch (answer.decision) {
    case Decision.AllowOnce:
      return { decision: 'allow' }
    case Decision.AllowAlways:
      return { decision: 'allow', always: fromScope(answer.scope) }
    case Decision.Deny:
      return answer.note === '' ? { decision: 'reject' } : { decision: 'reject', reason: answer.note }
    case Decision.DenyAlways:
      return { decision: 'reject', always: fromScope(answer.scope) }
  }
}

/** The rule that let a request through, in words. */
export const ruleWordsOf = (rule: AllowedBy): string =>
  'kind' in rule ? text.kinds[rule.kind] : rule.match === 'exact' ? text.exact : text.prefix(rule.pattern)
