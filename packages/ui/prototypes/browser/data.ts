// Scrappy: what the fake runtime holds: althar, its board, and a task that changed the site, with its thread and its runs.
import type { BoardTask, ProjectSummary } from './deps'

import { card, change, items, project, repositories } from '../../../../apps/desktop/tests/fixtures'
import { RUNS } from './addresses'

const minutes = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

export const althar: ProjectSummary = {
  ...project,
  name: 'althar',
  slug: 'althar',
  ink: 'clay',
  repository: '/Users/balazs/Projects/charrette-project/althar',
  repositories: ['althar'],
  worktrees: '/Users/balazs/Althar/althar',
  running: 2,
  waiting: 0,
  working: 1,
  ready: 1,
}

export const repository = {
  ...repositories[0]!,
  id: 'repo_althar',
  name: 'althar',
  path: '/Users/balazs/Projects/charrette-project/althar',
  host: {
    ...repositories[0]!.host!,
    path: 'AltharIDE/althar',
    url: 'https://github.com/AltharIDE/althar',
    account: { login: 'balazs', state: 'ready' as const },
  },
  tasks: 3,
}

/** The task with the UI change: the site's Runs on band names what each system needs. */
export const TASK = {
  id: 't1',
  threadId: 'th1',
  title: 'Runs on: say what each system needs',
  slug: 'runs-on-versions',
  branch: 'althar/runs-on-versions',
  worktree: '/Users/balazs/Althar/althar/runs-on-versions',
  lead: 'Claude Opus 5.5',
}

/** Another task under way, for A's picker of where comments go. */
export const OTHER = { id: 't2', threadId: 'th2', title: 'Changelog: one card per release, newest first' }

const boardTask = (content: ReturnType<typeof card>, at: number, more: Partial<BoardTask> = {}): BoardTask =>
  ({ ...content, state: 'open', createdAt: minutes(at), settledAt: null, changed: null, here: [], ...more }) as unknown as BoardTask

export const tasks: BoardTask[] = [
  boardTask(
    card({
      taskId: TASK.id,
      threadId: TASK.threadId,
      title: TASK.title,
      slug: TASK.slug,
      branch: TASK.branch,
      phase: 'ready',
      lead: 'claude-code',
      leadModel: 'claude-opus-5-5',
      startedAt: minutes(42),
      change: change({
        draft: true,
        number: 641,
        title: TASK.title,
        repository: 'AltharIDE/althar',
        url: 'https://github.com/AltharIDE/althar/pull/641',
      }),
      summary: 'Each system in the band says the oldest version it needs.',
    }),
    50,
    { changed: { files: 2, add: 38, del: 6 } },
  ),
  boardTask(
    card({
      taskId: OTHER.id,
      threadId: OTHER.threadId,
      title: OTHER.title,
      slug: 'changelog-cards',
      branch: 'althar/changelog-cards',
      phase: 'running',
      step: 'implement',
      lead: 'claude-code',
      leadModel: 'claude-opus-5-5',
      startedAt: minutes(12),
    }),
    14,
  ),
  boardTask(card({ taskId: 't3', threadId: 'th3', title: 'Docs: a first page on installing', slug: 'docs-install', phase: 'planned' }), 5),
]

/** The site, as the project runs it: main's copy on 5320, the task's worktree on 5321. */
export const runnables = [
  { id: 'site', name: 'Site', command: 'bun run site', repository: 'althar', own: true, from: 'repository' as const },
]

export const launchOf = (run: 'main' | 'task', startedMinutes: number) => ({
  id: `site-${run}`,
  command: 'bun run site',
  label: 'Site',
  runnableId: 'site',
  url: RUNS[run].address,
  startedAt: minutes(startedMinutes),
  ended: null,
  taskId: run === 'task' ? TASK.id : null,
  where: run === 'task' ? TASK.title : 'main',
})

/** A run's card in the thread it was asked for in. */
const runCard = (run: 'main' | 'task', startedMinutes: number) => ({
  ...items.says(''),
  agentId: null,
  kind: 'run' as const,
  content: {
    launchId: `site-${run}`,
    taskId: run === 'task' ? TASK.id : null,
    runnableId: 'site',
    name: 'Site',
    where: run === 'task' ? TASK.title : 'main',
    command: 'bun run site',
    url: RUNS[run].address,
    startedAt: minutes(startedMinutes),
    ended: null,
  },
})

const shot = (digest: string, name: string, width: number, height: number) => ({
  digest,
  mediaType: 'image/png',
  bytes: 112_000,
  width,
  height,
  name,
  unkept: null,
})

/** The lead's own screenshots of the band, as it handed them with its step. */
export const EVIDENCE = [
  {
    digest: 'lead-band-wide',
    caption: 'The Runs on band, each system with the oldest version it needs',
    view: 'Runs on band',
    address: `${RUNS.task.address}`,
    viewport: { w: 1280, h: 800 },
    scroll: 700,
    box: { x: 0, y: 764, w: 1280, h: 148 },
  },
  {
    digest: 'lead-band-narrow',
    caption: 'The band on a phone, its systems stacked',
    view: 'Runs on band, narrow',
    address: `${RUNS.task.address}`,
    viewport: { w: 390, h: 844 },
    scroll: 780,
    box: { x: 0, y: 820, w: 390, h: 270 },
  },
] as const

export const threadItems = [
  items.tool({ title: 'Read apps/site/src/home/bodies/RunsOn.tsx', toolKind: 'read' }),
  items.says(
    'Electron 44 sets the floor: macOS 12, Windows 10, and on Linux what its glibc needs, which Ubuntu 20.04 and Fedora 38 meet. I’ll put each under its system’s name in the band.',
  ),
  items.tool({ title: 'Edit apps/site/src/home/bodies/RunsOn.tsx', toolKind: 'edit' }),
  items.tool({ title: 'Edit apps/site/src/home/bodies/RunsOn.module.css', toolKind: 'edit' }),
  runCard('task', 9),
  items.step({
    step: 'implement',
    summary:
      'Each system in the Runs on band now names the oldest version it needs, under its name, from Electron 44’s supported platforms. Checked at the desktop width and on a phone.',
    evidence: EVIDENCE.map((one) => ({
      kind: 'screenshot' as const,
      caption: one.caption,
      picture: shot(one.digest, `${one.view}.png`, one.viewport.w, one.box.h),
      command: null,
      exit: null,
      text: null,
      dropped: 0,
      view: one.view,
    })),
  }),
  items.says(
    `It’s up at [localhost:5321](${RUNS.task.address}). The versions match [the changelog’s 0.7 notes](https://althar.ai/changelog); [DEV-201](https://linear.app/althar/issue/DEV-201) tracks the install page that will say more. The coverage report is in [coverage/index.html](file://${TASK.worktree}/apps/site/coverage/index.html).`,
  ),
]

export const coordinatorItems = [
  items.you('Run the site on main, I want to compare it with the Runs on task.'),
  runCard('main', 21),
  items.says(
    `Main’s site is up at [localhost:5320](${RUNS.main.address}); the task’s is at [localhost:5321](${RUNS.task.address}). [Runs on: say what each system needs](${RUNS.task.address}) is ready for you.`,
  ),
]

/** What the person asked the task for, in their words. */
export const REQUEST = 'On the site’s Runs on band, say what each system needs: the oldest version of each that Althar runs on.'

/** A picture the window sends with a message: a crop this server drew, by its digest. */
export const sentPicture = (crop: { digest: string; width: number; height: number; bytes: number }, name: string) => ({
  digest: crop.digest,
  mediaType: 'image/png',
  bytes: crop.bytes,
  width: crop.width,
  height: crop.height,
  name,
  unkept: null,
})

export { items }
