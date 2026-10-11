import { CODEX, GPT_MINI, OPUS, SONNET } from '../../fixtures/models'
import { AllowedBy, Decision, PermissionPolicy, PermissionScope, TaskStatus } from '../../foundations/vocabulary'
import { trackOf } from '../../primitives/StepTrack/StepTrack'
import type { AllowedItem, PermissionRequest } from '../../thread/Permission/Permission'

/*
 * The exploration's one world: Meridian, whose rules are the kit's fixture
 * rules (the coordinator decides the rest), and task 418, which has three
 * requests waiting. The second is held by the "Always ask me" list, so it
 * can't be answered with "always allow"; every path shows that card too.
 */

export const PROJECT = 'Meridian'
export const PROJECT_DEFAULT = PermissionPolicy.Coordinator

/** The four modes, from the one that asks the most to the one that asks nothing. */
export const MODES_BY_ASKING = [
  PermissionPolicy.Ask,
  PermissionPolicy.Coordinator,
  PermissionPolicy.Rules,
  PermissionPolicy.AllowAll,
] as const

/** The modes in the words the desktop's rules page uses, with a short form for where there is little room. */
export const MODE_WORDS: Record<PermissionPolicy, { title: string; short: string; note: string }> = {
  [PermissionPolicy.Ask]: {
    title: 'Ask me',
    short: 'Ask me',
    note: 'What agents ask to do beyond the task’s own files waits for you.',
  },
  [PermissionPolicy.Coordinator]: {
    title: 'The coordinator decides',
    short: 'Coordinator decides',
    note: 'It allows or refuses within the rules, with a reason. What it can’t decide waits for you.',
  },
  [PermissionPolicy.Rules]: {
    title: 'Allow, except what you keep',
    short: 'Allow, except…',
    note: 'Agents carry on without stopping. What “Always ask me” lists waits for you.',
  },
  [PermissionPolicy.AllowAll]: {
    title: 'Allow everything',
    short: 'Allow everything',
    note: 'Nothing waits for you. What “Never” lists is still refused.',
  },
}

/** What holds whatever is allowed, in every path. */
export const STILL_HOLDS = 'Never still holds, and no agent reads your credentials or reaches the code host except through Althar.'

/** What Never names in Meridian's rules, said in a line. */
export const NEVER_NAMES = 'force pushes, aws s3 rm and doppler secrets'

export const TASK = {
  key: '418',
  title: 'Repair token refresh on privilege change',
  status: TaskStatus.Running,
  state: 'Verifying',
  lead: OPUS,
  branch: 'althar/418-token-refresh',
  since: 'verify · 4m',
  elapsed: '1h 52m',
  cost: '$3.80',
  steps: trackOf(['Requirements', 'Implement', 'Review', 'Verify'], 3),
}

/** The coordinator couldn't settle it, so it waits: "always allow" is offered. */
export const REPLAY: PermissionRequest = {
  id: 'replay',
  step: 'Verify on staging',
  agent: CODEX,
  what: 'Run a command that reaches staging',
  cmd: 'pnpm replay --env staging --from 2026-09-25 refunds',
  prefix: 'pnpm replay',
  why: 'The coordinator couldn’t settle it: replaying refunds writes to staging’s database.',
  kind: 'anything that reaches staging',
}

/** Held by the "Always ask me" list: never allow is offered, always allow isn't. */
export const PUBLISH: PermissionRequest = {
  id: 'publish',
  step: 'Docs',
  agent: GPT_MINI,
  what: 'Publish a preview of the docs',
  cmd: 'pnpm docs:publish --preview',
  prefix: 'pnpm docs:publish',
  kind: 'deploying or publishing',
  offers: [Decision.AllowOnce, Decision.AllowAlways, Decision.Deny, Decision.DenyAlways],
  scopes: { [Decision.AllowAlways]: [], [Decision.DenyAlways]: [PermissionScope.Exact, PermissionScope.Prefix, PermissionScope.Kind] },
}

export const LOGS: PermissionRequest = {
  id: 'logs',
  step: 'Verify on staging',
  agent: CODEX,
  what: 'Read staging logs',
  cmd: 'kubectl logs -n staging deploy/refunds --since=1h',
  prefix: 'kubectl logs',
  why: 'The coordinator couldn’t settle it: staging’s logs hold partner names.',
}

/** Task 418's queue, in the order they arrived. */
export const QUEUE: readonly PermissionRequest[] = [REPLAY, PUBLISH, LOGS]

/** The same, with the held one in front. */
export const HELD_FIRST: readonly PermissionRequest[] = [PUBLISH, REPLAY, LOGS]

/** Why the held card has no "always allow", as every path says it on the card. */
export const HELD_WHY = `Always allow isn’t offered: deploying or publishing is on ${PROJECT}’s “Always ask me” list, which comes before anything allowed.`

/** What went ahead on 418 while everything was allowed, for the line a bypass leaves when it ends. */
export const WENT_AHEAD: readonly AllowedItem[] = [
  {
    id: 'w1',
    step: 'Verify on staging',
    cmd: 'pnpm replay --env staging --from 2026-09-25 refunds',
    by: AllowedBy.Rule,
    rule: 'Allow everything',
  },
  {
    id: 'w2',
    step: 'Verify on staging',
    cmd: 'kubectl logs -n staging deploy/refunds --since=1h',
    by: AllowedBy.Rule,
    rule: 'Allow everything',
  },
  { id: 'w3', step: 'Docs', cmd: 'pnpm docs:publish --preview', by: AllowedBy.Rule, rule: 'Allow everything' },
  {
    id: 'w4',
    step: 'Verify on staging',
    cmd: 'psql "$STAGING_URL" -c "select count(*) from refunds"',
    by: AllowedBy.Rule,
    rule: 'Allow everything',
  },
]

/** Task 418 on the board, as WorkCard is given it. */
export const CARD = {
  task: TASK.key,
  kind: 'Delivery',
  title: TASK.title,
  steps: ['Requirements', 'Implement', 'Review', 'Verify'],
  at: 3,
  elapsed: '1h 52m',
  lead: OPUS,
  onStep: [SONNET],
}

/** Another task running beside it, which allows nothing out of the ordinary. */
export const OTHER_CARD = {
  task: '419',
  kind: 'Delivery',
  title: 'Migrate billing webhooks to the v2 endpoint',
  steps: ['Requirements', 'Implement', 'Review', 'Verify'],
  at: 1,
  elapsed: '22m',
  lead: OPUS,
}
