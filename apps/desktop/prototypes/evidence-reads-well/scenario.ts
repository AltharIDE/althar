import type { Evidence, ThreadItem, ThreadSnapshot } from '@althar/contracts'

import { change, items, snapshot } from '../../tests/fixtures'
import { recorded } from './recorded'

/*
 * Four tasks as the runtime would give them, ready for the person, each
 * with real content from Althar's own store: what its lead reported, what
 * it showed and what it couldn't. Beside each, what a direction needs that
 * the data doesn't carry yet (marked as such on the pages): the claims the
 * summary makes and which pieces prove them, before/after pairs, and areas
 * of change. The summary of what was built (the task running beside this
 * one) is written from each lead's own report.
 */

export type ScenarioKey = 'ui' | 'runtime' | 'unverified' | 'none'

export interface Claim {
  readonly text: string
  /** The pieces that prove it, by their place in the step's evidence. */
  readonly proof: readonly number[]
}

export interface Scenario {
  readonly key: ScenarioKey
  readonly n: number
  /** What the scenario is, for the pages. */
  readonly name: string
  readonly title: string
  readonly request: string
  /** What it built: the task's one summary, above the evidence. */
  readonly built: string
  /** The lead's step report, as it said it. */
  readonly report: string
  readonly evidence: readonly Evidence[]
  readonly unverified: readonly string[] | null
  readonly claims: readonly Claim[]
  /** Before and after, for C: two pieces, and what they're of. */
  readonly pairs: readonly { readonly before: number; readonly after: number; readonly of: string }[]
  /** Areas of change, for E: each with its pieces and the unverified lines that belong to it. */
  readonly areas: readonly {
    readonly title: string
    readonly files?: string
    readonly pieces: readonly number[]
    readonly open?: readonly number[]
  }[]
  /** Screenshots grouped and in order, for B. */
  readonly groups: readonly { readonly title: string; readonly pieces: readonly number[] }[]
  /** Said on the pages, where the content isn't all as recorded. */
  readonly note?: string
}

const picture = (digest: string, name: string, width: number, height: number, bytes: number): Evidence['picture'] => ({
  digest,
  mediaType: 'image/png',
  bytes,
  width,
  height,
  name,
  unkept: null,
})

const run = (kind: Evidence['kind'], caption: string, command: string, exit: number, text: string): Evidence => ({
  kind,
  caption,
  picture: null,
  command,
  exit,
  text,
  dropped: 0,
})

/* DEV-58 ran before leads could hand evidence: its pieces are what its reports said they checked, with its own screenshots. */
const dev58: readonly Evidence[] = [
  {
    kind: 'screenshot',
    caption: 'Settings: the Agents at once row under Keep awake, "4: this Mac has 16 GB and 10 cores", with Use the default',
    picture: picture('b7f99b17a5d5da5d92ef79182bb7569bbc8f8755cc0134c710f22ea56564c237', 'settings-agents-at-once.png', 1520, 1040, 79606),
    command: null,
    exit: null,
    text: null,
    dropped: 0,
  },
  {
    kind: 'screenshot',
    caption: 'Home: the project line reads "2 waiting: 4 of 4 agents busy"',
    picture: picture('b1bf53436ad6e6d0d9ecfbe1e77325f82179380217278d70559f3f452a8ab41c', 'home-waiting.png', 2560, 1600, 817984),
    command: null,
    exit: null,
    text: null,
    dropped: 0,
  },
  run('command', 'Format, lint and types in every package', 'bun run check', 0, 'every package: Exited with code 0'),
  run(
    'test_run',
    'The Busy tests: answers, messages and stuck steps wait for a place; waiting survives a restart; a waiting task stops',
    'cd packages/runtime && bunx vp test run tests/busy.test.ts',
    0,
    ' Test Files  1 passed (1)\n      Tests  21 passed (21)',
  ),
  run(
    'test_run',
    'Full runtime suite: 24 failures, each of which also fails on a clean main copy in this sandbox (52 there)',
    'cd packages/runtime && bunx vp test run',
    1,
    'Tests  24 failed | 839 passed (863)\n(main, same sandbox: 52 failed)',
  ),
  run(
    'test_run',
    'Desktop suite: 1 failure, tabs.test.tsx "isn\'t read before there is a project", which fails on main too',
    'cd apps/desktop && bunx vp test run',
    1,
    "FAIL tests/tabs.test.tsx > isn't read before there is a project\n Test Files  1 failed | 49 passed (50)",
  ),
]

export const scenarios: readonly Scenario[] = [
  {
    key: 'ui',
    n: 1,
    name: 'A UI task with 8 screenshots',
    title: 'Scrappy prototype: make unpushed commits the focus',
    request: 'Make pushing the lead’s commits the thing to do first, over Accept and merge.',
    built:
      'Five prototype directions for putting unpushed commits first, each a page on a local Vite server built from the app’s real task view, Outputs and board. **The pick is A, with C’s card line**: on Outputs one violet “Push 3 commits”, Accept held with its reason until everything is up; on the board and home, “3 commits not pushed · Push”.',
    report: recorded.ui.summary,
    evidence: recorded.ui.evidence,
    unverified: recorded.ui.unverified,
    claims: [
      { text: 'Today, Push and Accept and merge compete: both violet', proof: [1, 5] },
      { text: 'In A, Push 3 commits is the one primary button, and Accept is held with its reason', proof: [2] },
      { text: 'Once pushed, the count goes at once and Accept and merge is primary again', proof: [3, 9] },
      { text: 'A branch that can’t be pushed says why inside the card', proof: [4] },
      { text: 'C puts “3 commits not pushed · Push” on the board card and the home', proof: [7] },
      { text: 'E puts Push inline under the lead’s message', proof: [6] },
      { text: 'Every direction side by side on one page', proof: [0] },
      { text: 'The prototype passes format, lint and types', proof: [8] },
    ],
    pairs: [
      { before: 1, after: 2, of: 'Outputs, with 3 commits to push' },
      { before: 5, after: 6, of: 'The conversation, with 3 commits to push' },
    ],
    areas: [
      { title: 'Outputs', files: 'Outputs.tsx, ChangeSet.tsx', pieces: [1, 2, 3, 4] },
      { title: 'The conversation', files: 'TaskView.tsx', pieces: [5, 6] },
      { title: 'Board and home', files: 'AcceptCard.tsx, Surfaces.tsx', pieces: [7], open: [1] },
      { title: 'The pages', files: 'prototypes/unpushed-first', pieces: [0, 8, 9], open: [0, 2] },
    ],
    groups: [
      { title: 'Today', pieces: [1, 5] },
      { title: 'A: one primary button', pieces: [2, 3, 4] },
      { title: 'C and E', pieces: [7, 6] },
      { title: 'Every direction', pieces: [0] },
    ],
  },
  {
    key: 'runtime',
    n: 2,
    name: 'A runtime task with only test output',
    title: 'Push button leaves commits behind or shows a stale count',
    request: 'Push sometimes leaves commits behind, or the count goes back to 10 after pushing.',
    built:
      'Push now pushes everything in one press, and the count goes to nothing at once. Two causes in the runtime: the host’s stale head overwrote what was just pushed (`caughtUp` in `Changes.ts`), and commits Push had credited but couldn’t move the branch onto looked rewritten (`againstPullRequest` in `Queries.ts`). The task view keeps Push busy until the card is read again.',
    report: recorded.runtime.summary,
    evidence: recorded.runtime.evidence,
    unverified: recorded.runtime.unverified,
    claims: [
      { text: 'Ten commits go in one press, with the host still giving the old head', proof: [0, 1] },
      { text: 'Commits credited mid-merge are pushed, not offered a force-replace', proof: [0, 1] },
      { text: 'Push stays busy until the card is read again', proof: [2] },
      { text: 'Nothing else in the runtime or the repository broke', proof: [3, 4] },
    ],
    pairs: [{ before: 0, after: 1, of: 'The new Push button tests' }],
    areas: [
      { title: 'Runtime', files: 'Changes.ts, Queries.ts', pieces: [0, 1, 3], open: [0] },
      { title: 'Desktop', files: 'useTask.ts', pieces: [2], open: [1] },
      { title: 'Repository', pieces: [4] },
    ],
    groups: [],
  },
  {
    key: 'unverified',
    n: 3,
    name: 'A task with several unverified items',
    title: 'Cap parallel agents per machine (DEV-58 launch scope)',
    request: 'DEV-58: cap how many agents work at once on one machine, and queue the rest.',
    built:
      'Althar caps how many tasks’ agents work at once on this Mac, and the rest wait their turn, oldest first. The default comes from the Mac (16 GB and 10 cores gives 4) and can be changed under **Settings → Agents at once**. Every agent turn asks for a place, waiting survives a restart, and a waiting task can still be stopped or have its plan changed.',
    report: dev58Report(),
    evidence: dev58,
    unverified: [
      'I didn’t get a result from the UI kit’s Storybook play tests: the run printed nothing.',
      'The lead settling after a review that left something running has no test of its own. It uses the same code as the review case.',
      'origin/main now has its own 0026_project_notes migration. When main is merged in, this branch’s 0026_agents_at_once must become 0027, with its checksum and schema.sql redone.',
      'The real Settings row still uses the picker until the person picks the slider prototype.',
    ],
    claims: [
      { text: 'Settings has an Agents at once row under Keep awake', proof: [0] },
      { text: 'The home says how many wait: “2 waiting: 4 of 4 agents busy”', proof: [1] },
      { text: 'Every turn asks for a place, waiting survives a restart, and a waiting task can be stopped', proof: [3] },
      { text: 'The rest of the runtime and desktop is no worse than main', proof: [4, 5] },
      { text: 'Format, lint and types pass', proof: [2] },
    ],
    pairs: [],
    areas: [
      { title: 'Runtime', files: 'Busy.ts, atOnce.ts, Runs.ts', pieces: [3, 4], open: [1, 2] },
      { title: 'Settings and home', files: 'Preferences.tsx, ProjectList.tsx', pieces: [0, 1], open: [0, 3] },
      { title: 'Desktop and repository', pieces: [5, 2] },
    ],
    groups: [{ title: 'Settings and home', pieces: [0, 1] }],
    note: 'DEV-58 ran before leads could hand evidence, so its pieces are what its reports say it checked, with its own two screenshots; its unverified lines are its reports’ “Left open”.',
  },
  {
    key: 'none',
    n: 4,
    name: 'A step with no evidence',
    title: 'Leads finish tasks with evidence of what they built',
    request: 'At the end of a task there should be a list of evidence: screenshots for a frontend app, other evidence elsewhere.',
    built:
      'Leads can hand evidence with `finish_step`: screenshots, commands, test runs, responses, logs and notes, each captioned, and what they couldn’t show. It shows under each lead step, on Outputs and in the pull request’s description.',
    report: recorded.none.summary,
    evidence: [],
    unverified: null,
    claims: [
      { text: 'Leads hand evidence with finish_step, each piece captioned', proof: [] },
      { text: 'It shows under each lead step, on Outputs and in the pull request', proof: [] },
      { text: 'Althar refuses evidence it can’t keep, and says why', proof: [] },
    ],
    pairs: [],
    areas: [],
    groups: [],
    note: 'The task that built evidence handed none of its own: the Althar running it predated the change.',
  },
]

/** DEV-58's last settling report, as its lead said it. */
function dev58Report() {
  return `Fixed both findings.

What changed:
- **The waiting mark clears when a turn starts from the queue.** When a waiting turn gets its place this way, its mark on the thread (\`waits_for_place\`) is cleared at the same moment. The card stops showing it as waiting, and a restart doesn't start that agent again.
- **A task whose turn waits can be stopped.** A task whose only work is a waiting turn now counts as having work on its way, so it offers Stop even with no agent running, as after a restart. Stopping it clears the waiting turn, and it never starts.

How I checked:
- \`bun run check\` passes.
- The Busy tests pass (21). Two new ones cover: a turn delivered once a place freed, after which the mark and the card clear and a restart starts nothing extra; and a task stopped after a restart while its idle lead waits, which never starts once the place frees.
- The full runtime suite has 24 failures. All of them also fail on a clean main copy in this sandbox.`
}

export const scenarioOf = (key: string): Scenario => scenarios.find((one) => one.key === key) ?? (scenarios[0] as Scenario)

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const at = (m: number, item: ThreadItem): ThreadItem => ({ ...item, createdAt: minutesAgo(m) })

/** The thread: the lead's last work, its step report with what it showed, and the review that passed it. */
const thread = (scenario: Scenario): ThreadItem[] => [
  at(31, items.tool({ title: 'Edit the change', toolKind: 'edit' })),
  at(29, items.tool({ title: 'bun run check', toolKind: 'execute', command: 'bun run check', exit: 0 })),
  at(
    27,
    items.step({
      step: 'implement',
      summary: scenario.report,
      evidence: [...scenario.evidence],
      unverified: scenario.unverified === null ? null : [...scenario.unverified],
    }),
  ),
  at(12, items.step({ step: 'review', verdict: 'pass', summary: 'Looks right; the evidence matches what it says.', agentId: 'codex' })),
]

export const snapshotOf = (scenario: Scenario): ThreadSnapshot => {
  const base = snapshot()
  return snapshot({
    task: {
      ...base.task,
      title: scenario.title,
      slug: scenario.key,
      branch: `althar/${scenario.key}`,
      phase: 'ready',
      request: scenario.request,
      steps: [
        { key: 'implement', agentId: 'claude-code', model: 'opus', skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: false },
      ],
      lead: { agentId: 'claude-code', model: 'opus', account: null },
      startedAt: minutesAgo(52),
      changes: [
        change({
          number: 140 + scenario.n,
          url: `https://github.com/AltharIDE/althar/pull/${140 + scenario.n}`,
          title: scenario.title,
          draft: false,
          unpushed: 0,
          additions: 412,
          deletions: 37,
          changedFiles: 9,
          checks: {
            outcome: 'passed',
            passed: 3,
            failed: 0,
            running: 0,
            total: 3,
            failing: [],
            list: [
              { name: 'desktop', state: 'passed', summary: null },
              { name: 'ui', state: 'passed', summary: null },
              { name: 'harness', state: 'passed', summary: null },
            ],
          },
        }),
      ],
      files: [
        { path: 'packages/runtime/src/Changes.ts', from: null, status: 'modified', add: 58, del: 9, binary: false, uncommitted: false },
      ],
      commits: 4,
      actions: ['stop', 'abandon'],
    },
    items: thread(scenario),
  })
}
