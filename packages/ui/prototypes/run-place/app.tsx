import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/styles/global.css'
import '../../../../apps/desktop/src/renderer/app.css'

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { ProjectInk } from '../../src/foundations/ProjectMark/drawing'
import { Room } from '../../src/foundations/vocabulary'
import { Brand } from '../../src/foundations/brands/brands'
import { Icon } from '../../src/foundations/Icon/Icon'
import { BrandMark } from '../../src/foundations/Marks/Marks'
import { Button } from '../../src/primitives/Button/Button'
import { Dialog } from '../../src/primitives/Dialog/Dialog'
import { Field } from '../../src/primitives/Field/Field'
import { FormRow } from '../../src/primitives/FormRow/FormRow'
import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { Segmented } from '../../src/primitives/Segmented/Segmented'
import { RunButton, type RunTarget } from '../../src/chrome/RunButton/RunButton'
import { ProjectHeader } from '../../src/chrome/ProjectHeader/ProjectHeader'
import { cx } from '../../src/lib/cx'
import css from './page.module.css'
import {
  type Defaults,
  type Direction,
  DIRECTION_BLURBS,
  DIRECTION_NAMES,
  HOST,
  projectOf,
  type PullRequest,
  type Repository,
  type Task,
} from './data'
import { labelOf, type Picks, placeOf, RunPlacePrototype } from './picker'

/* ——— The URL says what the page shows, so a screenshot can open it again. ——— */

const directionOf = (word: string | null): Direction => (word === 'A' || word === 'C' ? word : 'B')
const defaultsOf = (word: string | null): Defaults => (word === 'same' || word === 'single' ? word : 'mixed')

const picksOf = (word: string | null): Picks => {
  const picks: Record<string, ReturnType<typeof placeOf>> = {}
  for (const part of (word ?? '').split(',').filter(Boolean)) {
    const at = part.indexOf('=')
    if (at < 1) continue
    const repository = part.slice(0, at)
    const place = part.slice(at + 1)
    picks[repository] = place.startsWith('!')
      ? { kind: 'pull', branch: '', number: Number(place.slice(1)) }
      : { kind: 'branch', branch: place }
  }
  return picks
}

interface State {
  readonly direction: Direction
  readonly defaults: Defaults
  readonly hostConnected: boolean
  readonly taskId: string | null
  readonly picks: Picks
  readonly open: boolean
}

const params = new URLSearchParams(window.location.search)

const initial: State = {
  direction: directionOf(params.get('d')),
  defaults: defaultsOf(params.get('s')),
  hostConnected: params.get('host') === 'on',
  taskId: params.get('task'),
  picks: picksOf(params.get('pick')),
  open: params.get('open') === '1',
}

/** Where a repository runs when a task is on show: its worktree if the task touches it, else nowhere. */
const taskPlaceOf = (repository: Repository, task: Task) =>
  task.repositories.includes(repository.id)
    ? { branch: task.branch, command: repository.runnable?.command ?? 'nothing to run', where: 'its worktree' }
    : { branch: '—', command: 'not in this task', where: '' }

function App() {
  const [state, setState] = useState<State>(initial)
  const [connecting, setConnecting] = useState(false)
  const [token, setToken] = useState('')
  const { repositories, tasks } = projectOf(state.defaults)
  const task = tasks.find((one) => one.id === state.taskId) ?? null
  const picks: Picks = Object.fromEntries(
    Object.entries(state.picks).filter(([id]) => repositories.some((repository) => repository.id === id)),
  )
  const single = repositories.length === 1

  const set = (next: Partial<State>) => setState((was) => ({ ...was, ...next }))
  const go = (direction: Direction) => set({ direction })
  const pickRepoBranch = (repository: Repository, branch: string) => {
    const next: Record<string, ReturnType<typeof placeOf>> = { ...picks }
    if (branch === repository.defaultBranch) delete next[repository.id]
    else next[repository.id] = { kind: 'branch', branch }
    set({ picks: next, taskId: null })
  }
  const pickRepoPull = (repository: Repository, pull: PullRequest) =>
    set({
      picks: { ...picks, [repository.id]: { kind: 'pull', branch: pull.branch, number: pull.number, title: pull.title } },
      taskId: null,
    })
  const reset = () => set({ picks: {}, taskId: null })

  // The URL keeps the direction, the scenario, the host and anything picked, so a link opens it as it was.
  useEffect(() => {
    const next = new URLSearchParams(window.location.search)
    next.set('d', state.direction)
    next.set('s', state.defaults)
    next.set('host', state.hostConnected ? 'on' : 'off')
    if (state.open) next.set('open', '1')
    else next.delete('open')
    if (state.taskId === null) next.delete('task')
    else next.set('task', state.taskId)
    const present = projectOf(state.defaults).repositories
    const written = Object.entries(state.picks)
      .filter(([id]) => present.some((repository) => repository.id === id))
      .map(([id, pick]) => `${id}=${pick.kind === 'pull' ? `!${pick.number}` : pick.branch}`)
      .join(',')
    if (written === '') next.delete('pick')
    else next.set('pick', written)
    window.history.replaceState(null, '', `${window.location.pathname}?${next.toString()}${window.location.hash}`)
  }, [state])

  // 1–3 pick a direction, 4–6 a project, h the host; never while typing or inside the dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable], [role=dialog]')) return
      if (event.key === 'h' || event.key === 'H') {
        event.preventDefault()
        setState((was) => ({ ...was, hostConnected: !was.hostConnected }))
        return
      }
      if (!/^[1-6]$/.test(event.key)) return
      event.preventDefault()
      const at = Number(event.key)
      if (at <= 3) set({ direction: (['A', 'B', 'C'] as const)[at - 1]! })
      else set({ defaults: (['mixed', 'same', 'single'] as const)[at - 4]! })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.title = `${state.direction} · ${DIRECTION_NAMES[state.direction]} · Run’s place`
  }, [state.direction])

  const targets: RunTarget[] = repositories
    .filter((repository) => repository.runnable !== null)
    .filter((repository) => task === null || task.repositories.includes(repository.id))
    .map((repository) => ({
      id: `${repository.id}:${labelOf(placeOf(repository, picks))}`,
      name: `${repository.name} · ${repository.runnable!.name}`,
      command: repository.runnable!.command,
      from: 'repository',
    }))

  const rows = repositories.map((repository) => {
    const place = task === null ? null : taskPlaceOf(repository, task)
    const pick = placeOf(repository, picks)
    return {
      repository,
      branch: place === null ? labelOf(pick) : place.branch,
      command: place === null ? (repository.runnable?.command ?? 'nothing to run') : place.command,
      where:
        place === null
          ? repository.runnable === null
            ? ''
            : repository.runnable.port === null
              ? 'a window'
              : `localhost:${repository.runnable.port}`
          : place.where,
      changed: place === null && picks[repository.id] !== undefined,
      pull: place === null && pick.kind === 'pull',
    }
  })

  return (
    <div className={css.root}>
      <ProjectHeader
        name="fnt"
        seed="fnt"
        ink={ProjectInk.Clay}
        room={Room.Board}
        onRoom={() => {}}
        inProgress={2}
        parts={repositories.map((repository) => ({ id: repository.id, name: repository.name, brand: Brand.GitLab }))}
        run={
          <div className={css.run}>
            <RunPlacePrototype
              direction={state.direction}
              repositories={repositories}
              tasks={tasks}
              picks={picks}
              task={task}
              hostConnected={state.hostConnected}
              hostName={HOST}
              open={state.open}
              onOpenChange={(open) => set({ open })}
              onPickBranch={pickRepoBranch}
              onPickPull={pickRepoPull}
              onPickTask={(one) => set({ taskId: one.id, picks: {} })}
              onReset={reset}
              onConnect={() => setConnecting(true)}
            />
            <RunButton targets={targets} onRun={() => {}} onStop={() => {}} onOpen={() => {}} onAdd={() => {}} onEdit={() => {}} />
          </div>
        }
      />

      <main className={css.body}>
        <div className={css.layout}>
          <section className={css.lead}>
            <div className={css.tag}>
              <span className={css.tagLetter}>{state.direction}</span>
              <span>{DIRECTION_NAMES[state.direction]}</span>
              {state.direction === 'B' && <span className={css.tagChosen}>Chosen</span>}
            </div>
            <p className={css.blurb}>
              {single ? 'One repository: nothing to tell apart, so the picker stays as it is today.' : DIRECTION_BLURBS[state.direction]}
            </p>
            <p className={css.scenario}>
              {state.defaults === 'mixed'
                ? 'Five repositories, three defaults: main, develop, master.'
                : state.defaults === 'same'
                  ? 'Five repositories, all on main.'
                  : 'engine alone, on main.'}
              {state.defaults !== 'single' && (state.hostConnected ? ' GitLab is connected.' : ` ${HOST} is not connected.`)}
            </p>
            <div className={css.legend}>
              <span className={css.legendItem}>
                <span className={css.legendDot} /> Picked, and where new tasks work toward
              </span>
              <span className={css.legendItem}>
                <Icon name="branch" size={11} /> Default branch
              </span>
            </div>
          </section>

          <section className={css.preview} aria-label="Where each run starts">
            <header className={css.previewHead}>
              <h2 className={css.previewTitle}>Where each run starts</h2>
            </header>
            <ul className={css.rows}>
              {rows.map(({ repository, branch, command, where, changed: moved, pull }) => (
                <li key={repository.id} className={css.row}>
                  <BrandMark brand={Brand.GitLab} size={12} className={css.rowMark} />
                  <span className={css.rowName}>
                    <span className={css.rowRepo}>{repository.name}</span>{' '}
                    <span className={cx(css.rowBranch, css.mono, moved && css.moved)}>
                      {pull ? <Icon name="pr" size={10} className={css.inlineGlyph} /> : null}
                      {branch}
                    </span>
                  </span>
                  <span className={css.rowWhere}>{where}</span>
                  <span className={css.rowCommand}>{command}</span>
                </li>
              ))}
            </ul>
            <p className={css.previewNote}>
              {task === null
                ? 'Run starts one thing at a time, each in a fresh copy of its repository’s branch. Nothing moves in your checkouts.'
                : 'The task’s worktree holds a copy of each repository it touches; the rest are left as they are.'}
            </p>
          </section>
        </div>
      </main>

      <div className={css.strip}>
        <Segmented<Direction>
          label="Direction"
          value={state.direction}
          onChange={go}
          options={[
            { value: 'A', label: 'A · Name in place', tooltip: { label: DIRECTION_NAMES.A, kbd: '1' } },
            { value: 'B', label: 'B · By repository', tooltip: { label: DIRECTION_NAMES.B, kbd: '2' } },
            { value: 'C', label: 'C · Run board', tooltip: { label: DIRECTION_NAMES.C, kbd: '3' } },
          ]}
        />
        <Segmented<Defaults>
          label="Defaults"
          value={state.defaults}
          onChange={(defaults) => set({ defaults, taskId: null })}
          options={[
            { value: 'mixed', label: 'Mixed defaults', tooltip: { label: 'Five repositories on main, develop and master', kbd: '4' } },
            { value: 'same', label: 'Shared main', tooltip: { label: 'Five repositories, all on main', kbd: '5' } },
            { value: 'single', label: 'One repository', tooltip: { label: 'engine alone', kbd: '6' } },
          ]}
        />
        <Segmented<'off' | 'on'>
          label="Host"
          value={state.hostConnected ? 'on' : 'off'}
          onChange={(host) => {
            const on = host === 'on'
            setState((was) => ({
              ...was,
              hostConnected: on,
              // A pull request isn't there to run once its host is off.
              picks: on ? was.picks : Object.fromEntries(Object.entries(was.picks).filter(([, pick]) => pick.kind === 'branch')),
            }))
          }}
          options={[
            { value: 'off', label: 'GitLab off', tooltip: { label: `${HOST} is not connected` } },
            { value: 'on', label: 'GitLab on', tooltip: { label: `${HOST} is connected` } },
          ]}
        />
        <span className={css.grow} />
        <span className={css.keys}>1–3 directions · 4–6 projects · h host</span>
        <LinkButton onClick={() => window.open(new URL('./REPORT.md', window.location.href).href, '_blank')}>Report</LinkButton>
      </div>

      {connecting && (
        <Dialog
          title={`Connect ${HOST}`}
          description="Althar reads its merge requests with a token of yours. Nothing else is shared, and the token stays on this Mac."
          onClose={() => setConnecting(false)}
          actions={
            <>
              <Button variant="quiet" onClick={() => setConnecting(false)}>
                Not now
              </Button>
              <Button
                variant="ink"
                onClick={() => {
                  set({ hostConnected: true })
                  setConnecting(false)
                  setToken('')
                }}
              >
                Connect
              </Button>
            </>
          }
        >
          <div className={css.connect}>
            <FormRow label="Host" note="As git reads it." htmlFor="host">
              <Field id="host" value={HOST} readOnly />
            </FormRow>
            <FormRow label="Token" note="A personal access token with api scope." htmlFor="token">
              <Field id="token" type="password" placeholder="glpat-…" value={token} onChange={(event) => setToken(event.target.value)} />
            </FormRow>
          </div>
        </Dialog>
      )}
    </div>
  )
}

const element = document.getElementById('root')
if (element === null) throw new Error('The page has no #root')
createRoot(element).render(<App />)
