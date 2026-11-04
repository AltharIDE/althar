// Scrappy: two tasks of this repository's, as the runtime would hand them on: a long investigation with three review rounds, and a short clean change.
import type { AttentionRequest, ChangeSummary, TaskFinding, ThreadItem, ThreadSnapshot } from '../../../contracts/src/index'

import { snapshot } from '../../../../apps/desktop/tests/fixtures'

const MIN = 60_000
/** Everything happens before the page opened: the long task started 3h52m ago. */
const now = Date.now()

const thread = (start: number) => {
  let sequence = 0
  const item = (
    minute: number,
    agentId: string | null,
    kind: ThreadItem['kind'],
    content: Record<string, unknown>,
    more: Record<string, unknown> = {},
  ): ThreadItem => {
    sequence += 1
    return {
      id: `${kind}-${sequence}`,
      sequence,
      createdAt: new Date(start + minute * MIN).toISOString(),
      agentId,
      kind,
      content,
      ...more,
    } as ThreadItem
  }
  const says = (minute: number, text: string, agentId = 'claude-code') =>
    item(minute, agentId, 'agent_message', { text, pictures: [], files: [] })
  const tool = (
    minute: number,
    title: string,
    toolKind: string,
    more: { command?: string; path?: string; output?: string; exit?: number } = {},
    agentId = 'claude-code',
  ) =>
    item(minute, agentId, 'tool_call', {
      title,
      toolKind,
      status: 'completed',
      command: more.command ?? null,
      locations: more.path === undefined ? [] : [{ path: more.path, line: null }],
      declined: false,
      pictures: [],
      files: [],
      output: more.output === undefined ? null : { text: more.output, dropped: 0 },
      exit: more.exit ?? null,
    } as never)
  const plan = (minute: number, entries: ReadonlyArray<string>, done = 0, agentId = 'claude-code') =>
    item(minute, agentId, 'plan', {
      entries: entries.map((content, at) => ({ content, status: at < done ? 'completed' : at === done ? 'in_progress' : 'pending' })),
    })
  const notice = (minute: number, title: string, severity: 'info' | 'warning' = 'info', role?: 'aside') =>
    item(minute, null, 'notice', {
      source: 'runtime',
      severity,
      title,
      description: null,
      ...(role === undefined ? {} : { role }),
    })
  const step = (minute: number, content: Partial<Extract<ThreadItem, { kind: 'step_result' }>['content']>) =>
    item(minute, null, 'step_result', {
      step: 'implement',
      round: 0,
      summary: '',
      change: null,
      verdict: null,
      findings: [],
      built: null,
      evidence: [],
      unverified: null,
      agentId: null,
      ...content,
    } as never)
  const you = (minute: number, text: string) =>
    item(minute, null, 'user_message', { text, links: [], pictures: [], files: [] } as never, {
      input: { state: 'delivered', interrupting: false },
    })
  const at = (minute: number) => new Date(start + minute * MIN).toISOString()
  return { says, tool, plan, notice, step, you, at }
}

const run = (command: string, caption: string, text: string, exit = 0) => ({
  kind: 'command' as const,
  caption,
  picture: null,
  command,
  exit,
  text,
  dropped: 0,
})
const note = (caption: string, text: string) => ({
  kind: 'note' as const,
  caption,
  picture: null,
  command: null,
  exit: null,
  text,
  dropped: 0,
})

const pullRequest = (overrides: Partial<ChangeSummary>): ChangeSummary => ({
  product: 'github',
  number: 612,
  title: 'Steps start without waiting on the next agent’s cold start',
  url: 'https://github.com/AltharIDE/althar/pull/612',
  state: 'open',
  draft: true,
  noun: 'pull request',
  short: 'PR',
  prefix: '#',
  repository: 'AltharIDE/althar',
  slug: null,
  additions: 412,
  deletions: 96,
  changedFiles: 11,
  head: '7c41d2e',
  checks: {
    outcome: 'passed',
    passed: 6,
    failed: 0,
    running: 0,
    total: 6,
    failing: [],
    list: [
      { name: 'harness', state: 'passed', summary: null },
      { name: 'desktop', state: 'passed', summary: null },
      { name: 'ui', state: 'passed', summary: null },
      { name: 'e2e (1/4)', state: 'passed', summary: null },
      { name: 'e2e (2/4)', state: 'passed', summary: null },
      { name: 'stress', state: 'passed', summary: null },
    ],
  },
  listening: true,
  localHead: '7c41d2e',
  unpushed: 0,
  diverged: null,
  ...overrides,
})

/* ——— The long one: an investigation that became a change, three rounds of review, and two things for the person. ——— */

const LONG_START = now - (3 * 60 + 52) * MIN
const L = thread(LONG_START)

export const LONG_REQUEST =
  'Tasks sit for ages between steps. Implement finishes and the review takes minutes to start, and settling seems to wait on something too. Find out why, fix what’s ours, and measure it before and after.'

const ROUND_ONE_RESULT = `## What I found

A step's handoff waits on three things, in this order, on 12 recorded tasks (31 step changes):

| Wait | Median | p90 | Ours? |
| --- | --- | --- | --- |
| The next agent's cold start (\`connectSession\` → first token) | 58.1s | 141s | Partly: we start it only once the step ends |
| Replaying the task's setup script before the reviewer starts | 21.4s | 49s | Yes: it runs again though nothing changed |
| The publish step polling for the pull request | 9.8s | 30s | Yes: a fixed 10s poll |

The provider's own queue is about 4s of it, which isn't ours.

## What I changed

- The reviewer's session starts while the lead is still writing its report (\`Runs.ts\`), so the cold start overlaps the end of the step.
- Setup is replayed only when the lockfile or the recorded script changed since the last replay (\`setupReplay.ts\`).
- Publishing waits on the host's push event, with the poll as a fallback (\`publish.ts\`).

## Measured again

Median implement → review went from **94.2s to 11.8s**, review → settle from **61s to 9.4s**. The probe is \`bun --filter @althar/runtime probe:steps\`; it reads the runtime's log, so it needs a real task's log to run on.

What's left: the provider's queue, and a cold start where the reviewer's account changes mid-task, which can't be warmed ahead.`

const REVIEW_ONE_SUMMARY = `I re-ran the probe on the branch at 4f2c9e1 against the same 12 recorded tasks (31 step transitions), and separately against 5 fresh tasks I started on the fixture repository (14 transitions), with the runtime log at debug. Median implement→review gap fell from 94.2s to 11.8s (p90 212s → 37s) and review→settle from 61s to 9.4s (p90 140s → 22s), which matches the lead's numbers within a second. However, of the 45 transitions, 4 reused a warm session whose model differed from the one the step names (two on gpt-6.1-sol where the plan said opus-5.5 for a settle, two the other way), because \`prewarm\` keys the session by agent and account only and \`Sessions.ts:3352\` then skips the model move when the session is already connected; those four settles ran on the wrong model for their whole step. Separately, the prewarm fires on the lead's \`finish_step\` call (\`Runs.ts:2261\`), which is before \`pushBranch\` resolves; in 3 of the 14 fresh runs the reviewer read the worktree at the previous head and reported a diff of 0 files on its first look, then re-read it 20–40s later — that's the "reviewer looked at nothing" pattern from DEV-198, now more likely, not less. The probe also counts the setup replay twice when a replay is skipped and then forced (\`probe-steps.ts:88\`: both the skip line and the forced start match \`setup:\`), so its "after" setup figure is inflated by about 6s on 2 of 12 tasks; it doesn't change the conclusion. Minor: the new \`stepGapMs\` field in the debug log is written in seconds. I didn't look at the publish change beyond its tests, which pass (18/18), and I didn't run the e2e suite.`

const SETTLE_ONE_RESULT = `Settled the review's four findings:

- **Warm session on the wrong model:** the prewarm now keys the session by agent, account and model, and \`connectSession\` moves a warm one to the step's model before it starts (a1b2c3d).
- **Reviewer reading the old head:** the prewarm waits for \`pushBranch\` to resolve; the reviewer's first prompt is sent only then (9e8f7a6). On the 14 fresh tasks, 0 of 14 read an old head.
- **Probe counting setup twice:** a skipped replay no longer matches \`setup:\` (3d5e6f7).
- **\`stepGapMs\` in seconds:** kept. Every other duration in the debug log is in seconds; the field is now \`stepGap\` with its unit in the log's legend.

Median implement → review is **12.4s** now (it was 11.8s; waiting for the push costs about half a second), review → settle **9.1s**.`

const REVIEW_TWO_SUMMARY = `Re-ran the probe at 6b0d4a2 on the 12 recorded tasks and 9 fresh ones (52 transitions in all). The model fix holds: 0 of 52 ran on a model other than the step's, and the reviewer read the right head in 21 of 21 fresh first looks. Medians: implement→review 12.4s (p90 31s), review→settle 9.1s (p90 19s), settle→review 13.0s (p90 34s). The new problem is memory: keeping the reviewer's session warm between rounds holds a second Codex process per task for the whole review loop — I measured 1.06–1.21 GB resident per warm session on the fixture repository (2.3 GB on althar itself with its language server), and with the default of six tasks running at once that's 6.4–13.8 GB over today's peak, past what ADR-061's memory budget allows on a 16 GB Mac. Either the warm session has to be dropped after the review starts, or kept only while fewer than N tasks run, or the budget changes; that's a product call more than a code one. The probe's setup count is still doubled on one path: when the replay is skipped because the lockfile is unchanged and the script then fails its health check, the retry logs \`setup: replay\` again (\`probe-steps.ts:94\`), so 1 of 21 tasks shows 14s it didn't spend. I'd also still rename \`stepGapMs\`, since a field named Ms holding seconds will be read wrong by whoever graphs it next, legend or not. Tests: runtime 412/412, desktop 1,288/1,288; e2e not run.`

const SETTLE_TWO_RESULT = `Settled the second review:

- **Probe counting setup twice on a retry:** fixed; the retry's line is \`setup: retry\` (5c8a1f0).
- **\`stepGapMs\` holds seconds:** renamed to \`stepGapSeconds\` after all (8e2b7c4). The reviewer is right that the name will outlive the legend.
- **Memory of a warm reviewer between rounds:** not fixed. Dropping the warm session after the review starts gives back most of the speed-up's memory but costs about 40s a round; keeping it is 1–2 GB a task. That's yours to choose; I've left it warm, behind \`ALTHAR_WARM_REVIEWER\`, which is on.

Then I squashed the eleven fixup commits into three, so the pull request reads as three changes; pushing that rewrites the branch on GitHub, which asks you first.`

const BUILT = `Found why steps wait on each other, and fixed what's Althar's. A step's handoff waited on three things: the next agent's cold start (58s median), replaying the task's setup before the reviewer (21s), and publishing polling for its pull request (10s). The provider's own queue, about 4s, isn't ours.

Now the reviewer's session starts while the lead writes its report, on the step's own model, and gets its first prompt once the branch is pushed; setup is replayed only when the lockfile or the recorded script changed; publishing waits on the host's push event. Median implement → review is down from 94s to 12s, review → settle from 61s to 9s.

\`bun --filter @althar/runtime probe:steps\` measures it from a runtime log.`

const BUILT_LATEST = `${BUILT}

The reviewer stays warm between review rounds, behind \`ALTHAR_WARM_REVIEWER\` (on): it saves about 40s a round and holds 1–2 GB a task while the reviews last.`

export const LONG_FINDINGS_ONE = [
  {
    severity: 'major' as const,
    file: 'packages/runtime/src/Sessions.ts',
    line: 3352,
    title: 'A warm session runs a step on the wrong model',
    claim:
      '`prewarm` keys the session by agent and account only, and `connectSession` skips the model move when the session is already connected, so 4 of 45 settles ran on the model of the step before.',
  },
  {
    severity: 'blocking' as const,
    file: 'packages/runtime/src/Runs.ts',
    line: 2261,
    title: 'The reviewer can read the worktree before the branch is pushed',
    claim:
      'The prewarm fires on `finish_step`, before `pushBranch` resolves. In 3 of 14 fresh runs the reviewer read the previous head and reported a diff of 0 files on its first look.',
  },
  {
    severity: 'minor' as const,
    file: 'packages/runtime/scripts/probe-steps.ts',
    line: 88,
    title: 'The probe counts a skipped setup replay twice',
    claim: 'Both the skip line and the forced start match `setup:`, inflating the after figure by about 6s on 2 of 12 tasks.',
  },
  {
    severity: 'nit' as const,
    file: 'packages/runtime/src/Runs.ts',
    line: 3540,
    title: '`stepGapMs` is written in seconds',
    claim: 'The new debug field is named in milliseconds and holds seconds.',
  },
]

export const LONG_FINDINGS_TWO = [
  {
    severity: 'blocking' as const,
    file: 'packages/runtime/src/Runs.ts',
    line: 2274,
    title: 'A warm reviewer between rounds costs 1–2 GB a task',
    claim:
      'Keeping the reviewer warm for the whole review loop holds a second Codex process per task: 1.06–1.21 GB on the fixture repository, 2.3 GB on althar. Six tasks at once is 6.4–13.8 GB over today’s peak, past ADR-061’s budget on a 16 GB Mac.',
  },
  {
    severity: 'minor' as const,
    file: 'packages/runtime/scripts/probe-steps.ts',
    line: 94,
    title: 'The probe counts a skipped setup replay twice',
    claim:
      'When a skipped replay fails its health check, the retry logs `setup: replay` again, so 1 of 21 tasks shows 14s it didn’t spend.',
  },
  {
    severity: 'nit' as const,
    file: 'packages/runtime/src/Runs.ts',
    line: 3540,
    title: '`stepGapMs` is written in seconds',
    claim: 'A field named Ms holding seconds will be read wrong by whoever graphs it next, legend or not.',
  },
]

const longItems: ThreadItem[] = [
  // Round one: the lead plans, investigates, changes three things, and reports.
  L.says(
    1,
    'I’ll time each step change on recorded tasks from the runtime’s log, find what each wait is for, and fix the ones that are ours.',
  ),
  L.plan(1, [
    'Read how a step ends and the next one starts (Runs.ts, Sessions.ts)',
    'Write a probe that times each step change from the runtime log',
    'Find what each wait is for',
    'Fix the waits that are Althar’s',
    'Measure again on the same tasks',
  ]),
  L.tool(2, 'Read packages/runtime/src/Runs.ts', 'read', { path: 'packages/runtime/src/Runs.ts' }),
  L.tool(3, 'Read packages/runtime/src/Sessions.ts', 'read', { path: 'packages/runtime/src/Sessions.ts' }),
  L.tool(4, 'Read packages/runtime/src/handover.ts', 'read', { path: 'packages/runtime/src/handover.ts' }),
  L.tool(5, 'Search for connectSession', 'search', { command: 'rg -n connectSession packages/runtime/src' }),
  L.tool(6, 'Read packages/runtime/src/stallWatch.ts', 'read', { path: 'packages/runtime/src/stallWatch.ts' }),
  L.says(
    9,
    'The next step’s agent is only created once `finish_step` returns, so its whole cold start sits in the gap. Writing the probe.',
  ),
  L.tool(10, 'Create packages/runtime/scripts/probe-steps.ts', 'edit', { path: 'packages/runtime/scripts/probe-steps.ts' }),
  L.tool(14, 'Run bun --filter @althar/runtime probe:steps', 'execute', {
    command: 'bun --filter @althar/runtime probe:steps -- --log ~/.althar/logs/runtime.log',
    output: '31 step changes on 12 tasks\nimplement→review  median 94.2s  p90 212s\nreview→settle     median 61.0s  p90 140s\n',
    exit: 0,
  }),
  L.tool(16, 'Read packages/runtime/src/setupReplay.ts', 'read', { path: 'packages/runtime/src/setupReplay.ts' }),
  L.tool(17, 'Read packages/runtime/src/publish.ts', 'read', { path: 'packages/runtime/src/publish.ts' }),
  L.tool(22, 'Edit packages/runtime/src/Runs.ts', 'edit', { path: 'packages/runtime/src/Runs.ts' }),
  L.tool(26, 'Edit packages/runtime/src/setupReplay.ts', 'edit', { path: 'packages/runtime/src/setupReplay.ts' }),
  L.tool(29, 'Edit packages/runtime/src/publish.ts', 'edit', { path: 'packages/runtime/src/publish.ts' }),
  L.tool(31, 'Edit packages/runtime/tests/runs.test.ts', 'edit', { path: 'packages/runtime/tests/runs.test.ts' }),
  L.tool(34, 'Run bunx vitest run --maxWorkers=1 tests/runs.test.ts', 'execute', {
    command: 'bunx vitest run --maxWorkers=1 tests/runs.test.ts tests/setupReplay.test.ts',
    output: ' ✓ tests/runs.test.ts (164)\n ✓ tests/setupReplay.test.ts (22)\n\n Test Files  2 passed (2)\n      Tests  186 passed (186)\n',
    exit: 0,
  }),
  L.tool(38, 'Run bun --filter @althar/runtime probe:steps', 'execute', {
    command: 'bun --filter @althar/runtime probe:steps -- --log ~/.althar/logs/runtime.log --since 4f2c9e1',
    output: 'implement→review  median 11.8s  p90 37s\nreview→settle     median 9.4s   p90 22s\n',
    exit: 0,
  }),
  L.notice(41, 'Committed 4 files on althar/investigate-why-tasks-move-slowly-from-step-to.', 'info', 'aside'),
  L.step(42, {
    step: 'implement',
    round: 0,
    summary:
      'Found three waits between steps; fixed the two that are ours and overlapped the third. Median implement → review is 11.8s, from 94.2s.',
    built: BUILT,
    evidence: [
      run(
        'bun --filter @althar/runtime probe:steps -- --since 4f2c9e1',
        'Step changes before and after, on the same 12 tasks',
        'implement→review  94.2s → 11.8s\nreview→settle     61.0s → 9.4s',
      ),
      run(
        'bunx vitest run --maxWorkers=1 tests/runs.test.ts tests/setupReplay.test.ts',
        'Runtime tests for the changed files',
        ' Tests  186 passed (186)',
      ),
      note('Where each wait comes from', 'Cold start 58.1s, setup replay 21.4s, publish poll 9.8s, provider queue ~4s (medians).'),
    ],
    unverified: [
      'The desktop app’s end-to-end run',
      'A task whose reviewer’s account changes mid-task: it can’t be warmed ahead, and I had no recorded one',
    ],
  }),
  L.says(43, ROUND_ONE_RESULT),
  L.notice(43.5, 'Opened PR #612 as a draft.'),

  // Review one: Codex starts afresh, reads, runs the probe, and asks for changes.
  L.notice(44, 'Started Codex afresh.'),
  L.tool(45, 'Read packages/runtime/src/Runs.ts', 'read', { path: 'packages/runtime/src/Runs.ts' }, 'codex'),
  L.tool(46, 'Read packages/runtime/src/Sessions.ts', 'read', { path: 'packages/runtime/src/Sessions.ts' }, 'codex'),
  L.tool(
    48,
    'Run bun --filter @althar/runtime probe:steps',
    'execute',
    { command: 'bun --filter @althar/runtime probe:steps', exit: 0 },
    'codex',
  ),
  L.tool(
    52,
    'Run five fresh tasks on the fixture repository',
    'execute',
    { command: 'node scripts/fresh-tasks.ts --count 5', exit: 0 },
    'codex',
  ),
  L.tool(
    57,
    'Run bunx vitest run tests/publish.test.ts',
    'execute',
    { command: 'bunx vitest run tests/publish.test.ts', exit: 0 },
    'codex',
  ),
  L.step(59, {
    step: 'review',
    round: 0,
    verdict: 'changes_requested',
    findings: LONG_FINDINGS_ONE,
    summary: REVIEW_ONE_SUMMARY,
    agentId: 'codex',
  }),

  // Settle one: the lead answers the four findings.
  L.says(
    60,
    'I’ll take the four findings in order of weight: the reviewer reading the old head first, then the model, then the probe and the field’s name.',
  ),
  L.plan(60, [
    'Wait for pushBranch before the reviewer’s first prompt',
    'Key the warm session by model too',
    'Stop the probe matching a skipped replay',
    'Decide on stepGapMs',
    'Measure on the fresh tasks again',
  ]),
  L.tool(62, 'Edit packages/runtime/src/Runs.ts', 'edit', { path: 'packages/runtime/src/Runs.ts' }),
  L.tool(66, 'Edit packages/runtime/src/Sessions.ts', 'edit', { path: 'packages/runtime/src/Sessions.ts' }),
  L.tool(70, 'Edit packages/runtime/scripts/probe-steps.ts', 'edit', { path: 'packages/runtime/scripts/probe-steps.ts' }),
  L.tool(73, 'Run bunx vitest run --maxWorkers=1 tests/runs.test.ts tests/sessions.test.ts', 'execute', {
    command: 'bunx vitest run --maxWorkers=1 tests/runs.test.ts tests/sessions.test.ts',
    output: ' Tests  301 passed (301)\n',
    exit: 0,
  }),
  L.notice(76, 'Claude Code went quiet. Told it to carry on.', 'info', 'aside'),
  L.tool(84, 'Run node scripts/fresh-tasks.ts --count 14', 'execute', { command: 'node scripts/fresh-tasks.ts --count 14', exit: 0 }),
  L.step(93, {
    step: 'settle',
    round: 0,
    summary: 'Fixed three of the four findings and kept `stepGapMs`, whose unit the log’s other durations share.',
    built: BUILT,
    evidence: [
      run('node scripts/fresh-tasks.ts --count 14', 'Fresh tasks: the reviewer’s first look', '14 of 14 read the pushed head'),
      run('bunx vitest run --maxWorkers=1 tests/runs.test.ts tests/sessions.test.ts', 'Runtime tests', ' Tests  301 passed (301)'),
      run('bun --filter @althar/runtime probe:steps', 'Step changes on the recorded tasks', 'implement→review 12.4s\nreview→settle 9.1s'),
    ],
    unverified: ['The desktop app’s end-to-end run'],
  }),
  L.says(94, SETTLE_ONE_RESULT),

  // The person asks something on the way; the lead answers before the next review.
  L.you(94.2, 'While you’re at it: does the coordinator’s handoff to a new lead wait on the same cold start?'),
  L.tool(94.4, 'Read packages/runtime/src/Coordinator.ts', 'read', { path: 'packages/runtime/src/Coordinator.ts' }),
  L.tool(94.5, 'Search for createSession in Coordinator.ts', 'search', {
    command: 'rg -n createSession packages/runtime/src/Coordinator.ts',
  }),
  L.says(
    94.8,
    'Yes, the same way: the coordinator creates a new task’s lead only once the task is made, so its first word waits on a cold start too, about 50s at the median. The fix is the same overlap, but in `Coordinator.ts`, which this task doesn’t touch; I’ve left it out rather than widen the change. It’s a line in the pull request’s description.',
  ),

  // Review two: Codex went quiet, started again, and found the memory cost.
  L.notice(95, 'Started Codex afresh.'),
  L.tool(97, 'Read packages/runtime/src/Runs.ts', 'read', { path: 'packages/runtime/src/Runs.ts' }, 'codex'),
  L.notice(109, 'Codex went quiet again. Started it afresh.'),
  L.tool(
    111,
    'Run node scripts/fresh-tasks.ts --count 9',
    'execute',
    { command: 'node scripts/fresh-tasks.ts --count 9', exit: 0 },
    'codex',
  ),
  L.tool(122, 'Run ps -o rss for each warm session', 'execute', { command: 'ps -o rss= -p $(pgrep -f codex)', exit: 0 }, 'codex'),
  L.tool(
    126,
    'Run bun run test in packages/runtime and apps/desktop',
    'execute',
    { command: 'bunx vitest run --maxWorkers=1', exit: 0 },
    'codex',
  ),
  L.step(131, {
    step: 'review',
    round: 1,
    verdict: 'changes_requested',
    findings: LONG_FINDINGS_TWO,
    summary: REVIEW_TWO_SUMMARY,
    agentId: 'codex',
  }),

  // Settle two: two fixed, the memory question left to the person.
  L.says(
    132,
    'I’ll fix the probe’s retry and rename the field; the memory cost is a choice between speed and memory, so I’ll lay it out rather than pick.',
  ),
  L.tool(134, 'Edit packages/runtime/scripts/probe-steps.ts', 'edit', { path: 'packages/runtime/scripts/probe-steps.ts' }),
  L.tool(137, 'Edit packages/runtime/src/Runs.ts', 'edit', { path: 'packages/runtime/src/Runs.ts' }),
  L.tool(141, 'Run a warm and a cold review loop on the fixture repository', 'execute', {
    command: 'ALTHAR_WARM_REVIEWER=0 node scripts/fresh-tasks.ts --count 6',
    output: 'warm  review→settle 9.1s   rss +1.12 GB\ncold  review→settle 49.6s  rss +0\n',
    exit: 0,
  }),
  L.tool(147, 'Run git rebase --autosquash main', 'execute', { command: 'git rebase --autosquash main', exit: 0 }),
  L.step(152, {
    step: 'settle',
    round: 1,
    summary:
      'Fixed the probe’s retry and renamed `stepGapMs`. Left the reviewer warm between rounds, behind `ALTHAR_WARM_REVIEWER`: keeping it costs 1–2 GB a task, dropping it about 40s a round, and that’s the person’s to choose.',
    built: BUILT_LATEST,
    evidence: [
      run(
        'ALTHAR_WARM_REVIEWER=0 node scripts/fresh-tasks.ts --count 6',
        'A warm reviewer against a cold one, six tasks each',
        'warm  review→settle 9.1s   rss +1.12 GB\ncold  review→settle 49.6s  rss +0',
      ),
      run('bunx vitest run --maxWorkers=1', 'Runtime and desktop tests', ' Tests  1700 passed (1700)'),
      run(
        'bun --filter @althar/runtime probe:steps',
        'Step changes on all 21 tasks',
        'implement→review 12.4s\nreview→settle 9.1s\nsettle→review 13.0s',
      ),
    ],
    unverified: ['The desktop app’s end-to-end run', 'Memory on an 8 GB Mac, which I don’t have'],
  }),
  L.says(153, SETTLE_TWO_RESULT),

  // Review three: a pass, then publishing; the squash waits for the person.
  L.notice(154, 'Started Codex afresh.'),
  L.tool(156, 'Read packages/runtime/scripts/probe-steps.ts', 'read', { path: 'packages/runtime/scripts/probe-steps.ts' }, 'codex'),
  L.tool(
    160,
    'Run bun --filter @althar/runtime probe:steps',
    'execute',
    { command: 'bun --filter @althar/runtime probe:steps', exit: 0 },
    'codex',
  ),
  L.step(163, {
    step: 'review',
    round: 2,
    verdict: 'pass',
    findings: [],
    summary:
      'Both fixes hold: the probe’s retry is counted once on all 21 tasks, and `stepGapSeconds` is what the log writes. The warm reviewer’s memory is unchanged, as the lead says, and it’s behind a switch that defaults on; I’d leave the default to the person. Nothing else.',
    agentId: 'codex',
  }),
]

/** What became of each finding, as the Changes view reads it: by its review, its round, and what the lead said of it. */
const finding = (
  round: number,
  index: number,
  raw: (typeof LONG_FINDINGS_ONE)[number],
  state: TaskFinding['state'],
  reason: string | null,
  commit: string | null = null,
): TaskFinding => ({
  id: `f${round}-${index}`,
  review: `review-${round}`,
  round,
  severity: raw.severity,
  title: raw.title,
  claim: raw.claim,
  file: raw.file,
  line: raw.line,
  at: { path: raw.file, line: raw.line, changed: false, untouched: false },
  state,
  reason,
  commit,
})

export const LONG_TASK_FINDINGS: ReadonlyArray<TaskFinding> = [
  finding(
    0,
    0,
    LONG_FINDINGS_ONE[0]!,
    'fixed',
    'The warm session is keyed by model too, and moved to the step’s model before it starts.',
    'a1b2c3d',
  ),
  finding(
    0,
    1,
    LONG_FINDINGS_ONE[1]!,
    'fixed',
    'The reviewer’s first prompt waits for the push; 14 of 14 fresh tasks read the pushed head.',
    '9e8f7a6',
  ),
  finding(0, 2, LONG_FINDINGS_ONE[2]!, 'fixed', 'A skipped replay no longer matches `setup:`.', '3d5e6f7'),
  finding(0, 3, LONG_FINDINGS_ONE[3]!, 'set_aside', 'Every other duration in the debug log is in seconds.'),
  finding(
    1,
    0,
    LONG_FINDINGS_TWO[0]!,
    'set_aside',
    'A choice between speed and memory: keeping the reviewer warm costs 1–2 GB a task, dropping it about 40s a round. Left warm, behind ALTHAR_WARM_REVIEWER.',
  ),
  finding(1, 1, LONG_FINDINGS_TWO[1]!, 'fixed', 'The retry logs `setup: retry`.', '5c8a1f0'),
  finding(1, 2, LONG_FINDINGS_TWO[2]!, 'fixed', 'Renamed to `stepGapSeconds`.', '8e2b7c4'),
]

/** The push that rewrites the branch on GitHub: the rules keep it for the person (ADR-067). */
export const LONG_PERMISSION: AttentionRequest = {
  id: 'perm-squash',
  kind: 'permission',
  title: 'Publish: push the squashed branch to GitHub',
  reason: 'Rewrites history on GitHub',
  command: 'git push --force-with-lease origin althar/investigate-why-tasks-move-slowly-from-step-to',
  label: 'git push --force-with-lease',
  held: true,
  stuck: null,
  createdAt: L.at(166),
}

const plan = [
  { key: 'implement' as const, agentId: 'claude-code', model: 'claude-opus-5-5', effort: 'xhigh', skipped: false },
  { key: 'review' as const, agentId: 'codex', model: 'gpt-6.1-sol', effort: 'medium', skipped: false },
]

const LONG_TITLE = 'Investigate why tasks move slowly from step to step'

export const longSnapshot = (): ThreadSnapshot => {
  const base = snapshot()
  return snapshot({
    threadId: 'th-long',
    project: { id: 'p1', name: 'althar' },
    task: {
      ...base.task,
      id: 't-long',
      title: LONG_TITLE,
      request: LONG_REQUEST,
      slug: 'investigate-why-tasks-move-slowly-from-step-to',
      state: 'active',
      kind: 'change',
      branch: 'althar/investigate-why-tasks-move-slowly-from-step-to',
      worktree: '/Users/balazs/Althar/althar/investigate-why-tasks-move-slowly-from-step-to',
      phase: 'running',
      step: 'publish',
      stepAt: L.at(164),
      startedAt: L.at(0),
      steps: plan,
      lead: { agentId: 'claude-code', model: 'claude-opus-5-5', account: null },
      changes: [pullRequest({})],
      files: [
        { path: 'packages/runtime/src/Runs.ts', from: null, status: 'modified', add: 188, del: 41, binary: false, uncommitted: false },
        { path: 'packages/runtime/src/Sessions.ts', from: null, status: 'modified', add: 64, del: 18, binary: false, uncommitted: false },
        {
          path: 'packages/runtime/src/setupReplay.ts',
          from: null,
          status: 'modified',
          add: 52,
          del: 20,
          binary: false,
          uncommitted: false,
        },
        { path: 'packages/runtime/src/publish.ts', from: null, status: 'modified', add: 38, del: 11, binary: false, uncommitted: false },
        {
          path: 'packages/runtime/scripts/probe-steps.ts',
          from: null,
          status: 'added',
          add: 141,
          del: 0,
          binary: false,
          uncommitted: false,
        },
        { path: 'packages/runtime/tests/runs.test.ts', from: null, status: 'modified', add: 96, del: 6, binary: false, uncommitted: false },
      ],
      commits: 11,
      actions: ['stop', 'abandon'],
    } as ThreadSnapshot['task'],
    session: {
      ...base.session!,
      agentId: 'claude-code',
      agentName: 'Claude Code',
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      models: ['claude-opus-5-5'],
    },
    attention: [LONG_PERMISSION],
    items: longItems,
    reports: longItems.filter((one) => one.kind === 'step_result'),
  })
}

/* ——— The short one: one round of work, a review that passed, a pull request. ——— */

const SHORT_START = now - 34 * MIN
const S = thread(SHORT_START)

const SHORT_TITLE = 'Show a task’s whole branch name on hover in its header'

const shortItems: ThreadItem[] = [
  S.says(1, 'I’ll give the branch chip in the header a tooltip with the whole name, as the board’s card has.'),
  S.tool(2, 'Read packages/ui/src/chrome/TaskHeader/TaskHeader.tsx', 'read', { path: 'packages/ui/src/chrome/TaskHeader/TaskHeader.tsx' }),
  S.tool(3, 'Read packages/ui/src/board/BoardCard/Chips.tsx', 'read', { path: 'packages/ui/src/board/BoardCard/Chips.tsx' }),
  S.tool(6, 'Edit packages/ui/src/chrome/TaskHeader/TaskHeader.tsx', 'edit', { path: 'packages/ui/src/chrome/TaskHeader/TaskHeader.tsx' }),
  S.tool(8, 'Edit packages/ui/src/chrome/TaskHeader/TaskHeader.stories.tsx', 'edit', {
    path: 'packages/ui/src/chrome/TaskHeader/TaskHeader.stories.tsx',
  }),
  S.tool(11, 'Run bunx vitest run --maxWorkers=1 TaskHeader', 'execute', {
    command: 'bunx vitest run --maxWorkers=1 src/chrome/TaskHeader',
    output: ' Tests  23 passed (23)\n',
    exit: 0,
  }),
  S.step(13, {
    step: 'implement',
    round: 0,
    summary: 'The header’s branch chip shows the whole name on hover and keyboard focus.',
    built: 'A task’s header shows its whole branch name on hover and on keyboard focus, in mono, as the board’s card does.',
    evidence: [
      run('bunx vitest run --maxWorkers=1 src/chrome/TaskHeader', 'TaskHeader’s tests', ' Tests  23 passed (23)'),
      note('A story for a long branch name', 'TaskHeader / Long branch'),
    ],
    unverified: [],
  }),
  S.says(
    14,
    'The branch chip in the header now shows the whole name on hover and on keyboard focus, as the board’s card does. There’s a story for a long name.',
  ),
  S.notice(15, 'Started Codex afresh.'),
  S.tool(
    16,
    'Read packages/ui/src/chrome/TaskHeader/TaskHeader.tsx',
    'read',
    { path: 'packages/ui/src/chrome/TaskHeader/TaskHeader.tsx' },
    'codex',
  ),
  S.step(19, {
    step: 'review',
    round: 0,
    verdict: 'pass',
    findings: [],
    summary: 'The tooltip opens on focus as well as hover, and the long story shows it doesn’t overflow. Nothing to change.',
    agentId: 'codex',
  }),
  S.step(21, {
    step: 'publish',
    round: 0,
    summary: '',
    change: pullRequest({
      number: 615,
      title: 'A task’s header shows its whole branch name on hover',
      url: 'https://github.com/AltharIDE/althar/pull/615',
      draft: false,
      additions: 18,
      deletions: 3,
      changedFiles: 2,
      head: 'e41f0aa',
      localHead: 'e41f0aa',
    }),
  }),
]

export const shortSnapshot = (): ThreadSnapshot => {
  const base = snapshot()
  return snapshot({
    threadId: 'th-short',
    project: { id: 'p1', name: 'althar' },
    task: {
      ...base.task,
      id: 't-short',
      title: SHORT_TITLE,
      request: 'The branch name in a task’s header is cut off with no way to read it. Show it in full on hover.',
      slug: 'show-a-tasks-whole-branch-name-on-hover',
      kind: 'change',
      branch: 'althar/show-a-tasks-whole-branch-name-on-hover',
      worktree: '/Users/balazs/Althar/althar/show-a-tasks-whole-branch-name-on-hover',
      phase: 'ready',
      step: null,
      startedAt: S.at(0),
      steps: plan.map((one) => (one.key === 'review' ? { ...one } : { ...one, effort: 'medium' })),
      lead: { agentId: 'claude-code', model: 'claude-opus-5-5', account: null },
      changes: [
        pullRequest({
          number: 615,
          title: 'A task’s header shows its whole branch name on hover',
          url: 'https://github.com/AltharIDE/althar/pull/615',
          draft: false,
          additions: 18,
          deletions: 3,
          changedFiles: 2,
          head: 'e41f0aa',
          localHead: 'e41f0aa',
        }),
      ],
      files: [
        {
          path: 'packages/ui/src/chrome/TaskHeader/TaskHeader.tsx',
          from: null,
          status: 'modified',
          add: 12,
          del: 3,
          binary: false,
          uncommitted: false,
        },
        {
          path: 'packages/ui/src/chrome/TaskHeader/TaskHeader.stories.tsx',
          from: null,
          status: 'modified',
          add: 6,
          del: 0,
          binary: false,
          uncommitted: false,
        },
      ],
      commits: 1,
      actions: ['abandon'],
    } as ThreadSnapshot['task'],
    session: {
      ...base.session!,
      agentId: 'claude-code',
      agentName: 'Claude Code',
      model: 'claude-opus-5-5',
      effort: 'medium',
      models: ['claude-opus-5-5'],
    },
    attention: [],
    items: shortItems,
    reports: shortItems.filter((one) => one.kind === 'step_result'),
  })
}

export const TASKS = {
  long: { taskId: 't-long', threadId: 'th-long', title: LONG_TITLE, snapshot: longSnapshot, findings: LONG_TASK_FINDINGS },
  short: { taskId: 't-short', threadId: 'th-short', title: SHORT_TITLE, snapshot: shortSnapshot, findings: [] as TaskFinding[] },
} as const

export type TaskKey = keyof typeof TASKS
