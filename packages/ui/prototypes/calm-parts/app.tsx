// Scrappy: the real desktop app (its router, tabs, board and task screens) on the tests' fake client, open on one of phase 5's cases.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/styles/global.css'
import '../../../../apps/desktop/src/renderer/app.css'

import { createRoot } from 'react-dom/client'

import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { Segmented } from '../../src/primitives/Segmented/Segmented'
import { Select } from '../../src/primitives/Select/Select'
import { type BoardTask, type ChangeSummary, type ProjectSummary, RouterProvider, type ThreadSnapshot } from './deps'

import { follow } from '../../../../apps/desktop/src/renderer/data/feed'
import { makeQueryClient } from '../../../../apps/desktop/src/renderer/data/reads'
import { ServicesProvider } from '../../../../apps/desktop/src/renderer/data/services'
import { makeRouter } from '../../../../apps/desktop/src/renderer/router'
import { chooseFace } from '../../../../apps/desktop/src/renderer/features/task/chosenFaces'
import {
  card,
  change,
  coordinatorSnapshot,
  fakeClient,
  fakeHost,
  home,
  items,
  models,
  project,
  repositories,
  snapshot,
} from '../../../../apps/desktop/tests/fixtures'
import { type Case, CASES, caseOf, type Change } from './cases'
import { VIEWS } from './directions'
import { open } from './need'
import { css } from './parts'
import { type Direction, proto, useProto } from './state'
import { itemsOf } from './thread'

/* ——— What the fake runtime holds: althar, its board, the case's task. ——— */

const althar: ProjectSummary = {
  ...project,
  name: 'althar',
  slug: 'althar',
  ink: 'clay',
  repository: '/Users/balazs/Projects/charrette-project/althar',
  repositories: ['althar'],
  worktrees: '/Users/balazs/Althar/althar',
  running: 2,
  working: 2,
}
const repository = {
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

const summaryOf = (one: Change): ChangeSummary =>
  change({
    number: one.pr ?? 0,
    title: one.title,
    url: `https://github.com/AltharIDE/althar/pull/${one.pr ?? 0}`,
    state: one.state === 'merged' ? 'merged' : one.state === 'closed' ? 'closed' : 'open',
    draft: one.state === 'draft',
    repository: 'AltharIDE/althar',
    slug: 'althar',
    additions: one.add ?? 10,
    deletions: one.del ?? 2,
    target: one.toward ?? 'main',
    head: `head-${one.id}`,
    localHead: `head-${one.id}`,
    unpushed: one.waiting ?? 0,
    checks:
      one.checks === 'failed'
        ? {
            outcome: 'failed',
            passed: 11,
            failed: 1,
            running: 0,
            total: 12,
            failing: [...(one.failing ?? ['e2e'])],
            list: [{ name: one.failing?.[0] ?? 'e2e', state: 'failed', summary: '1 failed' }],
          }
        : one.checks === 'running'
          ? { outcome: 'running', passed: 7, failed: 0, running: 5, total: 12, failing: [], list: [] }
          : { outcome: 'passed', passed: 12, failed: 0, running: 0, total: 12, failing: [], list: [] },
  })

/** A time this many minutes ago, so the board's clocks read as today's. */
const recent = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const boardTask = (overrides: Partial<BoardTask>): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-11-08T08:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
  branch: overrides.branch ?? `althar/${overrides.slug ?? 'task'}`,
})

const PHASE = { running: 'running', you: 'ready', settled: 'settled', scratch: 'ready' } as const

const caseTask = (c: Case): BoardTask => {
  const first = c.changes.find(open) ?? c.changes[0]
  return boardTask({
    taskId: 't1',
    threadId: 'th1',
    title: c.title,
    slug: 'board-still',
    kind: c.kind,
    phase: PHASE[c.lane],
    step: c.lane === 'running' ? 'implement' : null,
    startedAt: recent(60),
    ...(c.lane === 'settled' ? { settledAt: '2026-11-08T10:12:00.000Z' } : {}),
    branch: first?.branch ?? null,
    change: first?.pr === undefined ? null : summaryOf(first),
  })
}

const others: BoardTask[] = [
  boardTask({
    taskId: 't2',
    threadId: 'th2',
    title: 'Office hours and privacy pages on the site',
    slug: 'office-hours',
    kind: 'change',
    phase: 'running',
    step: 'review',
    startedAt: recent(52),
  }),
  boardTask({
    taskId: 't3',
    threadId: 'th3',
    title: 'Nightly dependency check, 8 Nov',
    slug: 'nightly-deps',
    kind: 'change',
    phase: 'running',
    step: 'implement',
    startedAt: recent(14),
  }),
  boardTask({
    taskId: 't4',
    threadId: 'th4',
    title: 'Light theme meets WCAG AA contrast',
    slug: 'light-contrast',
    kind: 'change',
    phase: 'ready',
    change: change({
      draft: false,
      number: 653,
      title: 'Light theme meets WCAG AA contrast',
      repository: 'AltharIDE/althar',
      checks: { outcome: 'passed', passed: 12, failed: 0, running: 0, total: 12, failing: [], list: [] },
    }),
  }),
  boardTask({
    taskId: 't5',
    threadId: 'th5',
    title: 'A remote added after the project is made is picked up',
    slug: 'late-remote',
    kind: 'change',
    phase: 'settled',
    settledAt: '2026-11-08T07:00:00.000Z',
  }),
]

// The coordinator's conversation, made once: read again, its items keep their ids.
const talk = [
  items.you('The board jumps when a card changes lanes. Fix it, and rename “Keep for later” to “Later” while you’re at it.'),
  items.says('Started “Hold the board still while agents work”, a Change. Its lead keeps the rename apart if it’s unrelated.'),
]

/** The plan card the case's task started from, held so its clock waits: the one place its preset shows. A chat has none. */
const planOf = (c: Case) =>
  items.card(
    // A task of its own: one still held is not started, and its thread would open here instead of the case's.
    card({
      taskId: 'tp',
      threadId: 'thp',
      title: c.title,
      slug: 'board-still',
      phase: 'held',
      kind: c.kind,
      plan: {
        id: 'pln1',
        steps: [
          { key: 'implement', agentId: 'claude-code', model: 'opus', skipped: false },
          { key: 'review', agentId: 'codex', model: 'gpt-6.1-sol', skipped: false },
        ],
        startsAt: null,
        reason: 'It knows the board.',
        end: 'draft',
        worksIn: 'worktree',
      },
      branch: 'althar/board-still',
    }),
    'plan-t1',
  )
const talkOf = (c: Case) => (c.preset === 'Chat' ? talk : [...talk, planOf(c)])

const withNames = models.map((one) =>
  one.agentId === 'claude-code'
    ? { ...one, models: one.models.map((model) => (model.id === 'opus' ? { ...model, name: 'Claude Opus 5.5' } : model)) }
    : one.agentId === 'codex'
      ? { ...one, models: [{ ...one.models[0]!, id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }, ...one.models] }
      : one,
)

const snapshotOf = (): ThreadSnapshot => {
  const { direction } = proto.get()
  const c = proto.current()
  const base = snapshot()
  const first = c.changes.find(open) ?? c.changes[0]
  return snapshot({
    project: { id: 'p1', name: 'althar' },
    host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
    task: {
      ...base.task,
      id: 't1',
      title: c.title,
      slug: 'board-still',
      branch: first?.branch ?? null,
      worktree: c.changes.length === 0 ? null : '/Users/balazs/Althar/althar/board-still',
      phase: c.lane === 'running' ? 'running' : c.lane === 'settled' ? 'settled' : 'ready',
      steps: [],
      changes: c.changes.filter((one) => one.pr !== undefined).map(summaryOf),
      commits: 3,
      actions: ['abandon'],
    },
    ...(base.session === null ? {} : { session: { ...base.session, model: 'opus', turnRunning: false, held: false } }),
    items: itemsOf(c, direction),
  })
}

const { client } = fakeClient({
  listProjects: async () => ({ cursor: 3, projects: [althar] }),
  getRepositories: async () => [repository],
  getHome: async () => home({ projects: [althar], tasks: [] }),
  getModels: async () => withNames,
  getBoard: async () => {
    const c = proto.current()
    const tasks = c.lane === 'scratch' ? others : [caseTask(c), ...others]
    return { cursor: 1, tasks, calls: [], settledTotal: 41 }
  },
  getThread: async () => snapshotOf(),
  getCoordinator: async () => coordinatorSnapshot({ project: { id: 'p1', name: 'althar' }, items: talkOf(proto.current()) }),
})

const host = fakeHost()
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }

// What changed on the page: the screens read again, as on the runtime's word.
let read = ''
proto.subscribe(() => {
  const p = proto.get()
  const now = `${p.direction}/${p.key}/${p.rev}`
  if (now === read) return
  // Another case: the coordinator's conversation is read afresh, with that case's plan card.
  if (read.split('/')[1] !== p.key) void cache.resetQueries({ queryKey: ['coordinator'] })
  read = now
  void cache.invalidateQueries({ queryKey: ['thread'] })
  void cache.invalidateQueries({ queryKey: ['board'] })
})

/* ——— The strip under the window: which direction, which case, which screen; the URL keeps them. ——— */

const DIRECTIONS: ReadonlyArray<Direction> = ['A', 'B', 'C']

const titled = () => {
  const p = proto.get()
  document.title = `${p.direction} · ${VIEWS[p.direction].name} · ${caseOf(p.key).label}`
}

let said = ''
proto.subscribe(() => {
  const p = proto.get()
  const now = `${p.direction}/${p.key}`
  if (now === said) return
  said = now
  titled()
  const params = new URLSearchParams(window.location.search)
  params.set('d', p.direction)
  params.set('s', p.key)
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`)
})

/** The board alone: the project's view pressed once it shows, as the address alone doesn't hold it. */
const toBoard = () => {
  window.location.assign('#/projects/p1?room=board')
  const pressBoard = (tries: number) => {
    const button = [...document.querySelectorAll<HTMLElement>('header [role=radio]')].find((one) => one.textContent?.trim() === 'Board')
    if (button !== undefined) button.click()
    else if (tries > 0) window.setTimeout(() => pressBoard(tries - 1), 100)
  }
  window.setTimeout(() => pressBoard(30), 120)
}

/** Presses the header's switch named so, once it shows: a task's face, or the project's room. */
const pressSwitch = (name: string, tries = 30) => {
  const button = [...document.querySelectorAll<HTMLElement>('header [role=radio]')].find((one) => one.textContent?.trim().startsWith(name))
  if (button !== undefined) button.click()
  else if (tries > 0) window.setTimeout(() => pressSwitch(name, tries - 1), 100)
}

/** The task, on its conversation or its Outputs. */
const toFace = (face: 'talk' | 'out') => {
  chooseFace('t1', face)
  if (!window.location.hash.startsWith('#/threads/th1')) window.location.assign('#/threads/th1')
  window.setTimeout(() => pressSwitch(face === 'out' ? 'Outputs' : 'Conversation'), 120)
}

/** The coordinator's conversation, where the case's plan card is. */
const toPlan = () => {
  window.location.assign('#/projects/p1?room=talk')
  window.setTimeout(() => pressSwitch('Conversation'), 120)
}

const step = (by: number) => {
  const at = CASES.findIndex((one) => one.key === proto.get().key)
  proto.go(CASES[(at + by + CASES.length) % CASES.length]!.key)
}

/** 1 to 3 pick a direction, ← and → step through them, [ and ] through the cases; never while typing, or inside a menu, dialog or list. */
const onKey = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable], [role=menu], [role=dialog], [role=listbox]')) return
  if (event.key.startsWith('Arrow') && target?.closest('[role=radiogroup]')) return
  const at = DIRECTIONS.indexOf(proto.get().direction)
  const picked =
    event.key === 'ArrowRight'
      ? DIRECTIONS[(at + 1) % 3]
      : event.key === 'ArrowLeft'
        ? DIRECTIONS[(at + 2) % 3]
        : /^[1-3]$/.test(event.key)
          ? DIRECTIONS[Number(event.key) - 1]
          : undefined
  if (picked !== undefined) {
    event.preventDefault()
    proto.set({ direction: picked, opening: null })
    return
  }
  if (event.key === ']' || event.key === '[') {
    event.preventDefault()
    step(event.key === ']' ? 1 : -1)
  }
}

function Switcher() {
  const p = useProto()
  if (p.bare) return null
  const c = caseOf(p.key)
  return (
    <div className={css.switcher}>
      <Segmented<Direction>
        label="Direction"
        value={p.direction}
        onChange={(direction) => proto.set({ direction, opening: null })}
        options={DIRECTIONS.map((one, at) => ({
          value: one,
          label: `${one} · ${VIEWS[one].name}`,
          tooltip: { label: VIEWS[one].what, kbd: String(at + 1) },
        }))}
      />
      <Select<string>
        label="Case"
        searchable
        width={330}
        value={p.key}
        onChange={(key) => proto.go(key)}
        options={CASES.map((one) => ({ value: one.key, label: `${one.group}: ${one.label}` }))}
      />
      <LinkButton onClick={toBoard}>Board</LinkButton>
      <LinkButton onClick={() => toFace('talk')}>Task</LinkButton>
      <LinkButton onClick={() => toFace('out')}>Outputs</LinkButton>
      <LinkButton onClick={toPlan}>Plan</LinkButton>
      {proto.touched() && <LinkButton onClick={() => proto.go(p.key)}>Start over</LinkButton>}
      <span className={css.adr} title={c.adr}>
        {c.adr}
      </span>
      <span className={css.grow} />
      <span className={css.keys}>1–3 · [ ]</span>
    </div>
  )
}

export const boot = () => {
  const params = new URLSearchParams(window.location.search)
  const direction = (['A', 'B', 'C'] as const).find((one) => one === params.get('d')?.toUpperCase()) ?? 'A'
  proto.set({ direction, key: caseOf(params.get('s')).key, opening: params.get('open'), bare: params.has('bare') })
  titled()
  window.localStorage.removeItem('althar.tabs')
  // The case's task opens on its conversation, where most of what changes is.
  chooseFace('t1', params.get('face') === 'out' ? 'out' : 'talk')
  if (window.location.hash === '' || window.location.hash === '#/') window.location.hash = '#/threads/th1'
  if (!params.has('bare')) window.addEventListener('keydown', onKey)
  if (window.location.hash.includes('room=board')) toBoard()
  const router = makeRouter({ client, cache })
  const element = document.getElementById('root')
  if (element === null) throw new Error('The page has no #root')
  createRoot(element).render(
    <ServicesProvider value={services}>
      <div className={params.has('bare') ? css.bare : css.frame}>
        <RouterProvider router={router} />
      </div>
      <Switcher />
    </ServicesProvider>,
  )
}
