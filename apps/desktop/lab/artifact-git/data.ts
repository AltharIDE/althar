import type {
  CanvasDetail,
  CanvasSaved,
  CanvasSummary,
  CanvasVersionFacts,
  ProjectSummary,
  ThreadItem,
  ThreadSnapshot,
} from '@althar/contracts'

import type { Client } from '../../src/renderer/data/client'
import {
  connectionList,
  coordinatorSnapshot,
  fakeClient,
  githubConnection,
  home,
  items,
  repositories,
  snapshot,
} from '../../tests/fixtures'
import { type Direction, type LabState, lab, type Person, PEOPLE, whoOf } from './state'

/*
 * What the lab's fake runtime says. Kiln, a pottery studio's bookings site,
 * keeps its artifacts in its repository's design folder, each in a pull
 * request of its own, committed when someone saves. Its Booking page
 * (design/booking/) was drawn in Maya's Althar and merged in #214 at v3.
 * Since then Ana, an engineer, changed it in her own Althar: the bookings
 * API's dates, price and places left, and no Gift this class, as the API
 * can't sell gifts yet. Her Althar saved that in #221, open. Maya changed it
 * too, in hers, without knowing: her heading, Book in a bar with the price
 * beside it, Gift as a button (v4, not in git yet). Each direction says what
 * each Althar shows, the artifact's chat says and git holds, moment by
 * moment (state.ts).
 */

export const KILN = 'p_kiln'
export const COORDINATOR = 'thc_kiln'
export const CANVAS = 'cnv_booking'
export const CHAT_TASK = 't_booking-chat'
export const CHAT_THREAD = 'th_booking-chat'
export const REPO = 'r_kiln'

const opened = Date.now()
const minutesAgo = (minutes: number) => new Date(opened - minutes * 60_000).toISOString()

/** How each version looks: the design page's own variants (design.html). */
export type Variant = 'base' | 'ana' | 'maya' | 'together' | 'together-nogift'

/** A version as the lab keeps it: what it looks like, who made it and where it came from. */
export interface Version {
  readonly n: number
  readonly variant: Variant
  /** This Althar's chat, or a person, whose version came from git. */
  readonly who: 'chat' | Person
  /** Made here; or from git (main or an open pull request); or, in D, the artifact's draft in git, everyone's. */
  readonly where: 'here' | 'git' | 'draft'
  readonly note: string
  /** Minutes ago: when it was made, for one from git when it was committed. */
  readonly ago: number
}

export const PR = {
  merged: { number: 214, url: 'https://github.com/kiln-studio/kiln/pull/214' },
  ana: { number: 221, url: 'https://github.com/kiln-studio/kiln/pull/221' },
  own: { number: 223, url: 'https://github.com/kiln-studio/kiln/pull/223' },
} as const

export const COMMITS = { merged: 'c41d2e8a0f', ana: '3f2a1c9b7e', maya: '8d41e07c2a' } as const

const MAYA_START: ReadonlyArray<Version> = [
  { n: 1, variant: 'base', who: 'chat', where: 'here', note: 'The class’s page', ago: 4320 },
  { n: 2, variant: 'base', who: 'chat', where: 'here', note: 'A warmer photo, the studio’s address', ago: 2880 },
  { n: 3, variant: 'base', who: 'chat', where: 'here', note: 'Merged in #214', ago: 1440 },
]
const MAYA_V4: Version = {
  n: 4,
  variant: 'maya',
  who: 'chat',
  where: 'here',
  note: 'Book in a bar, Gift as a button, a new heading',
  ago: 10,
}
const ANA_NOTE = 'Dates, price and places from the bookings API; Gift taken out'

/** Ana's Althar: the artifact as it came from git, Maya's three versions, and her own. */
const ANA_START: ReadonlyArray<Version> = [
  { n: 1, variant: 'base', who: 'maya', where: 'git', note: 'The class’s page', ago: 4320 },
  { n: 2, variant: 'base', who: 'maya', where: 'git', note: 'A warmer photo, the studio’s address', ago: 2880 },
  { n: 3, variant: 'base', who: 'maya', where: 'git', note: 'Merged in #214', ago: 1440 },
  { n: 4, variant: 'ana', who: 'chat', where: 'here', note: ANA_NOTE, ago: 30 },
]

const together = (gift: boolean): Variant => (gift ? 'together' : 'together-nogift')

/** The artifact's versions in the window's Althar, oldest first. */
export const versionsOf = (s: LabState): ReadonlyArray<Version> => {
  if (whoOf(s) === 'ana') {
    const hers = {
      n: 5,
      variant: 'together' as const,
      who: 'maya' as const,
      where: 'git' as const,
      note: 'Update Booking page to v6',
      ago: 2,
    }
    switch (s.d) {
      case 'a':
      case 'c':
        return [...ANA_START, hers]
      case 'b':
        return ANA_START
      case 'd':
        return [
          ...ANA_START.slice(0, 3),
          { ...ANA_START[3]!, where: 'draft', note: ANA_NOTE },
          { n: 5, variant: 'ana', who: 'chat', where: 'draft', note: 'Places left update as people book', ago: 6 },
          { n: 6, variant: 'together', who: 'maya', where: 'draft', note: 'Her heading, Book bar and Gift button', ago: 3 },
        ]
    }
  }
  const m = s.m
  switch (s.d) {
    case 'a': {
      const all: Array<Version> = [...MAYA_START, MAYA_V4, { n: 5, variant: 'ana', who: 'ana', where: 'git', note: ANA_NOTE, ago: 25 }]
      if (m >= 1) all.push({ n: 6, variant: 'together', who: 'chat', where: 'here', note: 'Ana’s v5 brought into v4', ago: 1 })
      if (m >= 1 && s.takenOut)
        all.push({ n: 7, variant: 'together-nogift', who: 'chat', where: 'here', note: 'Gift this class taken out, as Ana has it', ago: 0 })
      return all
    }
    case 'b':
      if (m < 2) return [...MAYA_START, MAYA_V4]
      return [
        ...MAYA_START,
        MAYA_V4,
        s.took === 'theirs'
          ? { n: 5, variant: 'ana', who: 'chat', where: 'here', note: 'Ana’s, as she has it', ago: 0 }
          : { n: 5, variant: together(s.gift !== 'out'), who: 'chat', where: 'here', note: 'Together with Ana’s', ago: 0 },
      ]
    case 'c': {
      if (m === 0) return [...MAYA_START, MAYA_V4]
      const all: Array<Version> = [
        ...MAYA_START,
        MAYA_V4,
        { n: 5, variant: 'together', who: 'chat', where: 'here', note: 'Ana’s brought in under yours', ago: 1 },
      ]
      if (s.gift === 'out')
        all.push({ n: 6, variant: 'together-nogift', who: 'chat', where: 'here', note: 'Gift this class taken out', ago: 0 })
      return all
    }
    case 'd': {
      const draft: Array<Version> = [...MAYA_START, { n: 4, variant: 'ana', who: 'ana', where: 'draft', note: ANA_NOTE, ago: 25 }]
      if (m >= 1)
        draft.push(
          { n: 5, variant: 'ana', who: 'ana', where: 'draft', note: 'Places left update as people book', ago: 6 },
          { n: 6, variant: 'together', who: 'chat', where: 'draft', note: 'Yours on Ana’s v5', ago: 1 },
        )
      return draft
    }
  }
}

/** The version the moment opens on, unless the person stepped to another: the latest, but where someone else's came while they looked. */
export const shownOf = (s: LabState): number => {
  const all = versionsOf(s)
  const latest = all.at(-1)?.n ?? 1
  if (s.shown !== null) return Math.min(s.shown, latest)
  // A new version from someone else, in git, doesn't move what the person is looking at: the panel says it's there.
  if (s.d === 'a' && (s.m === 0 || s.m === 3)) return 4
  return latest
}

export const versionOf = (s: LabState, n: number) => versionsOf(s).find((one) => one.n === n) ?? null

/** Who made a version, as the artifact's row says it: its chat, or a person, from git or the draft. */
export const byWords = (s: LabState, version: Version | null) => {
  if (version === null) return null
  if (version.who === 'chat') return 'Its chat'
  const name = version.who === whoOf(s) ? 'You' : PEOPLE[version.who].name
  const where = version.where === 'draft' ? 'in the draft' : 'in git'
  return `${name}, ${where} · ${agoWords(version.ago)}`
}

export const agoWords = (minutes: number) =>
  minutes < 1
    ? 'just now'
    : minutes < 60
      ? `${minutes} min ago`
      : minutes < 1440 * 2
        ? 'yesterday'
        : `${Math.round(minutes / 1440)} days ago`

const savedAs = (
  version: number | null,
  commit: string | null,
  pullRequest: { number: number; url: string } | null,
  state: CanvasSaved['state'] = 'saved',
): CanvasSaved => ({
  repositoryId: REPO,
  repository: 'kiln',
  path: 'design/booking/',
  how: 'pr',
  follow: false,
  version,
  commit,
  pullRequest,
  state,
  problem: null,
})

/** Where the artifact is in git, as the window's Althar knows it now. */
export const savedOf = (s: LabState): CanvasSaved => {
  const latest = versionsOf(s).at(-1)?.n ?? 1
  if (whoOf(s) === 'ana') return s.d === 'b' ? savedAs(4, COMMITS.ana, PR.ana) : savedAs(s.d === 'd' ? 6 : 5, COMMITS.maya, PR.ana)
  const pending = s.saved === 'saving' ? 'saving' : 'saved'
  switch (s.d) {
    case 'a':
      // Ana's commit is the artifact's latest in git: Althar read it from her open pull request.
      if (s.saved === 'done') return savedAs(latest, COMMITS.maya, PR.ana)
      return savedAs(5, COMMITS.ana, PR.ana, pending)
    case 'b':
      if (s.saved === 'done') return savedAs(latest, COMMITS.maya, s.into === 'join' ? PR.ana : PR.own)
      return savedAs(3, COMMITS.merged, PR.merged, pending)
    case 'c':
      return s.m >= 2 ? savedAs(latest, COMMITS.maya, PR.ana) : savedAs(3, COMMITS.merged, PR.merged)
    case 'd':
      return savedAs(latest, latest === 6 ? COMMITS.maya : COMMITS.ana, PR.ana)
  }
}

const facts = (s: LabState, version: Version): CanvasVersionFacts => ({
  number: version.n,
  base: version.n > 1 ? version.n - 1 : null,
  title: 'Booking page',
  kind: 'html',
  entry: 'index.html',
  manifest: `m_${s.d}_${whoOf(s)}_${version.n}_${version.variant}`,
  entrySha256: `e_${version.variant}`,
  note: version.note,
  files: 2,
  bytes: 6_240,
  by: { role: 'chat', taskId: CHAT_TASK, taskTitle: 'Booking page', threadId: CHAT_THREAD },
  at: minutesAgo(version.ago),
})

const summaryOf = (s: LabState): CanvasSummary => {
  const all = versionsOf(s)
  const latest = all.at(-1)!
  return {
    id: CANVAS,
    projectId: KILN,
    name: 'booking',
    group: null,
    latest: facts(s, latest),
    versions: all.length,
    openComments: 0,
    archived: false,
    saved: savedOf(s),
    chat: { taskId: CHAT_TASK, threadId: CHAT_THREAD },
  }
}

const detailOf = (s: LabState): CanvasDetail => ({
  summary: summaryOf(s),
  versions: versionsOf(s).map((one) => facts(s, one)),
  comments: [],
})

/* ---- The artifact's chat ---------------------------------------------- */

let sequence = 0
const stamp = (minutes: number) => {
  sequence += 1
  return { id: `i_lab_${sequence}`, sequence, createdAt: minutesAgo(minutes) }
}
const at = <T extends ThreadItem>(item: T, minutes: number): T => ({ ...item, ...stamp(minutes) })

const you = (text: string, ago: number) => at(items.you(text), ago)
const says = (text: string, ago: number) => at(items.says(text, 'claude-code'), ago)
const drew = (version: number, note: string, ago: number): ThreadItem =>
  at(
    {
      id: '',
      sequence: 0,
      createdAt: '',
      agentId: 'claude-code',
      kind: 'canvas',
      content: {
        canvasId: CANVAS,
        name: 'booking',
        title: 'Booking page',
        canvasKind: 'html',
        version,
        note,
        action: 'published',
        open: false,
      },
    } as ThreadItem,
    ago,
  )
const notice = (title: string, description: string, ago: number) => at(items.notice({ title, description, source: 'runtime' }, null), ago)

const MAYA_ASKED =
  'Make Book stand out: a bar with the price beside it, and Gift as a button of its own. Heading: Book a wheel-throwing class.'

const mayaHistory = (withV4: boolean): ReadonlyArray<ThreadItem> => [
  you('Draw the booking page for the wheel-throwing class: what it is, when, the price, Book, and a way to gift it.', 4325),
  drew(1, 'The class’s page', 4320),
  says('v1 is the class’s page: the photo, what you make, when and where, the price, Book a place and Gift this class.', 4320),
  ...(withV4
    ? [
        you(MAYA_ASKED, 12),
        drew(4, 'Book in a bar, Gift as a button, a new heading', 10),
        says('v4 has Book in a bar with the price beside it, Gift this class as a button under it, and your heading.', 10),
      ]
    : []),
]

const ANA_HISTORY: ReadonlyArray<ThreadItem> = [
  you('Use the real dates, price and places left from the bookings API. Take out Gift: we can’t sell gifts yet.', 32),
  drew(4, ANA_NOTE, 30),
  says(
    'v4 has the class’s next date, £48 and the places left, as the bookings API gives them, and no Gift this class. Saved to kiln in **#221**.',
    30,
  ),
]

const GIFT_QUESTION = (answered: 'keep' | 'out' | null): ThreadItem =>
  at(
    items.question({
      attentionId: 'q_gift',
      message: 'Gift this class',
      fields: [
        {
          id: 'gift',
          question: 'Ana took out Gift this class, as the bookings API can’t sell gifts yet. You’d made it a button. Keep it?',
          type: 'choice',
          options: [
            { value: 'keep', label: 'Keep it', note: 'Your button stays; Ana sees why in #221' },
            { value: 'out', label: 'Take it out', note: 'As Ana has it' },
          ],
          multiple: false,
          wordsField: 'gift_words',
          required: false,
        },
      ],
      state: answered === null ? 'open' : 'answered',
      answers: answered === null ? null : { gift: { values: [answered] } },
    }),
    1,
  )

const TELL_LEAD: ThreadItem = at(
  items.question({
    attentionId: 'q_lead',
    message: 'Booking page, on the site',
    fields: [
      {
        id: 'lead',
        question: 'Your task Booking page, on the site builds the page from this design. Tell its lead what Maya changed?',
        type: 'choice',
        options: [
          { value: 'tell', label: 'Tell it', note: 'It makes the site’s page match v5' },
          { value: 'later', label: 'Not now' },
        ],
        multiple: false,
        wordsField: 'lead_words',
        required: false,
      },
    ],
    state: 'open',
    answers: null,
  }),
  1,
)

/** What the artifact's chat holds in the window's Althar, at the moment. */
export const chatOf = (s: LabState): { readonly items: ReadonlyArray<ThreadItem>; readonly running: boolean } => {
  sequence = 0
  if (whoOf(s) === 'ana') {
    if (s.d === 'c')
      return {
        items: [
          ...ANA_HISTORY,
          notice('Maya changed Booking page in git', '#221 · 8d41e07 · 2 min ago', 2),
          says(
            'It’s in your **#221**: her heading, Book in a bar and Gift as a button, over your dates, price and places left. She kept Gift this class, which you’d taken out, knowing the API can’t sell gifts yet. It’s **v5** here; `design/booking/index.html` and `styles.css` changed.',
            1,
          ),
          TELL_LEAD,
        ],
        running: false,
      }
    if (s.d === 'd')
      return {
        items: [
          ...ANA_HISTORY,
          at(items.arrival({ source: 'github', kind: 'ready', from: 'maya', where: 'PR #221', text: null, url: PR.ana.url }), 1),
        ],
        running: false,
      }
    return { items: ANA_HISTORY, running: false }
  }
  switch (s.d) {
    case 'a':
      return {
        items: [
          ...mayaHistory(true),
          ...(s.m >= 1
            ? [
                you('Bring in Ana’s v5.', 2),
                drew(6, 'Ana’s v5 brought into v4', 1),
                says(
                  'v6 has Ana’s dates, price and places left in your Book bar, under your heading. She’d taken out Gift this class; I kept your button, as you’d just made it one.',
                  1,
                ),
              ]
            : []),
          ...(s.takenOut ? [you('Take Gift out, as Ana has it.', 0), drew(7, 'Gift this class taken out, as Ana has it', 0)] : []),
        ],
        running: false,
      }
    case 'b':
      return {
        items: [
          ...mayaHistory(true),
          ...(s.m >= 2 ? [drew(5, s.took === 'theirs' ? 'Ana’s, as she has it' : 'Together with Ana’s', 0)] : []),
        ],
        running: false,
      }
    case 'c': {
      const told = [
        notice('Ana changed Booking page in git', '#221 · 3f2a1c9 · 25 min ago', 2),
        says(
          'Her dates, price and places left now come from the bookings API, and she took out Gift this class. You’ve changed the heading, the Book bar and Gift since, in v4. Bringing hers in under yours.',
          2,
        ),
      ]
      if (s.m === 0) return { items: [...mayaHistory(true), ...told], running: true }
      const gift = s.m >= 2 ? (s.gift ?? 'keep') : s.gift
      return {
        items: [
          ...mayaHistory(true),
          ...told,
          drew(5, 'Ana’s brought in under yours', 1),
          says('v5 has both: Ana’s dates, price and places left in your Book bar, under your heading.', 1),
          GIFT_QUESTION(gift),
          ...(gift === null
            ? []
            : [
                ...(gift === 'out' ? [drew(6, 'Gift this class taken out', 0)] : []),
                says(
                  gift === 'keep'
                    ? 'Kept. Saved v5 to Ana’s **#221** rather than a pull request of its own, with a line there on why Gift is back.'
                    : 'Taken out, in v6. Saved it to Ana’s **#221** rather than a pull request of its own.',
                  0,
                ),
              ]),
        ],
        running: false,
      }
    }
    case 'd':
      return {
        items: [
          ...mayaHistory(false),
          ...(s.m >= 1
            ? [
                you(MAYA_ASKED, 8),
                drew(6, 'Yours on Ana’s v5', 1),
                says(
                  'v6 is in Ana’s draft: your heading, Book bar and Gift button with her dates, price and places left. She pushed v5 while I worked, so it’s on that. She’d taken out Gift as the API can’t sell gifts yet; it’s back as you asked, and she sees it in the draft.',
                  1,
                ),
              ]
            : []),
        ],
        running: false,
      }
  }
}

/* ---- The project, and the client the app reads ----------------------- */

const project: ProjectSummary = {
  id: KILN,
  name: 'kiln',
  slug: 'kiln',
  ink: 'clay',
  lastWorkAt: minutesAgo(2),
  repository: '/Users/you/Code/kiln',
  repositories: ['kiln'],
  worktrees: '/Users/you/Charrette/kiln',
  tasks: 2,
  running: 0,
  yours: 0,
  working: 0,
  usageLimit: 'move',
  rotateAccounts: false,
  onlyAccounts: null,
  coordinatorThreadId: COORDINATOR,
}

let cursor = 3
const chatThread = (): ThreadSnapshot => {
  const s = lab.get()
  const base = snapshot()
  const chat = chatOf(s)
  cursor += 1
  return snapshot({
    threadId: CHAT_THREAD,
    cursor,
    project: { id: KILN, name: 'kiln' },
    task: {
      ...base.task,
      id: CHAT_TASK,
      title: 'Booking page',
      slug: 'booking-page',
      scratch: true,
      artifact: { canvasId: CANVAS },
      kind: 'plain',
      branch: null,
      worktree: null,
      phase: chat.running ? 'running' : 'ready',
      steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
      lead: { agentId: 'claude-code', model: null, account: null },
      startedAt: minutesAgo(4325),
    },
    session: {
      ...(base.session as NonNullable<ThreadSnapshot['session']>),
      turnRunning: chat.running,
      turnStartedAt: chat.running ? minutesAgo(0.2) : null,
      turnEndedAt: chat.running ? null : (chat.items.at(-1)?.createdAt ?? null),
    },
    items: chat.items as Array<ThreadItem>,
  })
}

export const makeClient = (): Client =>
  fakeClient({
    listProjects: async () => ({ cursor: 3, projects: [project] }),
    openProject: async () => project,
    getHome: async () => home({ looked: minutesAgo(180), since: minutesAgo(180), projects: [project] }),
    getBoard: async () => ({ cursor: 3, tasks: [], calls: [], settledTotal: 12 }),
    getCoordinator: async () =>
      coordinatorSnapshot({
        threadId: COORDINATOR,
        project: { id: KILN, name: 'kiln' },
        host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        items: [],
      }),
    getThread: async () => chatThread(),
    getRepositories: async () => repositories.slice(0, 1).map((one) => ({ ...one, id: REPO, name: 'kiln', path: '/Users/you/Code/kiln' })),
    listConnections: async () => ({ ...connectionList, connections: [githubConnection] }),
    listCanvases: async () => [summaryOf(lab.get())],
    getCanvas: async () => detailOf(lab.get()),
    getArtifactsPlace: async () => ({
      home: { repositoryId: REPO, repository: 'kiln', folder: 'design/', how: 'pr', follow: false },
      guess: null,
    }),
    listRepositoryFolders: async () => ({ folders: ['design/', 'design/booking/', 'site/', 'site/src/'], truncated: false }),
    // The question in the chat, answered: C's Gift moves on to the save; Ana's Tell it is said.
    answerQuestion: async ({ answers }) => {
      const gift = answers['gift']?.values[0]
      if (gift === 'keep' || gift === 'out') lab.set({ m: 2, gift })
    },
  }).client

/** The tabs the window keeps at every load: Kiln's, on its artifacts. */
export const TABS = { open: [KILN], places: {}, rooms: { [KILN]: 'artifacts' } }

/** What the lab's chat says has changed, by direction: for the README's and the bar's sake. */
export const STORY: Readonly<Record<Direction, string>> = {
  a: 'What’s in git comes in as a version, in line, saying who.',
  b: 'Theirs and yours side by side, with the differences pinned.',
  c: 'The artifact’s chat hears of it, says it and asks only what it can’t decide.',
  d: 'The open pull request is everyone’s draft of it.',
}
