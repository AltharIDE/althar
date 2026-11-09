// Scrappy: phase 5's situations as plain facts (the ADR's model, small): each direction draws them its own way.

export type Checks = 'running' | 'passed' | 'failed' | 'none'

/** One line of work: a branch, what it works toward, its pull request (ADR § What a change is). */
export interface Change {
  readonly id: string
  readonly branch: string
  /** Its pull request, where it has one. */
  readonly pr?: number
  readonly state?: 'draft' | 'open' | 'merged' | 'closed'
  readonly title: string
  /** Its name in a few words, once the task has two: whoever starts it names it, as a task is named. */
  readonly short?: string
  readonly checks?: Checks
  readonly failing?: ReadonlyArray<string>
  /** Commits not shipped: the branch is held for Ship. */
  readonly waiting?: number
  /** Held by the change below it in a stack, whose waiting commits its branch carries. */
  readonly heldBy?: string
  /** Stacked on another of the task's changes: it branches from that one and targets it. */
  readonly on?: string
  /**
   * Goes up after another of the task's changes merges, as the person asked ("fix main first"): it doesn't build on that one's code,
   * so it isn't stacked. What that one fixes doesn't ask for the person here, and once it merges, main comes in.
   */
  readonly after?: string
  /** The issues its pull request closes. */
  readonly closes?: ReadonlyArray<string>
  /** The branch it works toward, where it isn't main. */
  readonly toward?: string
  /** Where it is checked out now. */
  readonly place?: 'worktree' | 'local' | 'none'
  /** A helper at work on it, in its worktree. */
  readonly helper?: string
  readonly conflict?: boolean
  /** Ship under way: where it has got to. */
  readonly shipping?: 'conflict' | 'review' | 'fixing' | 'pushing'
  /** What people asked on its pull request, committed beside the person's, waiting for Ship. */
  readonly replies?: number
  /** Ready to merge as it stands. */
  readonly ready?: boolean
  /** An after-merge review of it found these. */
  readonly found?: number
  /** How it got here, where it wasn't Althar's own way. */
  readonly came?: 'git' | 'outside'
  /** The pull request this branch was made to take the place of: Ship asks about it once the new one is up. */
  readonly replaces?: number
  readonly add?: number
  readonly del?: number
}

export type Who = 'you' | 'lead' | 'coordinator' | 'althar'

/** Where a turn's time went (ADR § Where a turn's time goes), in seconds. */
export interface Timing {
  readonly wait?: number
  readonly start?: number
  readonly work: number
  readonly tools?: number
  readonly review?: number
  readonly checks?: number
}

/** What asks for the person: one at a time. */
export type Ask =
  | { readonly kind: 'run-it'; readonly pr: number; readonly by: string }
  | { readonly kind: 'switch'; readonly change: string; readonly own: string }
  | { readonly kind: 'settle-unshipped'; readonly change: string }
  | { readonly kind: 'merge-unshipped'; readonly change: string }
  | { readonly kind: 'remove-draft'; readonly pr: number; readonly findings: number }
  | { readonly kind: 'after-merge'; readonly pr: number; readonly findings: ReadonlyArray<string> }
  | { readonly kind: 'close-old'; readonly old: number; readonly now: number }
  | { readonly kind: 'usage'; readonly agent: string; readonly until: string }
  | { readonly kind: 'stuck'; readonly what: string; readonly why: string }
  | { readonly kind: 'refused'; readonly change: string; readonly why: string }
  | { readonly kind: 'attach'; readonly pr: number; readonly base: string; readonly change: string }
  | { readonly kind: 'preset-offer'; readonly name: string; readonly holds: string }
  | { readonly kind: 'ship-stack'; readonly change: string }

/** A beat of the thread, as plain facts; each direction draws them its way. */
/** A line that marks a step in the work, stamped so it stands out of the thread: up for review, merged, a new change. */
export type Stamp = 'shipped' | 'merged' | 'change'

export type Beat =
  | { readonly kind: 'you'; readonly text: string }
  | {
      readonly kind: 'lead'
      readonly text: string
      readonly tools?: ReadonlyArray<string>
      readonly took: Timing
      /** Its commits, and the change they went to. */
      readonly commits?: { readonly n: number; readonly change: string }
      /** A part it changed on the way, in its own words: the thread's line for it. */
      readonly part?: { readonly text: string; readonly change?: string; readonly stamp?: Stamp }
      readonly who?: string
    }
  /** A part changed, by someone other than the lead mid-turn: one line. */
  | {
      readonly kind: 'part'
      readonly who: Who
      readonly text: string
      readonly change?: string
      readonly act?: string
      readonly stamp?: Stamp
    }
  /** Althar, saying what the person should know. */
  | {
      readonly kind: 'line'
      readonly text: string
      readonly change?: string
      readonly tone?: 'warning'
      readonly act?: string
      readonly stamp?: Stamp
    }
  /** A review, as the thread's one line for it. */
  | {
      readonly kind: 'review'
      readonly findings: number
      readonly fixed?: string
      readonly change?: string
      readonly after?: boolean
      readonly checked?: string
    }
  /** Something under way at the thread's end, changing in place. */
  | { readonly kind: 'live'; readonly text: string; readonly change?: string; readonly act?: string; readonly made?: true }
  | { readonly kind: 'ask'; readonly ask: Ask }

export type Preset = 'Change' | 'Small change' | 'Chat' | 'Review a PR' | 'Prototype'

export type Group =
  | 'Several changes'
  | 'Your two flows'
  | 'Found, not made here'
  | 'Where it works'
  | 'Waiting for Ship'
  | 'Parts'
  | 'Reviews'
  | 'Chats and presets'
  | 'Time and failures'

export interface Case {
  readonly key: string
  readonly group: Group
  readonly label: string
  /** Where the board has it. */
  readonly lane: 'running' | 'you' | 'settled' | 'scratch'
  /** Where it stands, in a word, as today's card and chip say. */
  readonly word: string
  readonly status: 'running' | 'yours' | 'paused' | 'queued' | 'stopped' | 'done'
  readonly title: string
  readonly kind: 'change' | 'review' | 'plain'
  readonly preset: Preset
  readonly changes: ReadonlyArray<Change>
  /** A copy: a chat's of main, or a review's at a pull request's head. */
  readonly copy?: { readonly at: string; readonly pr?: number }
  /** Outside author's code: how far it is trusted. */
  readonly access?: 'read' | 'safe' | 'full'
  readonly reviewer?: { readonly who: string; readonly when: 'before' | 'after' } | null
  readonly reviewing?: {
    readonly pr: number
    readonly title: string
    readonly by: string
    readonly draft?: number
    readonly outside?: boolean
    readonly copy?: boolean
  }
  readonly moving?: { readonly change: string; readonly to: 'local' | 'worktree'; readonly waitsOn?: string; readonly off?: boolean }
  /** The change the conversation is on, where the person turned it there: what they say next, and “Ship it”, go to it. */
  readonly working?: string
  /** Gone from its parts, and what it left. */
  readonly left?: ReadonlyArray<{ readonly what: string; readonly stays: string }>
  readonly issue?: string
  /** The issues it was started from or took in; today's one where it isn't said. */
  readonly issues?: ReadonlyArray<{ readonly key: string; readonly title: string }>
  /** Checks pass a beat after a push, so a flow can be clicked through to its end. */
  readonly passes?: true
  readonly shots?: number
  /** It has gone quiet for a reason the person should know: out of usage, no place. */
  readonly still?: { readonly why: string; readonly act?: string }
  readonly thread: ReadonlyArray<Beat>
  /** The ADR's wording this case leans on, for the strip's note. */
  readonly adr: string
}

/* ——— The task's changes, as the cases share them ——— */

const STILL: Change = {
  id: 'still',
  branch: 'althar/board-still',
  pr: 714,
  state: 'open',
  title: 'Hold the board still as cards change lanes',
  checks: 'passed',
  place: 'worktree',
  add: 84,
  del: 31,
}
const LATER: Change = {
  id: 'later',
  branch: 'althar/rename-later',
  pr: 715,
  state: 'open',
  title: 'Rename “Keep for later” to “Later”',
  checks: 'passed',
  place: 'worktree',
  add: 12,
  del: 12,
}
const MOTION: Change = {
  id: 'motion',
  branch: 'althar/board-motion',
  pr: 716,
  state: 'open',
  title: 'Slide a card between lanes',
  checks: 'passed',
  on: 'still',
  place: 'worktree',
  add: 46,
  del: 8,
}
const ch = (base: Change, over: Partial<Change> = {}): Change => ({ ...base, ...over })

const TITLE = 'Hold the board still while agents work'
const SOL = { who: 'GPT-6.1 Sol', when: 'before' as const }
const ASK = 'The board jumps when a card changes lanes. Fix it, and while you’re there, rename “Keep for later” to “Later”.'

const opening: ReadonlyArray<Beat> = [
  { kind: 'you', text: ASK },
  {
    kind: 'lead',
    text: 'The lanes reflow when a card leaves: each lane measures itself again. I hold each lane’s height until the move ends. The rename is unrelated, so it goes up on its own.',
    tools: ['Read packages/ui/src/board/Board/Board.tsx', 'Edit packages/ui/src/board/Board/Board.tsx', 'Ran bun run test board'],
    took: { work: 214, tools: 61 },
    commits: { n: 3, change: 'still' },
  },
]

/* ——— Your two flows' changes ——— */

const RELEASE_TITLE = 'Cut 0.9.0'
const RELEASE: Change = {
  id: 'release',
  branch: 'release-0.9.0',
  pr: 710,
  state: 'open',
  title: 'Release 0.9.0: raise the version and write its notes',
  short: 'Release 0.9.0',
  checks: 'failed',
  failing: ['e2e (board.spec.ts)'],
  after: 'fixmain',
  place: 'worktree',
  add: 96,
  del: 4,
}
const FIX_MAIN: Change = {
  id: 'fixmain',
  branch: 'althar/fix-main',
  title: 'Fix the board’s e2e on main',
  short: 'Fix main',
  waiting: 1,
  place: 'worktree',
  add: 3,
  del: 3,
}
const releaseOpening: ReadonlyArray<Beat> = [
  { kind: 'you', text: 'Cut 0.9.0: a release branch, the version raised, and the notes from what merged since 0.8.0.' },
  {
    kind: 'lead',
    text: 'release-0.9.0 is up as #710: version 0.9.0, and notes for the 14 pull requests since 0.8.0, in four groups.',
    tools: ['Ran git log v0.8.0..main', 'Edit package.json', 'Write docs/releases/0.9.0.md'],
    took: { work: 188, tools: 42 },
    commits: { n: 2, change: 'release' },
  },
  { kind: 'you', text: 'Main is red, the board’s e2e. Fix main first, then carry on with the release.' },
  {
    kind: 'lead',
    text: 'board.spec.ts fails on main since #709: it waits for a lane still called “Keep for later”. The fix goes into main on its own, so it lands before the release. #710 waits for it, then takes main in.',
    tools: ['Ran gh run view --log-failed', 'Edit apps/desktop/e2e/board.spec.ts'],
    took: { work: 74, tools: 31 },
    commits: { n: 1, change: 'fixmain' },
    part: { text: 'Fix main, on althar/fix-main toward main. It goes in before Release 0.9.0.', change: 'fixmain', stamp: 'change' },
  },
]

const PAGES_TITLE = 'Privacy page'
const PAGES_ISSUES = [
  { key: 'DEV-140', title: 'A privacy page on the landing site' },
  { key: 'DEV-141', title: 'A terms page on the landing site' },
]
const PRIVACY: Change = {
  id: 'privacy',
  branch: 'althar/privacy-page',
  title: 'A privacy page on the landing site',
  short: 'Privacy page',
  waiting: 2,
  place: 'worktree',
  closes: ['DEV-140'],
  add: 132,
  del: 2,
}
const TERMS: Change = {
  id: 'terms',
  branch: 'althar/terms-page',
  title: 'A terms page on the landing site',
  short: 'Terms page',
  waiting: 2,
  place: 'worktree',
  closes: ['DEV-141'],
  add: 118,
  del: 1,
}
const pagesOpening: ReadonlyArray<Beat> = [
  { kind: 'you', text: 'Do DEV-140: a privacy page on the landing site.' },
  {
    kind: 'lead',
    text: 'The privacy page is at /privacy, linked from the footer, in the site’s own type.',
    tools: ['Write site/src/pages/privacy.astro', 'Edit site/src/components/Footer.astro'],
    took: { work: 142, tools: 28 },
    commits: { n: 2, change: 'privacy' },
  },
  { kind: 'you', text: 'Pull in DEV-141 too, the terms page. It’s on the landing site as well.' },
]

export const CASES: ReadonlyArray<Case> = [
  /* ——— Several changes ——— */
  {
    key: 'one',
    group: 'Several changes',
    label: 'One change, as today',
    lane: 'you',
    word: 'Ready',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { ready: true })],
    reviewer: SOL,
    thread: [
      ...opening.slice(0, 1),
      {
        ...(opening[1] as Extract<Beat, { kind: 'lead' }>),
        text: 'Each lane holds its height until the move ends. #714 is up, reviewed, checks pass.',
      },
      { kind: 'review', findings: 1, fixed: '1 fixed' },
    ],
    adr: 'A task that never splits has one change, as now.',
  },
  {
    key: 'siblings',
    group: 'Several changes',
    label: 'Siblings, waiting for checks',
    lane: 'running',
    word: 'Checks',
    status: 'running',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { checks: 'running' }), ch(LATER, { checks: 'running' })],
    reviewer: SOL,
    thread: [
      ...opening,
      {
        kind: 'part',
        who: 'lead',
        text: 'Rename, on althar/rename-later toward main, to keep it apart.',
        change: 'later',
        stamp: 'change',
        act: 'Keep them together',
      },
      { kind: 'review', findings: 0, change: 'still' },
      { kind: 'review', findings: 0, change: 'later' },
      { kind: 'line', text: 'Lane heights as #714 and Rename as #715, both drafts.', stamp: 'shipped' },
    ],
    adr: 'Where none needs them, it says what the changes wait on: “Waiting for checks on #714, #715”.',
  },
  {
    key: 'needs-one',
    group: 'Several changes',
    label: 'One needs you, two more',
    lane: 'you',
    word: 'Checks failed',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [
      ch(STILL, { checks: 'failed', failing: ['e2e (board.spec.ts)'] }),
      ch(LATER, { ready: true }),
      ch(MOTION, { pr: undefined, state: undefined, checks: undefined, waiting: 2, on: undefined }),
    ],
    reviewer: SOL,
    thread: [
      ...opening,
      {
        kind: 'line',
        text: 'e2e (board.spec.ts) still fails on Lane heights after the lead’s fix: it times out only on CI. Over to you.',
        change: 'still',
        tone: 'warning',
      },
    ],
    adr: 'It names the pull request that most needs the person, with its state, and says how many more there are: “#714 checks failing · 2 more”.',
  },
  {
    key: 'stack',
    group: 'Several changes',
    label: 'A stack, ready to merge',
    lane: 'you',
    word: 'Ready',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { ready: true }), ch(MOTION, { ready: true })],
    reviewer: SOL,
    thread: [
      ...opening,
      { kind: 'you', text: 'Now make a card slide to its new lane, but keep it apart so I can merge the fix first.' },
      {
        kind: 'lead',
        text: 'The slide needs the held heights, so it builds on Lane heights, and goes into main once that merges.',
        took: { work: 162, tools: 40 },
        commits: { n: 2, change: 'motion' },
        part: { text: 'Started Card slide on top of Lane heights, as it needs its code.', change: 'motion' },
      },
      { kind: 'review', findings: 0, change: 'motion' },
    ],
    adr: 'Merge on a stacked change offers the whole stack, from the bottom up: “Merge #714, then #715”.',
  },
  {
    key: 'stack-held',
    group: 'Several changes',
    label: 'A hold reaching up a stack',
    lane: 'you',
    word: 'Not shipped',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { waiting: 2 }), ch(MOTION, { heldBy: 'still', checks: 'passed' })],
    reviewer: SOL,
    thread: [
      ...opening,
      { kind: 'you', text: 'The held height is a frame late on a slow card. Tighten it.' },
      {
        kind: 'lead',
        text: 'It now holds from the moment the card lifts, not when it lands. Try it on the running board.',
        took: { work: 96, tools: 22 },
        commits: { n: 2, change: 'still' },
      },
      { kind: 'ask', ask: { kind: 'ship-stack', change: 'motion' } },
    ],
    adr: 'Ship on a stacked change ships what waits beneath it first: “Ship #715, and the 2 commits waiting on #714 below it”. Its row says what holds it: “Held: 2 commits waiting on #714 below”.',
  },
  {
    key: 'merged-one',
    group: 'Several changes',
    label: 'One merged, the rest carry on',
    lane: 'running',
    word: 'Working',
    status: 'running',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [
      ch(STILL, { state: 'merged', place: 'none', checks: undefined }),
      ch(LATER, { checks: 'passed' }),
      ch(MOTION, { on: undefined, toward: undefined, pr: undefined, state: undefined, checks: undefined, helper: 'Sonnet 5.5' }),
    ],
    reviewer: SOL,
    thread: [
      ...opening,
      {
        kind: 'line',
        text: 'Lane heights (#714). Rename and Card slide carry on.',
        change: 'still',
        stamp: 'merged',
      },
      { kind: 'you', text: 'Good. Start the slide now, on main.' },
      {
        kind: 'lead',
        text: 'A helper is making the slide in its own worktree. Ask me anything meanwhile.',
        took: { wait: 0, start: 4, work: 18 },
        part: { text: 'Handed Card slide to a helper, Sonnet 5.5.', change: 'motion' },
      },
    ],
    adr: 'A merge ends only its own change, never the task, its session or what runs.',
  },
  {
    key: 'helper',
    group: 'Several changes',
    label: 'A helper on one, you on another',
    lane: 'running',
    word: 'Working',
    status: 'running',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { waiting: 1 }), ch(MOTION, { helper: 'Sonnet 5.5', checks: 'none', state: 'draft' })],
    reviewer: SOL,
    thread: [
      ...opening,
      { kind: 'part', who: 'lead', text: 'Handed Card slide to a helper, Sonnet 5.5.', change: 'motion' },
      { kind: 'you', text: 'While that runs: does the held height survive a window resize?' },
      {
        kind: 'lead',
        text: 'It didn’t: a resize mid-move kept the old height. Fixed in Lane heights, one commit. Not shipped yet.',
        took: { work: 71, tools: 19 },
        commits: { n: 1, change: 'still' },
      },
    ],
    adr: 'The change’s row in the header says a helper is on it, with Stop.',
  },
  {
    key: 'split',
    group: 'Several changes',
    label: 'A second change starts',
    lane: 'running',
    word: 'Working',
    status: 'running',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [
      ch(STILL, { pr: undefined, state: undefined, checks: undefined, waiting: 3 }),
      ch(LATER, { pr: undefined, state: undefined, checks: undefined }),
    ],
    reviewer: SOL,
    thread: [
      opening[0]!,
      {
        kind: 'lead',
        text: 'The lanes reflow when a card leaves. Holding each lane’s height until the move ends. The rename is unrelated, so it goes up on its own.',
        tools: ['Read packages/ui/src/board/Board/Board.tsx', 'Edit packages/ui/src/board/Board/Board.tsx'],
        took: { work: 120, tools: 30 },
        commits: { n: 3, change: 'still' },
      },
      {
        kind: 'part',
        who: 'lead',
        text: 'Rename, on althar/rename-later toward main, to keep it apart.',
        change: 'later',
        stamp: 'change',
        act: 'Keep them together',
      },
    ],
    adr: 'The thread’s line lets the person say “keep them together”, which joins two changes again before either ships.',
  },

  /* ——— Your two flows: one conversation, two things to do, as the person works ——— */
  {
    key: 'release-red',
    group: 'Your two flows',
    label: 'A release, and main is red: fix main first',
    lane: 'you',
    word: 'Not shipped',
    status: 'yours',
    title: RELEASE_TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [RELEASE, FIX_MAIN],
    reviewer: SOL,
    issues: [],
    passes: true,
    thread: releaseOpening,
    adr: 'Proposed: a change can go first. The one waiting for it isn’t stacked on it; once it merges, main comes in.',
  },
  {
    key: 'release-fix-ready',
    group: 'Your two flows',
    label: 'Fix main ready, the release waiting for it',
    lane: 'you',
    word: 'Ready',
    status: 'yours',
    title: RELEASE_TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [RELEASE, ch(FIX_MAIN, { waiting: undefined, pr: 719, state: 'open', checks: 'passed', ready: true })],
    reviewer: SOL,
    issues: [],
    passes: true,
    thread: [
      ...releaseOpening,
      { kind: 'review', findings: 0, change: 'fixmain' },
      { kind: 'line', text: 'Fix main as #719, into main, with 1 commit.', change: 'fixmain', stamp: 'shipped' },
    ],
    adr: 'Proposed: what the change going first fixes doesn’t ask for the person on the one waiting for it.',
  },
  {
    key: 'release-on',
    group: 'Your two flows',
    label: 'Main fixed, the release carries on',
    lane: 'running',
    word: 'Checks',
    status: 'running',
    title: RELEASE_TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [
      ch(RELEASE, { after: undefined, checks: 'running', failing: undefined }),
      ch(FIX_MAIN, { waiting: undefined, pr: 719, state: 'merged', place: 'none', checks: undefined }),
    ],
    reviewer: SOL,
    issues: [],
    passes: true,
    thread: [
      ...releaseOpening,
      { kind: 'review', findings: 0, change: 'fixmain' },
      { kind: 'line', text: 'Fix main as #719, into main, with 1 commit.', change: 'fixmain', stamp: 'shipped' },
      { kind: 'line', text: 'Fix main (#719). Release 0.9.0 took main in.', change: 'release', stamp: 'merged' },
    ],
    adr: 'A merge ends only its own change, never the task, its session or what runs.',
  },
  {
    key: 'tickets-split',
    group: 'Your two flows',
    label: 'Two tickets, put on two branches',
    lane: 'you',
    word: 'Not shipped',
    status: 'yours',
    title: PAGES_TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [PRIVACY, TERMS],
    reviewer: SOL,
    issues: PAGES_ISSUES,
    thread: [
      ...pagesOpening,
      {
        kind: 'lead',
        text: 'The terms page is at /terms, beside the privacy page in the footer.',
        tools: ['Write site/src/pages/terms.astro', 'Edit site/src/components/Footer.astro'],
        took: { work: 96, tools: 20 },
        commits: { n: 2, change: 'terms' },
      },
      {
        kind: 'part',
        who: 'lead',
        text: 'Terms page, on althar/terms-page toward main, as DEV-141 is a page of its own.',
        change: 'terms',
        stamp: 'change',
        act: 'Keep them together',
      },
    ],
    adr: 'The lead splits where the parts should be reviewed or merged apart. Proposed: only where something forces it, or you ask.',
  },
  {
    key: 'tickets-one',
    group: 'Your two flows',
    label: 'Two tickets, kept on one branch',
    lane: 'you',
    word: 'Not shipped',
    status: 'yours',
    title: PAGES_TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(PRIVACY, { waiting: 4, closes: ['DEV-140', 'DEV-141'], short: undefined })],
    reviewer: SOL,
    issues: PAGES_ISSUES,
    thread: [
      ...pagesOpening,
      {
        kind: 'lead',
        text: 'The terms page is at /terms, beside the privacy page in the footer. It’s on the same branch: one pull request closes DEV-140 and DEV-141.',
        tools: ['Write site/src/pages/terms.astro', 'Edit site/src/components/Footer.astro'],
        took: { work: 96, tools: 20 },
        commits: { n: 2, change: 'privacy' },
      },
    ],
    adr: 'Proposed: a task stays one change until something forces a second: another target or repository, one that goes first, or you ask.',
  },

  /* ——— Found, not made here ——— */
  {
    key: 'adopted',
    group: 'Found, not made here',
    label: 'A branch the lead made with git',
    lane: 'running',
    word: 'Working',
    status: 'running',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [
      ch(STILL, { place: 'none' }),
      {
        id: 'virtual',
        branch: 'althar/try-virtual-lanes',
        title: 'Virtual lanes, to try',
        place: 'worktree',
        came: 'git',
        add: 140,
        del: 22,
      },
    ],
    reviewer: SOL,
    thread: [
      ...opening,
      { kind: 'you', text: 'Would virtualizing the lanes fix it too?' },
      {
        kind: 'lead',
        text: 'Trying it on a branch of its own: `git switch -c althar/try-virtual-lanes`. Early: it fixes the jump, but drops focus when a card scrolls out.',
        took: { work: 188, tools: 70 },
        commits: { n: 1, change: 'virtual' },
      },
      {
        kind: 'part',
        who: 'althar',
        text: 'Virtual lanes, the lead’s althar/try-virtual-lanes, is a change of this task now, toward main. Lane heights keeps #714, with no folder until it’s worked on again.',
        change: 'virtual',
        act: 'Drop it',
      },
    ],
    adr: 'A folder now on another branch makes that branch a change of the task’s, with a line in the thread.',
  },
  {
    key: 'outside-pr',
    group: 'Found, not made here',
    label: 'A pull request opened elsewhere',
    lane: 'running',
    word: 'Checks',
    status: 'running',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL), ch(LATER, { pr: 717, came: 'outside', checks: 'running', state: 'open' })],
    reviewer: SOL,
    thread: [
      ...opening,
      {
        kind: 'part',
        who: 'althar',
        text: 'Found #717, from althar/rename-later into main, opened on GitHub. It’s Rename’s now.',
        change: 'later',
      },
    ],
    adr: 'An open one whose head is the change’s own branch, and whose base is the branch it works toward, is that change’s.',
  },
  {
    key: 'unmatched',
    group: 'Found, not made here',
    label: 'One it won’t guess',
    lane: 'running',
    word: 'Working',
    status: 'running',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL)],
    reviewer: SOL,
    thread: [...opening, { kind: 'ask', ask: { kind: 'attach', pr: 718, base: 'release/0.8.0', change: 'still' } }],
    adr: 'Where that doesn’t give one pull request, Althar takes none and names what it found in a line.',
  },

  /* ——— Where it works ——— */
  {
    key: 'chat-grows',
    group: 'Where it works',
    label: 'A chat takes a worktree',
    lane: 'running',
    word: 'Working',
    status: 'running',
    title: 'Why does the board jump?',
    kind: 'change',
    preset: 'Chat',
    changes: [{ id: 'jump', branch: 'althar/why-does-the-board-jump', title: 'Why does the board jump?', place: 'worktree', waiting: 1 }],
    reviewer: null,
    thread: [
      { kind: 'you', text: 'Why does the board jump when a card moves?' },
      {
        kind: 'lead',
        text: 'Each lane measures itself again when a card leaves it, so the lanes under it move up a frame before the card lands.',
        took: { work: 41, tools: 12 },
      },
      { kind: 'you', text: 'Can you fix it?' },
      {
        kind: 'lead',
        text: 'Fixed: each lane holds its height until the move ends. One commit, not shipped. Try it with the board running.',
        took: { work: 132, tools: 38 },
        commits: { n: 1, change: 'jump' },
        part: { text: 'Took a worktree, to write the fix.', change: 'jump' },
      },
      { kind: 'line', text: 'On the board now, as it has a branch of its own.' },
    ],
    adr: 'It moves to the board as soon as it takes a worktree or an output, and says so in its thread.',
  },
  {
    key: 'to-local',
    group: 'Where it works',
    label: 'Into your checkout',
    lane: 'you',
    word: 'Needs you',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { waiting: 1 })],
    reviewer: SOL,
    moving: { change: 'still', to: 'local' },
    thread: [
      ...opening,
      { kind: 'you', text: 'Move it to my checkout, I want to try it in my editor.' },
      { kind: 'ask', ask: { kind: 'switch', change: 'still', own: 'balazs/notes' } },
    ],
    adr: 'On a branch of the person’s own, it asks first: switch to the task’s branch, or stay in the worktree.',
  },
  {
    key: 'local-waits',
    group: 'Where it works',
    label: 'Out of Local, waiting on your edits',
    lane: 'running',
    word: 'Working',
    status: 'running',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { place: 'local', waiting: 1 })],
    reviewer: SOL,
    moving: { change: 'still', to: 'worktree', waitsOn: 'Board.tsx' },
    thread: [
      ...opening,
      { kind: 'part', who: 'you', text: 'You moved althar/board-still to a worktree.', change: 'still' },
      { kind: 'live', text: 'Moves to a worktree once Board.tsx is committed.', change: 'still', act: 'Call it off' },
    ],
    adr: 'The workspace part names what holds it, “Moves to a worktree once Board.tsx is committed”. The person can call the move off.',
  },
  {
    key: 'move-off',
    group: 'Where it works',
    label: 'The move called off',
    lane: 'running',
    word: 'Working',
    status: 'running',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { place: 'local', waiting: 1 })],
    reviewer: SOL,
    thread: [
      ...opening,
      { kind: 'part', who: 'you', text: 'You moved althar/board-still to a worktree.', change: 'still' },
      { kind: 'part', who: 'you', text: 'You called off the move. It stays in your checkout.', change: 'still' },
    ],
    adr: 'Althar tries again as each turn ends, and the person can call the move off.',
  },
  {
    key: 'run-it',
    group: 'Where it works',
    label: '“Run it” on outside code',
    lane: 'you',
    word: 'Review drafted',
    status: 'yours',
    title: 'Review #702: Page the thread faster',
    kind: 'review',
    preset: 'Review a PR',
    changes: [],
    copy: { at: '#702', pr: 702 },
    access: 'read',
    reviewing: { pr: 702, title: 'Page the thread faster', by: 'dmitri-k', draft: 3, outside: true },
    thread: [
      { kind: 'you', text: 'Review #702.' },
      {
        kind: 'lead',
        text: 'Read it through: three things to raise, one blocking. Drafted, not posted. I couldn’t run its tests: the code is from outside the team.',
        took: { work: 248, tools: 90 },
      },
      { kind: 'you', text: 'Run its tests.' },
      { kind: 'ask', ask: { kind: 'run-it', pr: 702, by: 'dmitri-k' } },
    ],
    adr: '“Run it” asks how far to trust the code: Run safely, the default, or Trust fully.',
  },
  {
    key: 'runs-safely',
    group: 'Where it works',
    label: 'Running safely, two didn’t install',
    lane: 'you',
    word: 'Review drafted',
    status: 'yours',
    title: 'Review #702: Page the thread faster',
    kind: 'review',
    preset: 'Review a PR',
    changes: [],
    copy: { at: '#702', pr: 702 },
    access: 'safe',
    reviewing: { pr: 702, title: 'Page the thread faster', by: 'dmitri-k', draft: 3, outside: true },
    thread: [
      { kind: 'you', text: 'Run its tests.' },
      { kind: 'part', who: 'you', text: 'You ran #702 safely: offline, install scripts off.' },
      {
        kind: 'line',
        text: 'electron and playwright didn’t install: they need their install scripts.',
        tone: 'warning',
        act: 'Trust fully',
      },
      {
        kind: 'lead',
        text: 'The unit tests pass: 212 of 212. The end-to-end tests need Electron, which didn’t install.',
        took: { start: 6, work: 104, tools: 88 },
      },
    ],
    adr: 'The thread says what didn’t install, and Trust fully is one press away.',
  },
  {
    key: 'trusted',
    group: 'Where it works',
    label: 'Trusted fully',
    lane: 'you',
    word: 'Review drafted',
    status: 'yours',
    title: 'Review #702: Page the thread faster',
    kind: 'review',
    preset: 'Review a PR',
    changes: [],
    copy: { at: '#702', pr: 702 },
    access: 'full',
    reviewing: { pr: 702, title: 'Page the thread faster', by: 'dmitri-k', draft: 3, outside: true },
    thread: [
      { kind: 'you', text: 'Run its tests.' },
      { kind: 'part', who: 'you', text: 'You ran #702 safely: offline, install scripts off.' },
      { kind: 'line', text: 'electron and playwright didn’t install: they need their install scripts.', tone: 'warning' },
      { kind: 'part', who: 'you', text: 'You trusted #702 fully: install scripts and the network.' },
      { kind: 'line', text: 'Installed electron and playwright, install scripts on. The end-to-end tests ran: 38 of 38 pass.' },
    ],
    adr: 'Trust fully runs as the team’s code does. Access says “Trusted”, and Stop running it is one press away.',
  },

  /* ——— Waiting for Ship ——— */
  {
    key: 'held',
    group: 'Waiting for Ship',
    label: 'Commits not shipped',
    lane: 'you',
    word: 'Not shipped',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { waiting: 3 })],
    reviewer: SOL,
    thread: [
      ...opening,
      { kind: 'you', text: 'Hold it from the moment the card lifts, not when it lands.' },
      {
        kind: 'lead',
        text: 'Done: it holds from the lift. Try it on the running board.',
        took: { work: 64, tools: 15 },
        commits: { n: 1, change: 'still' },
      },
      { kind: 'you', text: 'And keep the lane’s count from flickering.' },
      {
        kind: 'lead',
        text: 'The count now waits for the move too. 3 commits since #714 went up, not shipped.',
        took: { work: 52, tools: 11 },
        commits: { n: 2, change: 'still' },
      },
    ],
    adr: 'The header and the card say how much is waiting, “3 commits not shipped”, with Ship.',
  },
  {
    key: 'held-beside',
    group: 'Waiting for Ship',
    label: 'Fixes and replies waiting beside',
    lane: 'you',
    word: 'Not shipped',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { waiting: 3, replies: 1, checks: 'failed', failing: ['lint'] })],
    reviewer: SOL,
    thread: [
      ...opening,
      { kind: 'you', text: 'Hold it from the moment the card lifts.' },
      { kind: 'lead', text: 'Done. Not shipped.', took: { work: 64, tools: 15 }, commits: { n: 2, change: 'still' } },
      { kind: 'line', text: 'lint fails on #714’s pushed head. Ship replaces it.', change: 'still' },
      { kind: 'line', text: 'noor-a on #714: “Name the magic 180ms.”', change: 'still' },
      {
        kind: 'lead',
        text: 'Named it `LANE_HOLD_MS` and replied on #714 that it goes up with the next Ship.',
        took: { work: 38, tools: 9 },
        commits: { n: 1, change: 'still' },
        who: 'reply',
      },
    ],
    adr: 'Failing checks start no round; the card shows them beside Ship. A change a comment asks for is committed beside the person’s and waits for Ship.',
  },
  {
    key: 'shipping',
    group: 'Waiting for Ship',
    label: 'Ship under way',
    lane: 'running',
    word: 'Shipping',
    status: 'running',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { waiting: 3, shipping: 'review' })],
    reviewer: SOL,
    thread: [
      ...opening,
      { kind: 'you', text: 'Ship it.' },
      { kind: 'line', text: 'main changed Board.module.css too. Brought main in first; the lead settled the conflict.', change: 'still' },
      { kind: 'live', text: 'Reviewing the 3 commits since #714’s last review.', change: 'still' },
    ],
    adr: 'A conflict with the target is resolved as Ship begins. Shipping runs Checked by first: one review of everything since the last.',
  },
  {
    key: 'retarget',
    group: 'Waiting for Ship',
    label: 'A new target while held',
    lane: 'you',
    word: 'Not shipped',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [
      ch(STILL, {
        waiting: 3,
        toward: 'release/0.8.0',
        branch: 'althar/board-still-2',
        pr: undefined,
        state: undefined,
        checks: undefined,
        replaces: 714,
      }),
    ],
    reviewer: SOL,
    thread: [
      ...opening,
      { kind: 'part', who: 'you', text: 'You moved althar/board-still toward release/0.8.0.', change: 'still' },
      {
        kind: 'line',
        text: 'Made althar/board-still-2 from release/0.8.0, with the 3 commits. It stays here until Ship; #714 stays open.',
        change: 'still',
      },
    ],
    adr: 'Where commits wait for Ship, the cherry-picks take them along, and the new branch is made only on this computer. Ship pushes it and opens its pull request, and only then asks about the old one.',
  },
  {
    key: 'merge-unshipped',
    group: 'Waiting for Ship',
    label: 'Merge, with commits not shipped',
    lane: 'you',
    word: 'Ready',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { waiting: 2, ready: true })],
    reviewer: SOL,
    thread: [...opening, { kind: 'ask', ask: { kind: 'merge-unshipped', change: 'still' } }],
    adr: 'With commits not shipped, Merge offers two: Review and merge, or Merge now.',
  },
  {
    key: 'settle-unshipped',
    group: 'Waiting for Ship',
    label: 'Settling, with commits not shipped',
    lane: 'you',
    word: 'Not shipped',
    status: 'yours',
    title: 'Try a calmer empty board',
    kind: 'plain',
    preset: 'Prototype',
    changes: [{ id: 'empty', branch: 'althar/calmer-empty-board', title: 'Try a calmer empty board', place: 'worktree', waiting: 4 }],
    reviewer: { who: 'GPT-6.1 Sol', when: 'before' },
    shots: 6,
    thread: [
      { kind: 'you', text: 'Prototype a calmer empty board, three ways.' },
      {
        kind: 'lead',
        text: 'Three directions on one page, at localhost:5380. B is my pick.',
        took: { work: 610, tools: 220 },
        commits: { n: 4, change: 'empty' },
      },
      { kind: 'you', text: 'Thanks, that’s enough. Done.' },
      { kind: 'ask', ask: { kind: 'settle-unshipped', change: 'empty' } },
    ],
    adr: 'Settling a task with commits not shipped asks first: Ship, or settle and leave them on the branch.',
  },

  /* ——— Parts ——— */
  {
    key: 'parts-lines',
    group: 'Parts',
    label: 'Parts change, by anyone',
    lane: 'running',
    word: 'Working',
    status: 'running',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL)],
    reviewer: { who: 'GPT-6.1 Sol', when: 'after' },
    reviewing: { pr: 698, title: 'Virtualize long boards', by: 'noor-a', copy: true },
    thread: [
      ...opening,
      { kind: 'part', who: 'coordinator', text: 'The coordinator added a review of #698, as it touches the same lanes.' },
      { kind: 'part', who: 'you', text: 'You moved Checked by to after it merges.' },
      { kind: 'you', text: 'Does #698 break the held height?' },
      {
        kind: 'lead',
        text: 'No: #698 keeps the lane element, so the hold still finds it. One comment drafted on #698.',
        took: { work: 140, tools: 51 },
      },
    ],
    adr: 'Every change writes one line in the thread, saying who changed which part and why.',
  },
  {
    key: 'removed',
    group: 'Parts',
    label: 'A part removed, and what stays',
    lane: 'you',
    word: 'Needs you',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { place: 'none' })],
    reviewer: SOL,
    reviewing: { pr: 698, title: 'Virtualize long boards', by: 'noor-a', draft: 2 },
    left: [{ what: 'The worktree', stays: 'althar/board-still, here and on GitHub' }],
    thread: [
      ...opening,
      { kind: 'part', who: 'you', text: 'You removed the worktree. althar/board-still stays, here and on GitHub.', change: 'still' },
      { kind: 'ask', ask: { kind: 'remove-draft', pr: 698, findings: 2 } },
    ],
    adr: 'Removing a part loses nothing. A removal that would lose something asks first, on a card.',
  },

  /* ——— Reviews ——— */
  {
    key: 'fixes',
    group: 'Reviews',
    label: 'Fixes checked only where needed',
    lane: 'you',
    word: 'Ready',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { ready: true })],
    reviewer: SOL,
    thread: [
      ...opening.slice(0, 1),
      {
        kind: 'review',
        findings: 3,
        fixed: '3 fixed',
        checked: 'One fix checked again by GPT-6.1 Sol; two were a line or two, not read again.',
      },
      {
        kind: 'lead',
        text: 'Settled all three. #714 is up; its description names the two small fixes nobody read again.',
        took: { work: 88, tools: 20, review: 240 },
        commits: { n: 3, change: 'still' },
      },
    ],
    adr: 'A tiny fix needs no check, and a bigger one gets one short check by the same reviewer.',
  },
  {
    key: 'after-merge',
    group: 'Reviews',
    label: 'After the merge, it found something',
    lane: 'you',
    word: 'Review found 2',
    status: 'yours',
    title: 'Rename “Keep for later” to “Later”',
    kind: 'change',
    preset: 'Small change',
    changes: [ch(LATER, { state: 'merged', place: 'none', checks: undefined, found: 2 })],
    reviewer: { who: 'GPT-6.1 Sol', when: 'after' },
    thread: [
      { kind: 'you', text: 'Rename “Keep for later” to “Later”.' },
      {
        kind: 'lead',
        text: 'Renamed it in the board, the menu and the glossary. #715 merged.',
        took: { work: 58, tools: 14 },
        commits: { n: 1, change: 'later' },
      },
      { kind: 'review', findings: 2, after: true, change: 'later' },
      {
        kind: 'ask',
        ask: {
          kind: 'after-merge',
          pr: 715,
          findings: ['The Settled lane’s head still says “Kept 3”.', 'The edge’s menu still says “Keep for later”.'],
        },
      },
    ],
    adr: 'If it finds something, the task is in Needs you with the findings, which name the merged pull request: Fix it or Leave it.',
  },
  {
    key: 'after-merge-clean',
    group: 'Reviews',
    label: 'After the merge, nothing found',
    lane: 'settled',
    word: 'Settled',
    status: 'done',
    title: 'Rename “Keep for later” to “Later”',
    kind: 'change',
    preset: 'Small change',
    changes: [ch(LATER, { state: 'merged', place: 'none', checks: undefined })],
    reviewer: { who: 'GPT-6.1 Sol', when: 'after' },
    thread: [
      { kind: 'you', text: 'Rename “Keep for later” to “Later”.' },
      {
        kind: 'lead',
        text: 'Renamed it in the board, the menu, the edge and the glossary. #715 merged.',
        took: { work: 58, tools: 14 },
        commits: { n: 1, change: 'later' },
      },
      { kind: 'review', findings: 0, after: true, change: 'later' },
    ],
    adr: 'If the review finds nothing, the thread gets a line, with no notification and nothing in Needs you.',
  },
  {
    key: 'reviewing-related',
    group: 'Reviews',
    label: 'A change reviewing a related PR',
    lane: 'you',
    word: 'Review drafted',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { checks: 'running' })],
    reviewer: SOL,
    reviewing: { pr: 698, title: 'Virtualize long boards', by: 'noor-a', draft: 2, copy: true },
    thread: [
      ...opening,
      { kind: 'you', text: 'Look at #698 too, it touches the same lanes.' },
      {
        kind: 'lead',
        text: 'Two comments on #698, drafted: its lanes drop the element the hold measures. Run in a copy at its head, beside this change.',
        took: { start: 9, work: 176, tools: 64 },
        part: { text: 'Added a review of #698, in a copy at its head.' },
      },
    ],
    adr: 'Its draft is the person’s to post. A draft still unposted keeps the task in Needs you.',
  },

  /* ——— Chats and presets ——— */
  {
    key: 'scratch',
    group: 'Chats and presets',
    label: 'Chats on Scratch',
    lane: 'scratch',
    word: 'Chat',
    status: 'yours',
    title: 'What does ADR-087 say about helpers?',
    kind: 'plain',
    preset: 'Chat',
    changes: [],
    copy: { at: 'main' },
    reviewer: null,
    thread: [
      { kind: 'you', text: 'What does ADR-087 say about helpers?' },
      {
        kind: 'lead',
        text: 'A lead can start helpers on any agent, each in a copy of its own, four at once. The phase 5 proposal adds one handed a change, working in that change’s worktree.',
        took: { start: 3, work: 22, tools: 8 },
      },
    ],
    adr: 'It sits on Scratch, off the board’s lanes. It opens in place from the board, as one chip at most. A reply the person hasn’t seen waits in Needs you until they open it.',
  },
  {
    key: 'preset',
    group: 'Chats and presets',
    label: 'Its preset, and a new one offered',
    lane: 'you',
    word: 'Finished',
    status: 'yours',
    title: 'Prototype the Scratch shelf',
    kind: 'plain',
    preset: 'Prototype',
    changes: [{ id: 'proto', branch: 'althar/prototype-scratch-shelf', title: 'Prototype the Scratch shelf', place: 'worktree' }],
    reviewer: { who: 'GPT-6.1 Sol', when: 'before' },
    shots: 9,
    thread: [
      { kind: 'you', text: 'Prototype the Scratch shelf, three ways, on the real board.' },
      { kind: 'lead', text: 'Three directions on one page at localhost:5381, keys 1 to 3. A is my pick.', took: { work: 940, tools: 300 } },
      {
        kind: 'ask',
        ask: {
          kind: 'preset-offer',
          name: 'Design round',
          holds: 'a worktree, Claude Opus 5.5 at xhigh, reviewed only once it ships, no pull request',
        },
      },
    ],
    adr: 'A chip names the preset. The coordinator offers one when it sees the person set up the same parts more than once.',
  },

  /* ——— Time and failures ——— */
  {
    key: 'turn-time',
    group: 'Time and failures',
    label: 'Where each turn’s time went',
    lane: 'you',
    word: 'Not shipped',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { waiting: 1 })],
    reviewer: SOL,
    thread: [
      { kind: 'you', text: ASK },
      {
        kind: 'lead',
        text: 'Each lane holds its height until the move ends. #714 is up.',
        took: { wait: 190, start: 35, work: 214, tools: 61 },
      },
      { kind: 'you', text: 'Why did that take so long?' },
      {
        kind: 'lead',
        text: 'Most of it was waiting: four tasks had the agents for three minutes before I started. The work itself took under four.',
        took: { work: 9 },
      },
      { kind: 'you', text: 'Make the hold a little shorter.' },
      { kind: 'lead', text: 'Down to 140ms. Not shipped.', took: { work: 31, tools: 12 }, commits: { n: 1, change: 'still' } },
    ],
    adr: 'The turn’s line in the thread shows the total, and opening the line shows the parts.',
  },
  {
    key: 'usage',
    group: 'Time and failures',
    label: 'Out of usage',
    lane: 'running',
    word: 'Paused',
    status: 'paused',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { waiting: 1 }), ch(LATER, { checks: 'passed' })],
    reviewer: SOL,
    still: { why: 'Claude is out of usage until 14:00.', act: 'Use another model' },
    thread: [
      ...opening,
      { kind: 'you', text: 'Now the same for the Settled lane.' },
      { kind: 'ask', ask: { kind: 'usage', agent: 'Claude Opus 5.5', until: '14:00' } },
    ],
    adr: 'Nothing fails quietly: every error says what went wrong, and offers what fixes it.',
  },
  {
    key: 'no-slot',
    group: 'Time and failures',
    label: 'No place for an agent',
    lane: 'running',
    word: 'Waiting',
    status: 'queued',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL), ch(LATER, { checks: 'failed', failing: ['lint'] })],
    reviewer: SOL,
    still: { why: 'Rename’s fix waits for a free agent' },
    thread: [
      ...opening,
      { kind: 'line', text: 'lint fails on Rename.', change: 'later', tone: 'warning' },
      { kind: 'live', text: 'Fixing Rename’s checks starts when one of the 4 agents at work is free.', change: 'later' },
      { kind: 'you', text: 'Does the rename reach the edge’s menu too?' },
      { kind: 'lead', text: 'Yes: the task menu and the edge’s menu both say Later, in Rename.', took: { work: 14, tools: 4 } },
    ],
    adr: 'What the person says to an agent already never waits for a place among the agents at work. What Althar’s own course starts does.',
  },
  {
    key: 'stuck',
    group: 'Time and failures',
    label: 'A stuck step',
    lane: 'you',
    word: 'Stuck',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { waiting: 2, shipping: 'review' })],
    reviewer: SOL,
    thread: [
      ...opening,
      { kind: 'you', text: 'Ship it.' },
      {
        kind: 'ask',
        ask: {
          kind: 'stuck',
          what: 'The review for Ship',
          why: 'GPT-6.1 Sol stopped answering 6 minutes into the review of #714’s 2 commits.',
        },
      },
    ],
    adr: 'What needs the person never folds: a stuck step, a question, a permission, an error and its way out.',
  },
  {
    key: 'refused',
    group: 'Time and failures',
    label: 'The host refuses the push',
    lane: 'you',
    word: 'Not shipped',
    status: 'yours',
    title: TITLE,
    kind: 'change',
    preset: 'Change',
    changes: [ch(STILL, { waiting: 3 })],
    reviewer: SOL,
    thread: [
      ...opening,
      { kind: 'you', text: 'Ship it.' },
      { kind: 'review', findings: 0, change: 'still' },
      {
        kind: 'ask',
        ask: {
          kind: 'refused',
          change: 'still',
          why: 'GitHub refused the push to althar/board-still: this repository asks for signed commits.',
        },
      },
    ],
    adr: 'The Push card, where code hosts’ rules held back a push of Althar’s own, becomes Ship, since one push would send both.',
  },
]

export const GROUPS: ReadonlyArray<Group> = [...new Set(CASES.map((one) => one.group))]

export const caseOf = (key: string | null): Case => CASES.find((one) => one.key === key) ?? CASES[2]!

/** Each change's name in words, as the lead gave it when it started the change. */
const SHORT: Record<string, string> = {
  still: 'Lane heights',
  later: 'Rename',
  motion: 'Card slide',
  virtual: 'Virtual lanes',
}

/**
 * Once a task has two changes, each goes by its name in words: a task that never splits is named by its title, as today. A change
 * started here without one is named from its title's first words.
 */
export const withWords = (c: Case): Case =>
  c.changes.length < 2 || c.changes.every((one) => one.short !== undefined)
    ? c
    : {
        ...c,
        changes: c.changes.map((one) =>
          one.short !== undefined
            ? one
            : {
                ...one,
                short:
                  SHORT[one.id] ??
                  one.title
                    .replace(/[,.:;“”"]/g, '')
                    .split(' ')
                    .slice(0, 2)
                    .join(' '),
              },
        ),
      }

/** The change by its id, in a case. */
export const changeIn = (c: Case, id: string | undefined): Change | undefined => c.changes.find((one) => one.id === id)
