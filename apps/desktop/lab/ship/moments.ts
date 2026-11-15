import type { ChangeSummary, ChangedFile, MergeNeed, ThreadItem, ThreadSnapshot } from '@althar/contracts'

import { change, items, snapshot } from '../../tests/fixtures'

/*
 * The path a task with a pull request takes, from Ship to merged, as #820
 * ("Enter waits for a running voice note before sending") took it: each
 * moment as the runtime on main describes it to the app today. The real task
 * screen draws each one; the directions only change the Change card's buttons
 * and lines.
 */

export const TITLE = 'Enter waits for a running voice note before sending'
const SLUG = 'enter-waits-for-a-running-voice-note-before-send'
const URL = 'https://github.com/AltharIDE/althar/pull/820'
export const LEAD = 'claude-code'
export const REVIEWER = 'codex'

const FILES: ChangedFile[] = [
  { path: 'packages/ui/src/composer/Composer/Composer.tsx', add: 58, del: 14 },
  { path: 'packages/ui/src/composer/Composer/Composer.module.css', add: 21, del: 2 },
  { path: 'packages/ui/src/composer/Composer/Composer.stories.tsx', add: 96, del: 18 },
  { path: 'packages/ui/tests/ComposerDictation.test.tsx', add: 88, del: 1 },
  { path: 'apps/desktop/src/renderer/shared/dictation/useDictation.ts', add: 4, del: 0 },
  { path: 'apps/desktop/tests/dictationSend.test.tsx', add: 214, del: 0 },
].map((one) => ({ ...one, from: null, status: 'modified' as const, binary: false, uncommitted: false }))

type Check = NonNullable<ChangeSummary['checks']>['list'][number]
type State = Check['state']

/** The repository's checks: verify is the one main requires; e2e and stress run once it's ready, and hold nothing back on GitHub. */
export const REQUIRED = 'verify'
const checksOf = (verify: State, e2e1?: State, e2e2?: State, stress?: State): ChangeSummary['checks'] => {
  const list: Check[] = [
    { name: REQUIRED, state: verify, summary: null },
    ...(e2e1 === undefined ? [] : [{ name: 'e2e (1)', state: e2e1, summary: null }]),
    ...(e2e2 === undefined ? [] : [{ name: 'e2e (2)', state: e2e2, summary: e2e2 === 'failed' ? '1 failed' : null }]),
    ...(stress === undefined ? [] : [{ name: 'stress', state: stress, summary: null }]),
  ]
  const passed = list.filter((one) => one.state === 'passed').length
  const failed = list.filter((one) => one.state === 'failed')
  const running = list.filter((one) => one.state === 'running' || one.state === 'queued').length
  return {
    outcome: failed.length > 0 ? 'failed' : running > 0 ? 'running' : 'passed',
    passed,
    failed: failed.length,
    running,
    total: list.length,
    failing: failed.map((one) => one.name),
    list,
  }
}

/** What GitHub needs to merge it, as the runtime reads it: its required check, then the rest, in the app's order. */
const needsOf = (pr: Pick<ChangeSummary, 'checks' | 'draft' | 'unpushed' | 'pushing' | 'conflicts'>, queued = false): MergeNeed[] => {
  const list = pr.checks?.list ?? []
  const verify = list.find((one) => one.name === REQUIRED)
  const others = list.filter((one) => one.name !== REQUIRED)
  const done = (one: Check) => one.state === 'passed' || one.state === 'skipped'
  const going = (one: Check) => one.state === 'running' || one.state === 'queued'
  return [
    {
      kind: 'checks',
      state: verify === undefined || going(verify) ? 'waiting' : verify.state === 'failed' ? 'unmet' : 'met',
      have: verify !== undefined && done(verify) ? 1 : 0,
      need: 1,
      required: [REQUIRED],
      ...(verify !== undefined && going(verify) ? { who: [REQUIRED] } : verify?.state === 'failed' ? { who: [REQUIRED] } : {}),
      ...(others.length === 0
        ? {}
        : {
            apart: {
              passed: others.filter(done).length,
              failed: others.filter((one) => one.state === 'failed').map((one) => one.name),
              running: others.filter(going).length,
            },
          }),
    },
    { kind: 'changes_requested', state: 'met' },
    { kind: 'conflicts', state: pr.conflicts === true ? 'unmet' : 'met' },
    { kind: 'draft', state: pr.draft ? 'unmet' : 'met' },
    // As mergeNeeds.ts says it: held for Ship, "not shipped"; going up by themselves, waiting; else the person's to push.
    pr.unpushed > 0
      ? pr.pushing?.ship === true
        ? { kind: 'pushed', state: 'unmet', have: pr.unpushed, said: `${pr.unpushed} commits not shipped` }
        : { kind: 'pushed', state: pr.pushing?.held === null ? 'waiting' : 'unmet', have: pr.unpushed }
      : { kind: 'pushed', state: 'met' },
    { kind: 'merge_queue', state: queued ? 'waiting' : 'met' },
  ]
}

const pr = (overrides: Partial<ChangeSummary>, queued = false): ChangeSummary => {
  const base = change({
    number: 820,
    title: TITLE,
    url: URL,
    repository: 'AltharIDE/althar',
    draft: false,
    additions: 481,
    deletions: 35,
    changedFiles: 6,
    head: 'f90227c5b',
    localHead: 'f90227c5b',
    target: 'main',
    canBypassQueue: true,
    pushing: { held: null },
    ...overrides,
  })
  return { ...base, needs: needsOf(base, queued) }
}

let at = 0
const stamp = (item: ThreadItem): ThreadItem => ({ ...item, id: `i${++at}`, sequence: at })

/** What the thread holds, oldest first: the plan's steps, its review, the person's two tweaks and the answers. */
const history = (reviews: ReadonlyArray<'pass' | 'changes_requested'>): ThreadItem[] => [
  stamp(items.you('In the composer, a voice note still being written down is left behind when Enter sends the attachment.')),
  stamp(
    items.step({ step: 'implement', summary: 'Sending while dictating waits for the transcript, then sends it with the attachments.' }),
  ),
  stamp(
    items.step({
      step: 'review',
      round: 0,
      verdict: 'pass',
      summary: 'Waits for the transcript; failure holds the send.',
      agentId: REVIEWER,
    } as never),
  ),
  stamp(items.step({ step: 'publish', summary: 'Opened draft pull request #820.' })),
  stamp(items.you('That error message is ugly')),
  stamp(items.says('I made the not-sent message shorter and styled it as an error.')),
  stamp(items.you('You should be able to dismiss, and still, it should look nicer')),
  stamp(items.says('The not-sent message can now be dismissed, and I restyled it.')),
  ...reviews.map((verdict, i) =>
    stamp(
      items.step({
        step: 'review',
        round: i + 1,
        verdict,
        agentId: REVIEWER,
        summary: verdict === 'pass' ? 'The dismiss control clears only the notice.' : 'Dismiss also throws away the kept recording.',
        findings:
          verdict === 'pass'
            ? []
            : [
                {
                  severity: 'major',
                  file: 'packages/ui/src/composer/Composer/Composer.tsx',
                  line: 412,
                  claim: 'Dismiss drops the recording.',
                  title: 'Dismiss drops the recording',
                },
              ],
      } as never),
    ),
  ),
]

const base = (task: Partial<ThreadSnapshot['task']>, rest: Partial<ThreadSnapshot> = {}): ThreadSnapshot =>
  snapshot({
    project: { id: 'p1', name: 'althar' },
    session: {
      ...snapshot().session!,
      agentId: LEAD,
      agentName: 'Claude Code',
      model: 'claude-sonnet-5-5',
      turnRunning: false,
      held: true,
    },
    ...rest,
    task: {
      ...snapshot().task,
      id: 't820',
      title: TITLE,
      slug: SLUG,
      branch: `althar/${SLUG}`,
      worktree: `/Users/you/Charrette/althar/${SLUG}/althar`,
      state: 'open',
      kind: 'change',
      end: 'draft',
      steps: [
        { key: 'implement', agentId: LEAD, model: 'claude-sonnet-5-5', effort: 'high', skipped: false },
        { key: 'review', agentId: REVIEWER, model: 'gpt-6.1-sol', skipped: false },
      ],
      lead: { agentId: LEAD, model: 'claude-sonnet-5-5' } as never,
      startedAt: '2026-11-12T14:02:00.000Z',
      files: FILES,
      commits: 9,
      actions: ['stop', 'abandon'],
      ...task,
    },
  })

export interface Moment {
  readonly key: string
  /** Where it is on the path, as the bar says it. */
  readonly label: string
  /** What happened to bring it here, in a line. */
  readonly what: string
  /** What the card shows on main today, and what's wrong with it, where something is. */
  readonly today: string
  readonly snapshot: ThreadSnapshot
}

const passed = checksOf('passed')
const draftHeld = (commits: number) =>
  pr({ draft: true, checks: passed, unpushed: commits, pushing: { held: 'Held for Ship', ship: true } })

export const MOMENTS: ReadonlyArray<Moment> = [
  {
    key: 'held',
    label: 'Tweaks wait for Ship',
    what: 'After its plan, the person asked for two tweaks. Their 2 commits wait on the branch for Ship, whatever the push setting says.',
    today: 'Ship 2 commits, and Mark ready for review beside it. No way to push without the review.',
    snapshot: base(
      { phase: 'ready', held: { since: '2026-11-12T17:40:00.000Z', commits: 2 }, changes: [draftHeld(2)] },
      { items: history([]) },
    ),
  },
  {
    key: 'reviewing',
    label: 'Ship: review reads them',
    what: 'Ship pressed. The task is running again: GPT-6.1 Sol reviews the 2 commits.',
    today: 'Only Mark ready for review. On 12 Nov (#820) Push 2 commits showed here, and would have been refused; #847 hid it on 13 Nov.',
    snapshot: base(
      {
        phase: 'running',
        step: 'review',
        stepAt: '2026-11-12T17:52:00.000Z',
        held: { since: '2026-11-12T17:40:00.000Z', commits: 2 },
        changes: [draftHeld(2)],
      },
      { items: history([]) },
    ),
  },
  {
    key: 'settling',
    label: 'Ship: lead fixes a finding',
    what: 'The review asked for a change. The lead fixes it; the review reads the fix next.',
    today: 'Only Mark ready for review. Nothing says Ship is still under way.',
    snapshot: base(
      {
        phase: 'running',
        step: 'settle',
        stepAt: '2026-11-12T17:58:00.000Z',
        held: { since: '2026-11-12T17:40:00.000Z', commits: 3 },
        changes: [draftHeld(3)],
      },
      {
        items: history(['changes_requested']),
        session: { ...snapshot().session!, agentId: LEAD, model: 'claude-sonnet-5-5', turnRunning: true, held: true },
      },
    ),
  },
  {
    key: 'pushing',
    label: 'Ship: pushing',
    what: 'The review passed. Ship sends the 3 commits up to the pull request.',
    today: 'Only Mark ready for review.',
    snapshot: base(
      { phase: 'running', step: 'publish', held: { since: '2026-11-12T17:40:00.000Z', commits: 3 }, changes: [draftHeld(3)] },
      { items: history(['changes_requested', 'pass']) },
    ),
  },
  {
    key: 'draftChecks',
    label: 'Draft: checks run',
    what: 'Pushed. GitHub runs verify on the draft; the task counts as running while it does.',
    today: 'Mark ready for review.',
    snapshot: base(
      { phase: 'running', changes: [pr({ draft: true, checks: checksOf('running'), head: '9ebeab727', localHead: '9ebeab727' })] },
      { items: history(['changes_requested', 'pass']) },
    ),
  },
  {
    key: 'draftPassed',
    label: 'Draft: checks passed',
    what: 'verify passed on the draft. The task waits on the person.',
    today: 'Mark ready for review.',
    snapshot: base(
      { phase: 'ready', changes: [pr({ draft: true, checks: passed, head: '9ebeab727', localHead: '9ebeab727' })] },
      { items: history(['changes_requested', 'pass']) },
    ),
  },
  {
    key: 'readyChecks',
    label: 'Ready: full run starts',
    what: 'Marked ready. GitHub runs verify again, with e2e and stress; the task goes back to running.',
    today: 'No button at all. Merge is offered only once the task is ready again, after every check.',
    snapshot: base(
      {
        phase: 'running',
        changes: [pr({ checks: checksOf('running', 'queued', 'queued', 'queued'), head: '9ebeab727', localHead: '9ebeab727' })],
      },
      { items: history(['changes_requested', 'pass']) },
    ),
  },
  {
    key: 'requiredPassed',
    label: 'Required check passed',
    what: 'verify, the one check main requires, passed. e2e and stress still run.',
    today: 'Says "Everything GitHub needs is met" and still no Merge: Althar waits on every check, GitHub only on verify.',
    snapshot: base(
      {
        phase: 'running',
        changes: [pr({ checks: checksOf('passed', 'running', 'running', 'running'), head: '9ebeab727', localHead: '9ebeab727' })],
      },
      { items: history(['changes_requested', 'pass']) },
    ),
  },
  {
    key: 'mergeable',
    label: 'Every check passed',
    what: 'All four checks passed. The task waits on the person.',
    today: 'Accept and merge, with Merge without queue in its menu.',
    snapshot: base(
      {
        phase: 'ready',
        changes: [pr({ checks: checksOf('passed', 'passed', 'passed', 'passed'), head: '9ebeab727', localHead: '9ebeab727' })],
      },
      { items: history(['changes_requested', 'pass']) },
    ),
  },
  {
    key: 'queued',
    label: 'In the merge queue',
    what: 'Merge pressed. GitHub runs the queue’s checks on it with main, then merges it.',
    today: 'Merge options (bypass) only.',
    snapshot: base(
      {
        phase: 'running',
        changes: [
          pr({ queued: true, checks: checksOf('passed', 'passed', 'passed', 'passed'), head: '9ebeab727', localHead: '9ebeab727' }, true),
        ],
      },
      { items: history(['changes_requested', 'pass']) },
    ),
  },
  {
    key: 'merged',
    label: 'Merged',
    what: 'GitHub merged it into main.',
    today: 'No button; the card says Merged.',
    snapshot: base(
      {
        phase: 'settled',
        state: 'done',
        settledAt: '2026-11-12T18:39:36.000Z',
        changes: [
          {
            ...pr({ checks: checksOf('passed', 'passed', 'passed', 'passed'), head: '9ebeab727', localHead: null }),
            state: 'merged',
            needs: undefined,
          } as ChangeSummary,
        ],
      },
      { items: history(['changes_requested', 'pass']) },
    ),
  },
  {
    key: 'failed',
    label: 'A check failed',
    what: 'e2e (2) failed after it was marked ready. The lead is told and fixes it.',
    today: 'No button. The failure shows; nothing says the lead is on it, or what Merge waits for.',
    snapshot: base(
      {
        phase: 'running',
        changes: [pr({ checks: checksOf('passed', 'passed', 'failed', 'passed'), head: '9ebeab727', localHead: '9ebeab727' })],
      },
      {
        items: history(['changes_requested', 'pass']),
        session: { ...snapshot().session!, agentId: LEAD, model: 'claude-sonnet-5-5', turnRunning: true, held: true },
      },
    ),
  },
  {
    key: 'queueRefused',
    label: 'Out of the queue',
    what: 'GitHub took it out of the merge queue: e2e (2) failed on the queue’s run with main.',
    today: 'Accept and merge, as if nothing happened: nothing says why it left the queue.',
    snapshot: base(
      {
        phase: 'ready',
        changes: [pr({ checks: checksOf('passed', 'passed', 'failed', 'passed'), head: '9ebeab727', localHead: '9ebeab727' })],
      },
      { items: history(['changes_requested', 'pass']) },
    ),
  },
  {
    key: 'heldPush',
    label: 'Someone else pushed',
    what: 'The lead committed a fix, but someone else pushed to the branch first, so it didn’t go up by itself.',
    today: 'Push 1 commit: the one place a Push button belongs.',
    snapshot: base(
      {
        phase: 'ready',
        changes: [
          pr({
            checks: checksOf('passed', 'passed', 'passed', 'passed'),
            unpushed: 1,
            head: '4c1d2e0aa',
            localHead: 'b7a0e11f2',
            pushing: { held: 'Someone else pushed to PR #820' },
          }),
        ],
      },
      { items: history(['changes_requested', 'pass']) },
    ),
  },
]

export const momentOf = (key: string | null) => MOMENTS.find((one) => one.key === key) ?? MOMENTS[0]!
