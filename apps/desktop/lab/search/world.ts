import type { ProjectInk, TaskKind, TaskPhase } from '@althar/contracts'

import FILES from './files.json'

/*
 * The search lab's world, as plain facts: three projects, althar's with its
 * real recent pull requests, branches, issues, notes and files, a long
 * conversation with each coordinator and a thread for each task. data.ts
 * turns it into what the fake runtime answers; index.ts into what search
 * finds. Times are minutes before now, so "2h ago" reads right.
 */

export const ALTHAR = 'p_althar'
export const MERIDIAN = 'p_meridian'
export const ERZA = 'p_erza'

export interface WorldProject {
  readonly id: string
  readonly name: string
  readonly ink: ProjectInk
  /** Where its pull requests live, as the host names it. */
  readonly repository: string | null
  readonly tracker: 'linear' | 'github' | null
}

export const PROJECTS: ReadonlyArray<WorldProject> = [
  { id: ALTHAR, name: 'althar', ink: 'slate', repository: 'AltharIDE/althar', tracker: 'linear' },
  { id: MERIDIAN, name: 'meridian', ink: 'teal', repository: 'meridian/api', tracker: 'github' },
  { id: ERZA, name: 'erza', ink: 'clay', repository: null, tracker: null },
]

export type Who = 'you' | 'lead' | 'coordinator'

export interface Said {
  readonly who: Who
  readonly text: string
  /** Minutes before now. */
  readonly ago: number
}

export interface WorldTask {
  readonly slug: string
  readonly project: string
  readonly title: string
  readonly phase: TaskPhase
  readonly state?: 'open' | 'done' | 'abandoned'
  readonly kind?: TaskKind
  readonly pr?: number
  readonly issue?: string
  readonly lead?: 'claude-code' | 'codex'
  readonly model?: string
  /** Minutes since it started, or since it settled. */
  readonly ago: number
  readonly summary?: string
  readonly files?: ReadonlyArray<string>
  readonly thread?: ReadonlyArray<Said>
  /** What it waits on you for, where it waits. */
  readonly asks?: string
}

export interface WorldPull {
  readonly number: number
  readonly project: string
  readonly title: string
  readonly state: 'open' | 'merged' | 'closed'
  readonly draft?: boolean
  readonly checks: 'passed' | 'failed' | 'running'
  /** Who opened it: Althar for a task's, or a person's handle. */
  readonly author: string
  readonly task?: string
  readonly body: string
  readonly ago: number
}

export interface WorldIssue {
  readonly key: string
  readonly project: string
  readonly title: string
  readonly body: string
  readonly status: 'Backlog' | 'Todo' | 'In Progress' | 'In Review' | 'Done'
  readonly task?: string
  readonly ago: number
}

export interface WorldNote {
  readonly id: string
  readonly project: string
  readonly body: string
  readonly ago: number
}

const DAY = 24 * 60
const H = 60

/** Althar's tasks: what's on its board now, then what it settled, newest first. */
const altharOpen: ReadonlyArray<WorldTask> = [
  {
    slug: 'prototype-search-across-althar',
    project: ALTHAR,
    title: 'Prototype: search across Althar',
    phase: 'running',
    kind: 'plain',
    lead: 'claude-code',
    model: 'Opus 5.5',
    ago: 34,
    files: [
      'apps/desktop/lab/search/Search.tsx',
      'apps/desktop/src/renderer/features/finder/FinderView.tsx',
      'packages/ui/src/chrome/Finder/Finder.tsx',
    ],
    thread: [
      {
        who: 'you',
        text: 'Help me design a search functionality. The first step is asking, what searches work really well? Raycast, Linear etc principles. Prototype',
        ago: 34,
      },
      {
        who: 'lead',
        text: 'I’ll study what makes the best searches work (Raycast, Linear’s ⌘K, Superhuman, Arc, VS Code’s quick open), write the principles down, then build three directions on the real app with an A/B/C switcher.',
        ago: 33,
      },
      {
        who: 'lead',
        text: 'Today’s ⌘K finds tasks only, through SQLite’s full-text index, and waits 120 ms after each key before it asks the runtime. Pull requests, issues, notes and what was said in a conversation can’t be found, and nothing can be done from it.',
        ago: 20,
      },
    ],
  },
  {
    slug: 'prototype-where-scratch-lives-and-what-it-s-call',
    project: ALTHAR,
    title: 'Prototype: where Scratch lives and what it’s called',
    phase: 'running',
    kind: 'plain',
    lead: 'claude-code',
    model: 'Opus 5.5',
    ago: 52,
    thread: [
      { who: 'you', text: 'Scratch chats get lost. Where should they live, and is Scratch even the right word?', ago: 52 },
      {
        who: 'lead',
        text: 'Three places to try: a shelf under the board, a pill in the conversation’s header, and the composer’s own menu. For the word, Scratch, Chats and Asides, each on the real screens.',
        ago: 50,
      },
    ],
  },
  {
    slug: 'make-small-changes-fast',
    project: ALTHAR,
    title: 'Make small changes fast',
    phase: 'running',
    kind: 'change',
    lead: 'codex',
    model: 'GPT-6.1 Sol',
    issue: 'DEV-241',
    ago: 78,
    files: ['packages/runtime/src/Setups.ts', 'packages/runtime/src/Plans.ts', 'packages/runtime/src/checkouts.ts'],
    thread: [
      { who: 'you', text: 'A one-line fix took about 40 minutes. That’s ridiculous. Find where the time goes and cut it.', ago: 78 },
      {
        who: 'lead',
        text: 'Most of it is setup: the worktree’s install runs in full (9 minutes), the review waits on a cold model (6 minutes), and the end-to-end run starts on a draft. I’ll reuse a warm worktree for small changes and skip the install when the lockfile hasn’t changed.',
        ago: 70,
      },
      {
        who: 'lead',
        text: 'A warm worktree takes the install from 9 minutes to 11 seconds. The review now starts while the checks run, not after them.',
        ago: 22,
      },
    ],
  },
  {
    slug: 'let-leads-listen-on-localhost-inside-the-sandbox',
    project: ALTHAR,
    title: 'Let leads listen on localhost inside the sandbox',
    phase: 'waiting',
    kind: 'change',
    lead: 'claude-code',
    model: 'Opus 5.5',
    ago: 64,
    asks: 'Run bunx vp dev --port 5330 --strictPort',
    files: ['packages/runtime/src/sandboxReach.ts', 'packages/contracts/src/sandbox.ts'],
    thread: [
      { who: 'you', text: 'Leads can’t start a dev server inside the sandbox. Let them listen on localhost.', ago: 64 },
      {
        who: 'lead',
        text: 'The sandbox refuses to bind any port. Listening on localhost is inside the sandbox’s boundary, so it shouldn’t ask. I need to run the dev server once to check the rule holds.',
        ago: 9,
      },
    ],
  },
  {
    slug: 'cap-parallel-agents-per-machine',
    project: ALTHAR,
    title: 'Cap parallel agents per machine',
    phase: 'ready',
    kind: 'change',
    pr: 845,
    issue: 'DEV-58',
    lead: 'claude-code',
    ago: 6 * H,
    summary: 'Agents at once is a setting of its own, worked out from this Mac’s memory and cores.',
    files: ['packages/runtime/src/Sessions.ts', 'apps/desktop/src/renderer/features/settings/SettingsPage.tsx'],
    thread: [
      { who: 'you', text: 'Six agents at once makes this Mac crawl. Cap how many run at once, from its memory.', ago: 6 * H },
      {
        who: 'lead',
        text: 'Agents at once is now a setting, worked out from memory and cores: 4 on a 16 GB Mac. A task over the cap waits for a free agent and starts on its own.',
        ago: 2 * H,
      },
    ],
  },
  {
    slug: 'copy-button-on-code-blocks-in-messages',
    project: ALTHAR,
    title: 'Copy button on code blocks in messages',
    phase: 'ready',
    kind: 'change',
    pr: 846,
    lead: 'codex',
    ago: 3 * H,
    summary: 'Every code block in a message has a copy button on hover; it copies the code alone, without the fence.',
    files: ['packages/ui/src/thread/Markdown/Markdown.tsx', 'packages/ui/src/primitives/CopyButton/CopyButton.tsx'],
    thread: [
      { who: 'you', text: 'Add a copy button to code blocks in messages. I keep selecting by hand.', ago: 3 * H },
      {
        who: 'lead',
        text: 'Each code block now shows a copy button on hover, top right, copying the code without its fence or language.',
        ago: 2 * H,
      },
    ],
  },
  {
    slug: 'fix-the-flaky-merge-queue-stress-wait',
    project: ALTHAR,
    title: 'Fix the flaky merge queue stress wait',
    phase: 'running',
    kind: 'change',
    pr: 847,
    lead: 'codex',
    model: 'GPT-6.1 Terra',
    ago: 41,
    files: ['.github/workflows/stress.yml', 'packages/testing/src/select.ts'],
    thread: [
      { who: 'you', text: 'The merge queue keeps waiting on stress runs that never started. Fix it.', ago: 41 },
      {
        who: 'lead',
        text: 'The queue waits for a stress run on an empty shadow branch, which never reports. It should treat a run that never started as passed.',
        ago: 30,
      },
    ],
  },
  {
    slug: 'make-the-lightbox-fill-large-screens',
    project: ALTHAR,
    title: 'Make the lightbox fill large screens',
    phase: 'planned',
    kind: 'change',
    issue: 'DEV-244',
    ago: 3,
    thread: [{ who: 'you', text: 'On a 5K display the lightbox shows screenshots at a third of the screen. Let it fill.', ago: 3 }],
  },
  {
    slug: 'dark-mode-across-the-whole-app',
    project: ALTHAR,
    title: 'Dark mode across the whole app',
    phase: 'held',
    kind: 'change',
    issue: 'DEV-239',
    ago: 2 * DAY,
    thread: [
      {
        who: 'you',
        text: 'Dark mode misses half the app: the board’s cards, settings and the syntax colours. Make it whole, and warm.',
        ago: 2 * DAY,
      },
    ],
  },
  {
    slug: 'what-ship-and-push-mean-on-a-task-with-a-pull-request',
    project: ALTHAR,
    title: 'What Ship and Push mean on a task with a pull request',
    phase: 'kept',
    kind: 'plain',
    ago: DAY,
    summary: 'Ship runs the review over everything since the last one and sends it up; Push only sends commits.',
    thread: [
      { who: 'you', text: 'What’s the difference between Ship and Push on a task that already has a pull request?', ago: DAY },
      {
        who: 'lead',
        text: 'Ship runs the review over everything since the last one, then pushes and opens or updates the pull request. Push only sends the commits up, with no review.',
        ago: DAY - 4,
      },
    ],
  },
  {
    slug: 'read-bitbucket-cloud-pull-requests',
    project: ALTHAR,
    title: 'Read Bitbucket Cloud pull requests',
    phase: 'stopped',
    kind: 'change',
    issue: 'DEV-228',
    ago: 3 * DAY,
    thread: [
      { who: 'you', text: 'Read Bitbucket Cloud pull requests the way GitHub’s are read.', ago: 3 * DAY },
      {
        who: 'lead',
        text: 'Bitbucket Cloud’s API needs an app password per workspace; I stopped to ask how you want to sign in.',
        ago: 3 * DAY - 30,
      },
    ],
  },
]

/** Merged pull requests of althar's, from its history: each a settled task. */
const MERGED: ReadonlyArray<readonly [number, string, string?]> = [
  [
    843,
    'Add hover previews and message navigation to chats',
    'A conversation has a rail of its messages: hover one for a preview, press it to go there.',
  ],
  [842, 'Read a restarted task’s card once it is ready, not only held'],
  [840, 'Count a card’s git runs with no turn following behind'],
  [839, 'A restart carries on only the helpers it left behind'],
  [
    832,
    'Asides start cleanly and answer a plain “hi” fast',
    'An aside answers in a second or two: it reads the local checkout and installs nothing.',
  ],
  [831, 'Any task’s parts change both ways by talking to its lead'],
  [830, 'Sanity pass: fix the high-effort findings at their root'],
  [828, 'Check counts leave out skipped checks'],
  [823, 'Change preset ends as the project’s setting says'],
  [822, 'No raw MCP tool names anywhere in the UI'],
  [821, 'A settled card animates into Settled only once'],
  [820, 'Enter waits for a running voice note before sending'],
  [
    804,
    'Asides: chats live beside the coordinator’s conversation',
    'A quick question opens as an aside beside the conversation, and folds away when answered.',
  ],
  [800, 'Althar stays responsive when the Mac is busy'],
  [798, 'Up next reorders by drag; no turns for idle or merged tasks'],
  [794, 'Board cards’ activity line reads plainly, with no URLs'],
  [793, 'Merge line shows as one live card, not repeated chat lines'],
  [792, 'Merging main into a task’s branch starts no review round'],
  [791, 'Stress: three runs on the PR, the long pass at night, and never in the queue'],
  [789, 'Review after merge: major only, or skipped, as a setting'],
  [788, 'A task a lead started shows live in its thread'],
  [786, 'The model picker shows a change at once'],
  [784, 'Board cards show handed-back pictures and files beside their branch or pull request chip'],
  [781, 'The board keeps up with tasks as the task view does'],
  [778, 'Follow-up PRs say what they do; card shows running checks'],
  [776, 'A skipped review can be added back until merge'],
  [774, 'A queued task can be held; the plan card loses clutter'],
  [771, 'Task chats drop lines about other tasks and skills'],
  [770, 'Any reply from the person clears “Waiting on you”'],
  [769, 'Remove the ownership limits on PR tools and reviews'],
  [766, 'Coordinator plans from presets; Prototype has no review'],
  [762, 'Remove startup status text from the launch screen'],
  [755, 'Review requests become reviews; stop a lead before a test removes its folder'],
  [747, 'Run sessions on the person’s own Codex, where they have one'],
  [
    734,
    'Project canvases for agents to draw and iterate on',
    'Agents draw canvases the person comments on; each version is kept, and the Artifacts view lists them.',
  ],
  [716, 'Show what the host needs before a change can merge'],
  [714, 'Open a GitLab MR once GitLab knows the branch just pushed'],
  [659, 'Warn before agent sign-in ends; say why it can’t start', 'A sign-in that ends within a day shows in the bar, with Sign in again.'],
  [651, '“Latest” pill clears the composer’s pill row'],
]

const ISSUE_OF: Readonly<Record<number, string>> = { 659: 'DEV-196', 651: 'DEV-151', 771: 'DEV-220', 716: 'DEV-204' }

const slugOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[’'“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)

const altharSettled: ReadonlyArray<WorldTask> = MERGED.map(([pr, title, summary], at) => ({
  slug: slugOf(title),
  project: ALTHAR,
  title,
  phase: 'settled' as const,
  state: 'done' as const,
  kind: 'change' as const,
  pr,
  ...(ISSUE_OF[pr] === undefined ? {} : { issue: ISSUE_OF[pr] }),
  // A merge every few hours, back three weeks.
  ago: 2 * H + at * 9 * H,
  ...(summary === undefined ? {} : { summary }),
}))

const meridianTasks: ReadonlyArray<WorldTask> = [
  {
    slug: 'stage-the-refunds-api',
    project: MERIDIAN,
    title: 'Stage the refunds API',
    phase: 'waiting',
    kind: 'change',
    ago: 40,
    asks: 'Run make deploy-staging',
    thread: [
      { who: 'you', text: 'Stage the refunds API so the partners can try it this week.', ago: 40 },
      { who: 'lead', text: 'Everything is in place. Deploying to staging always asks: I need to run make deploy-staging.', ago: 6 },
    ],
  },
  {
    slug: 'show-refund-status-on-receipts',
    project: MERIDIAN,
    title: 'Show refund status on receipts',
    phase: 'ready',
    kind: 'change',
    pr: 412,
    issue: '#77',
    ago: 2 * H,
    summary: 'Receipts say whether a refund is pending, done or refused.',
    thread: [
      { who: 'you', text: 'Customers can’t tell if a refund went through. Put its status on the receipt.', ago: 4 * H },
      { who: 'lead', text: 'Receipts now say Refund pending, Refunded or Refund refused, from the ledger.', ago: 2 * H },
    ],
  },
  {
    slug: 'retry-webhooks-with-back-off',
    project: MERIDIAN,
    title: 'Retry webhooks with back-off',
    phase: 'planned',
    kind: 'change',
    issue: '#81',
    ago: 12,
    thread: [{ who: 'you', text: 'Webhook retries hammer the partners when they’re down. Back off.', ago: 12 }],
  },
  {
    slug: 'rate-limit-the-partner-api',
    project: MERIDIAN,
    title: 'Rate-limit the partner API',
    phase: 'running',
    kind: 'change',
    lead: 'claude-code',
    ago: 24,
    files: ['src/partners/limit.ts', 'src/partners/router.ts'],
    thread: [
      { who: 'you', text: 'Rate-limit the partner API: 100 requests a minute per key.', ago: 24 },
      {
        who: 'lead',
        text: 'Refunds share the partner budget, so a burst of refunds could starve charges. I’ll give refunds a budget of their own.',
        ago: 15,
      },
    ],
  },
  {
    slug: 'move-sessions-to-redis',
    project: MERIDIAN,
    title: 'Move sessions to Redis',
    phase: 'running',
    kind: 'change',
    lead: 'codex',
    ago: 52,
    thread: [{ who: 'you', text: 'Move sessions out of Postgres into Redis; they expire anyway.', ago: 52 }],
  },
  {
    slug: 'fix-the-flaky-checkout-test',
    project: MERIDIAN,
    title: 'Fix the flaky checkout test',
    phase: 'running',
    kind: 'change',
    lead: 'claude-code',
    ago: 9,
    thread: [
      { who: 'you', text: 'The checkout test fails one run in five. Find out why.', ago: 9 },
      { who: 'lead', text: 'It reproduced on the second run: a clock in the fixture, not the checkout itself.', ago: 3 },
    ],
  },
  {
    slug: 'drop-the-legacy-v1-routes',
    project: MERIDIAN,
    title: 'Drop the legacy v1 routes',
    phase: 'settled',
    state: 'done',
    kind: 'change',
    pr: 398,
    ago: 5 * H,
    summary: 'The v1 routes are gone; v2 answers everything they did.',
  },
  {
    slug: 'try-bun-for-the-cli',
    project: MERIDIAN,
    title: 'Try Bun for the CLI',
    phase: 'settled',
    state: 'abandoned',
    kind: 'plain',
    ago: 10 * H,
  },
]

const erzaTasks: ReadonlyArray<WorldTask> = [
  {
    slug: 'draft-the-onboarding-emails',
    project: ERZA,
    title: 'Draft the onboarding emails',
    phase: 'running',
    kind: 'plain',
    lead: 'claude-code',
    ago: 18,
    thread: [
      { who: 'you', text: 'Draft five onboarding emails for the first two weeks, plain and short.', ago: 18 },
      { who: 'lead', text: 'Five drafts in emails/onboarding: day 1, 2, 4, 7 and 14. Each under 120 words.', ago: 5 },
    ],
  },
  {
    slug: 'look-around-the-repository',
    project: ERZA,
    title: 'Look around the repository',
    phase: 'settled',
    state: 'done',
    kind: 'plain',
    ago: 30 * H,
  },
]

export const TASKS: ReadonlyArray<WorldTask> = [...altharOpen, ...altharSettled, ...meridianTasks, ...erzaTasks]

export const PULLS: ReadonlyArray<WorldPull> = [
  ...TASKS.flatMap((task): ReadonlyArray<WorldPull> =>
    task.pr === undefined
      ? []
      : [
          {
            number: task.pr,
            project: task.project,
            title: task.title,
            state: task.phase === 'settled' ? 'merged' : 'open',
            draft: task.phase === 'running',
            checks: task.phase === 'running' ? 'running' : 'passed',
            author: 'Althar',
            task: task.slug,
            body: task.summary ?? task.title,
            ago: task.ago,
          },
        ],
  ),
  {
    number: 844,
    project: ALTHAR,
    title: 'Update Electron to 39.2.1',
    state: 'open',
    checks: 'passed',
    author: 'dependabot',
    body: 'Bumps electron from 39.1.0 to 39.2.1.',
    ago: 9 * H,
  },
  {
    number: 838,
    project: ALTHAR,
    title: 'Site: a calmer hero, and the shifts in one row',
    state: 'open',
    draft: true,
    checks: 'failed',
    author: 'mira',
    body: 'The hero loses its second line; the four shifts sit in one row on wide screens.',
    ago: DAY + 3 * H,
  },
  {
    number: 405,
    project: MERIDIAN,
    title: 'Ledger: index refunds by charge',
    state: 'open',
    checks: 'passed',
    author: 'sam',
    body: 'Refund lookups by charge scan the table; this adds the index.',
    ago: 2 * DAY,
  },
]

export const ISSUES: ReadonlyArray<WorldIssue> = [
  {
    key: 'DEV-236',
    project: ALTHAR,
    title: 'Search across everything, not only tasks',
    body: '⌘K finds tasks only. Pull requests, issues, notes and what was said in a conversation can’t be found, and nothing can be done from it.',
    status: 'Backlog',
    ago: 4 * DAY,
  },
  {
    key: 'DEV-241',
    project: ALTHAR,
    title: 'Small changes take 40 minutes',
    body: 'A one-line fix took about 40 minutes end to end. Setup, review and CI each add their own wait.',
    status: 'In Progress',
    task: 'make-small-changes-fast',
    ago: 2 * H,
  },
  {
    key: 'DEV-58',
    project: ALTHAR,
    title: 'Cap parallel agents per machine',
    body: 'Six agents at once makes a 16 GB Mac crawl.',
    status: 'In Review',
    task: 'cap-parallel-agents-per-machine',
    ago: 9 * DAY,
  },
  {
    key: 'DEV-244',
    project: ALTHAR,
    title: 'Lightbox doesn’t fill a 5K display',
    body: 'Screenshots open at a third of the screen.',
    status: 'Todo',
    task: 'make-the-lightbox-fill-large-screens',
    ago: DAY,
  },
  {
    key: 'DEV-239',
    project: ALTHAR,
    title: 'Syntax highlighting is too faint in dark mode',
    body: 'Strings and keywords are hard to tell apart.',
    status: 'Todo',
    task: 'dark-mode-across-the-whole-app',
    ago: 3 * DAY,
  },
  {
    key: 'DEV-228',
    project: ALTHAR,
    title: 'Bitbucket Cloud pull requests',
    body: 'Read and open pull requests on Bitbucket Cloud.',
    status: 'Todo',
    task: 'read-bitbucket-cloud-pull-requests',
    ago: 6 * DAY,
  },
  {
    key: 'DEV-193',
    project: ALTHAR,
    title: 'Startup takes too long on a busy Mac',
    body: 'With six tasks running, the first screen takes 9 s.',
    status: 'Backlog',
    ago: 12 * DAY,
  },
  {
    key: 'DEV-196',
    project: ALTHAR,
    title: 'Warn before agent sign-in ends',
    body: 'Claude Code’s sign-in ends with no warning.',
    status: 'Done',
    ago: 15 * DAY,
  },
  {
    key: 'DEV-83',
    project: ALTHAR,
    title: 'A built-in browser beside the conversation',
    body: 'Leads and the person look at the same page.',
    status: 'Done',
    ago: 20 * DAY,
  },
  {
    key: 'DEV-96',
    project: ALTHAR,
    title: 'Read a task’s kind from what it has',
    body: 'Change, Review or nothing, never stored.',
    status: 'Done',
    ago: 25 * DAY,
  },
  {
    key: 'DEV-151',
    project: ALTHAR,
    title: '“Latest” pill clears the composer’s pill row',
    body: 'The pill overlaps the row.',
    status: 'Done',
    ago: 18 * DAY,
  },
  {
    key: 'DEV-220',
    project: ALTHAR,
    title: 'Task chats mention other tasks and skills',
    body: 'Lines about other tasks show in a task’s chat.',
    status: 'Done',
    ago: 10 * DAY,
  },
  {
    key: '#77',
    project: MERIDIAN,
    title: 'Refunds are slow to show for customers',
    body: 'A refund takes a day to show on the receipt.',
    status: 'In Review',
    task: 'show-refund-status-on-receipts',
    ago: 5 * DAY,
  },
  {
    key: '#81',
    project: MERIDIAN,
    title: 'Webhook retries hammer partners',
    body: 'Retries go out every second while a partner is down.',
    status: 'Todo',
    task: 'retry-webhooks-with-back-off',
    ago: 2 * DAY,
  },
]

/** Althar's notes: the decisions the person made that the code doesn't show. */
export const NOTES: ReadonlyArray<WorldNote> = [
  {
    id: 'n_container',
    body: 'A task becomes a loose container, a conversation with an agent plus attachable parts (workspace, review, outputs, access), changeable any time; a temporary chat is the lightest form, kept on a Scratch shelf off the board.',
    ago: 30 * DAY,
  },
  {
    id: 'n_prototypes',
    body: 'Prototypes use the real UI kit and real screens (no lookalikes, no Storybook), on one live local page with an in-view A/B/C switcher bar (keys too) to swap directions in place; the server stays running to click around.',
    ago: 29 * DAY,
  },
  {
    id: 'n_unrestricted',
    body: 'Allow-everything isn’t shown as an “Unrestricted” label on task headers or board cards; the person found it meaningless.',
    ago: 27 * DAY,
  },
  {
    id: 'n_usage',
    body: 'Plan usage may read Anthropic’s usage endpoint with Claude Code’s own sign-in token, as Orca does.',
    ago: 22 * DAY,
  },
  {
    id: 'n_narrate',
    body: 'UI copy never narrates what’s plainly happening on screen; keep only lines that tell the person something they need.',
    ago: 16 * DAY,
  },
  {
    id: 'n_issues',
    body: 'Leads don’t draft issues unless the person asks; what they find out of scope goes in their report.',
    ago: 15 * DAY,
  },
  {
    id: 'n_permissive',
    body: 'Althar is permissive by default: where an OS sandbox holds, anything inside it runs without the rules reading commands; only crossings that can’t be undone ask.',
    ago: 14 * DAY,
  },
  {
    id: 'n_links',
    body: 'The coordinator writes every web address it gives the person as a clickable link, never as plain text to copy.',
    ago: 13 * DAY,
  },
  {
    id: 'n_design_claude',
    body: 'Tasks with design or UI work are led by a Claude model, not GPT; GPT-6.1 Sol still reviews.',
    ago: 12 * DAY,
  },
  {
    id: 'n_setup',
    body: 'Nobody writes setup config. The first lead in a project works it out and records it; Althar replays it before later leads start.',
    ago: 12 * DAY,
  },
  {
    id: 'n_xhigh',
    body: 'Prototypes run on Claude Opus 5.5: medium effort only for simple ones; xhigh for anything with several screens or directions.',
    ago: 10 * DAY,
  },
  {
    id: 'n_rebase',
    body: 'Bring main in by merging it, never by rebasing: a branch with a pull request is pushed within seconds.',
    ago: 9 * DAY,
  },
  {
    id: 'n_allow',
    body: 'Allow everything is the default for every project, and the person’s own MCP servers load in every role.',
    ago: 6 * DAY,
  },
  {
    id: 'n_small',
    body: 'Small changes must be fast: a one-line fix took about 40 minutes, which the person called ridiculous. Cutting that overhead is a priority.',
    ago: 6 * DAY,
  },
  {
    id: 'n_always_on',
    body: 'The coordinator is always on: never a switch, setting or mode to turn it off, in any project.',
    ago: 5 * DAY,
  },
  {
    id: 'n_limits',
    body: 'No arbitrary security limits: any block beyond the irreversible list is a bug to remove, network allowlists included.',
    ago: 5 * DAY,
  },
  {
    id: 'n_deepseek',
    body: 'Never use DeepSeek, as lead or reviewer, unless every other model has run out. Reviews: GPT-6.1 Sol or Terra first.',
    ago: 3 * DAY,
  },
  {
    id: 'n_presets',
    body: 'Plan from a preset whenever one fits. Prototypes start from Prototype: no review, ending with their branch.',
    ago: DAY + 2 * H,
  },
  {
    id: 'n_instant',
    body: 'UI is instant: every action shows its result at once, optimistically, and the runtime catches up behind it, rolling back with a line on failure.',
    ago: 9 * H,
  },
  {
    id: 'n_asides',
    body: 'Asides are quick: they never install dependencies or run task setup; they read from the local checkout.',
    ago: 8 * H,
  },
  {
    id: 'm_budget',
    project: MERIDIAN,
    body: 'Refunds share the partner API’s rate budget; give them their own before raising limits.',
    ago: 2 * DAY,
  },
  { id: 'm_staging', project: MERIDIAN, body: 'Staging deploys go through make deploy-staging, and it always asks.', ago: 7 * DAY },
].map((note) => ({ project: ALTHAR, ...note }))

/** Each project's conversation with its coordinator, oldest first. */
export const CONVERSATIONS: Readonly<Record<string, ReadonlyArray<Said>>> = {
  [ALTHAR]: [
    { who: 'you', text: 'Should leads bring main in by rebasing? The history would read better.', ago: 9 * DAY + 20 },
    {
      who: 'coordinator',
      text: 'I’d keep merging. A branch with a pull request is pushed within seconds, and a rebase rewrites commits that are already up, so the pull request would no longer take them. I’ve kept it as a note: leads bring main in by merging it, never by rebasing.',
      ago: 9 * DAY + 18,
    },
    { who: 'you', text: 'Prototypes keep ending up in Storybook with lookalike components. I hate that.', ago: 29 * DAY + 10 },
    {
      who: 'coordinator',
      text: 'Kept as a note: prototypes use the real UI kit and real screens, on one live local page with an A/B/C switcher, never Storybook. I’ll put it in every prototype’s brief.',
      ago: 29 * DAY + 8,
    },
    { who: 'you', text: 'A one-line fix took 40 minutes. That’s ridiculous.', ago: 6 * DAY },
    {
      who: 'coordinator',
      text: 'It was: 9 minutes of install, 6 waiting for the reviewer’s model, and the end-to-end run on a draft. I’ve started Make small changes fast on GPT-6.1 Sol to cut the setup first.',
      ago: 6 * DAY - 2,
    },
    { who: 'you', text: 'Which model should review design work?', ago: 3 * DAY },
    {
      who: 'coordinator',
      text: 'GPT-6.1 Sol reviews, at medium for large or risky changes; the lead stays a Claude model for anything with design in it. DeepSeek never, unless everything else is out.',
      ago: 3 * DAY - 1,
    },
    { who: 'you', text: 'What’s waiting on me?', ago: 70 },
    {
      who: 'coordinator',
      text: 'Two things. Let leads listen on localhost wants to run bunx vp dev on port 5330, and Cap parallel agents per machine is ready with its checks green (#845). Copy button on code blocks is ready too.',
      ago: 69,
    },
    { who: 'you', text: 'Help me design a search functionality. What searches work really well? Raycast, Linear etc. Prototype.', ago: 35 },
    {
      who: 'coordinator',
      text: 'Started Prototype: search across Althar on Claude Opus 5.5 at xhigh, from the Prototype preset: it ends on its branch, with no review.',
      ago: 34,
    },
  ],
  [MERIDIAN]: [
    { who: 'you', text: 'Refunds are still slow to show up for customers. What’s left before we can stage them?', ago: 50 },
    {
      who: 'coordinator',
      text: 'Two things. Stage the refunds API is waiting on you to allow make deploy-staging, and Show refund status on receipts is ready with its checks green (#412). I’d also back off webhook retries before the partners hit it; I’ve planned that.',
      ago: 48,
    },
    { who: 'you', text: 'And the flaky checkout test, is someone on it?', ago: 10 },
    {
      who: 'coordinator',
      text: 'Yes, Fix the flaky checkout test started nine minutes ago. It looks like a clock in the fixture, not the checkout itself.',
      ago: 9,
    },
  ],
  [ERZA]: [
    { who: 'you', text: 'I want onboarding emails for the first two weeks.', ago: 20 },
    { who: 'coordinator', text: 'Started Draft the onboarding emails: five short ones, from day 1 to day 14.', ago: 19 },
  ],
}

/** The repository's own files, as git lists them. */
export const FILE_PATHS: ReadonlyArray<string> = FILES

/** Which tasks changed each file. */
export const TOUCHED: ReadonlyMap<string, ReadonlyArray<string>> = (() => {
  const by = new Map<string, Array<string>>()
  for (const task of TASKS) for (const file of task.files ?? []) by.set(file, [...(by.get(file) ?? []), task.slug])
  return by
})()

export const projectOf = (id: string): WorldProject => PROJECTS.find((one) => one.id === id) ?? (PROJECTS[0] as WorldProject)
export const taskOf = (slug: string): WorldTask | undefined => TASKS.find((one) => one.slug === slug)
