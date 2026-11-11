import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { type ReactNode, StrictMode, useEffect, useState } from 'react'

import { createRoot } from 'react-dom/client'

import {
  Brand,
  Button,
  ChangeSet,
  ChangeState,
  Choices,
  Field,
  FieldArea,
  HostReach,
  LinkButton,
  type MapHost,
  type MapRepository,
  ProjectInk,
  RepositoryRole,
} from '@althar/ui'
import { NewProject, type NewProjectFinding, type NewProjectFolder, ProjectRepositories } from '@althar/ui/screens'

import s from './lab.module.css'

/*
 * The new-project lab (README.md): a project set up in a folder with no
 * remote, on the kit's own screens, with no runtime. The top bar swaps the
 * direction (A–D), the next the folder's state (1–8), T the theme. The line
 * under them says what that state does in Althar today, for comparing.
 */

const directions = [
  { key: 'a', label: 'Today' },
  { key: 'b', label: 'Quietly, remote later' },
  { key: 'c', label: 'Ask, remote now or not' },
  { key: 'd', label: 'Start from a description' },
] as const
type Direction = (typeof directions)[number]['key']

const states = [
  { key: 'empty', label: 'Empty folder' },
  { key: 'files', label: 'Files, no git' },
  { key: 'unborn', label: 'Git, no commits' },
  { key: 'local', label: 'Git, no remote' },
  { key: 'unreadable', label: 'Can’t be read' },
  { key: 'project', label: 'Already a project' },
  { key: 'working', label: 'In the project' },
  { key: 'remote', label: 'Remote added' },
] as const
type State = (typeof states)[number]['key']

/** What each state does in Althar as it is, whichever direction is shown. */
const today: Record<State, string> = {
  empty:
    'Today: choosing it is refused, “There’s no git repository in tidepool.” New repository… would make ~/code/tidepool/tidepool inside it, a folder deeper than meant.',
  files: 'Today: refused the same way. The only way in is git init in a terminal, then choosing it again.',
  unborn:
    'Today: it’s added and the project is made, then the first task fails to start: git worktree add … fatal: invalid reference: main. Nothing says why.',
  local:
    'Today: works. The row says “no remote”; a task’s outputs say “No code host: this repository has no remote Althar can open a pull request on.”',
  unreadable: 'Today: a folder Althar can’t read is called “There’s no git repository in tidepool.”, the wrong reason.',
  project: 'Today: it’s added again, as a second project on the same folder, with a line saying so. Nothing offers the one there is.',
  working:
    'Today: tasks end on their branch and merge into main on this Mac; the card calls it “No code host”, and once merged “It has no remote to push to.” Settings show “No remote” with no way to add one.',
  remote:
    'Today: a remote added with git remote add is read on the next look; tasks start pushing their branch, and merged work offers a push. Nothing in Althar adds one.',
}

const params = new URLSearchParams(location.search)
const pick = <K extends string>(list: ReadonlyArray<{ key: K }>, value: string | null, fallback: K) =>
  list.find((one) => one.key === value)?.key ?? fallback

const GITHUB: MapHost = { id: 'github', name: 'GitHub', brand: Brand.GitHub, reach: HostReach.Connected, account: 'balazs' }
const BRAND = { name: 'GitHub', brand: Brand.GitHub }
const WHERE = '~/code/tidepool'

const FILES = [
  { path: 'src/tides.ts', add: 84, del: 0 },
  { path: 'src/main.ts', add: 31, del: 4 },
  { path: 'README.md', add: 12, del: 2 },
]
const SETUP_FILES = [
  { path: '.gitignore', add: 6, del: 0 },
  { path: 'package.json', add: 22, del: 0 },
  { path: 'README.md', add: 9, del: 0 },
  { path: 'src/main.ts', add: 18, del: 0 },
  { path: 'tsconfig.json', add: 14, del: 0 },
]

/** The folder's row on the new project's page, as each state reads it. */
const folderFor = (state: State, direction: Direction): ReadonlyArray<NewProjectFolder> => {
  const row = (fact?: ReactNode): NewProjectFolder => ({
    id: 'tidepool',
    name: 'tidepool',
    where: WHERE,
    host: null,
    remote: null,
    ...(fact === undefined ? {} : { fact }),
  })
  if (direction === 'a') return state === 'unborn' || state === 'local' || state === 'project' ? [row()] : []
  switch (state) {
    case 'empty':
      return [row('empty folder')]
    case 'files':
      return [row('not a git repository yet')]
    case 'unborn':
      return [row('no commits yet')]
    case 'local':
    case 'project':
      return [row()]
    default:
      return []
  }
}

/** What reading found, said under the folders. */
const findingsFor = (state: State, direction: Direction, open: () => void): ReadonlyArray<NewProjectFinding> => {
  if (state === 'project')
    return direction === 'a'
      ? [{ id: 'shared', kind: 'shared', name: 'tidepool', project: 'Tidepool' }]
      : [
          {
            id: 'shared',
            kind: 'note',
            icon: 'folder',
            words: 'tidepool is Tidepool’s already. Another project on it shares its folder; their tasks keep apart in worktrees.',
            action: <LinkButton onClick={open}>Open Tidepool</LinkButton>,
          },
        ]
  if (direction === 'a') return []
  const local: NewProjectFinding = {
    id: 'local',
    kind: 'note',
    icon: 'folder',
    words: direction === 'c' ? 'No remote yet.' : 'No remote: tasks merge into main on this Mac.',
  }
  // C asks about the branch and the remote in their own rows under the folders, so only what's found is said here.
  const make = (words: string): NewProjectFinding => ({ id: 'git', kind: 'note', icon: 'branch', words })
  switch (state) {
    case 'empty':
      return direction === 'd'
        ? []
        : [
            make(direction === 'c' ? 'Not a git repository yet.' : 'Althar makes it a git repository on main, with an empty first commit.'),
            local,
          ]
    case 'files':
      return [
        make(
          direction === 'c'
            ? 'Not a git repository yet: 14 files in it.'
            : 'Althar makes it a git repository on main, and commits its 14 files first.',
        ),
        local,
      ]
    case 'unborn':
      return [
        make(direction === 'c' ? 'No commits yet: 14 files in it.' : 'Althar commits its 14 files on main first, for tasks to start from.'),
        local,
      ]
    case 'local':
      return [local]
    default:
      return []
  }
}

/** C's own rows: the first branch, and whether its code goes on GitHub now. */
function AskRows({ state, remote, onRemote }: { state: State; remote: 'here' | 'github'; onRemote: (next: 'here' | 'github') => void }) {
  const [branch, setBranch] = useState('main')
  const fresh = state === 'empty' || state === 'files' || state === 'unborn'
  return (
    <div className={s.extra}>
      {fresh && (
        <label className={s.branchRow}>
          <span className={s.extraLabel}>First branch</span>
          <Field value={branch} onChange={(event) => setBranch(event.target.value)} spellCheck={false} />
        </label>
      )}
      <Choices
        label="Where its code goes"
        value={remote}
        onChange={onRemote}
        options={[
          { value: 'here', title: 'Only on this Mac', note: 'Tasks merge into main here. GitHub can come later, in its settings.' },
          {
            value: 'github',
            title: 'A new private repository on GitHub',
            note: 'balazs/tidepool, made and pushed as the project is. Tasks open pull requests there.',
          },
        ]}
      />
    </div>
  )
}

/** D's own row, for a folder with nothing in it: what it's for, which its first task starts from. */
function DescribeRow({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className={s.extra}>
      <span className={s.extraLabel}>What you’re making</span>
      <FieldArea
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="A small web app that shows the next high and low tides for a stretch of coast, from public tide tables."
      />
      <p className={s.extraNote}>Its first task sets it up: git, the code to start from, and how its tasks run.</p>
    </div>
  )
}

function NewProjectScene({ state, direction, onOpen }: { state: State; direction: Direction; onOpen: () => void }) {
  const [name, setName] = useState('Tidepool')
  const [ink, setInk] = useState<ProjectInk>(ProjectInk.Teal)
  const [remote, setRemote] = useState<'here' | 'github'>('here')
  const [describe, setDescribe] = useState('')
  const folders = folderFor(state, direction)
  const refused = direction === 'a' && (state === 'empty' || state === 'files' || state === 'unreadable')
  const error = refused
    ? 'There’s no git repository in tidepool.'
    : state === 'unreadable'
      ? 'Althar can’t read tidepool: macOS keeps it from opening the folder. Check it in Finder’s Get Info, then choose it again.'
      : undefined
  const extra =
    direction === 'c' && folders.length > 0 && state !== 'project' ? (
      <AskRows state={state} remote={remote} onRemote={setRemote} />
    ) : direction === 'd' && (state === 'empty' || state === 'files') ? (
      <DescribeRow value={describe} onChange={setDescribe} />
    ) : undefined
  return (
    <NewProject
      key={`${state}-${direction}`}
      seed="prj_tidepool"
      name={name}
      onNameChange={setName}
      ink={ink}
      onInkChange={setInk}
      folders={folders}
      onRemove={() => undefined}
      onChoose={() => undefined}
      onStartFresh={() => undefined}
      found={{ like: null, first: [], more: [] }}
      onAdd={() => undefined}
      findings={findingsFor(state, direction, onOpen)}
      onCreate={() => undefined}
      onCancel={() => undefined}
      {...(error === undefined ? {} : { error })}
      {...(extra === undefined ? {} : { extra })}
      text={{
        ...(direction === 'd' && state === 'empty' && describe.trim() !== '' ? { create: (n: string) => `Create ${n} and start` } : {}),
        ...(direction === 'c' && remote === 'github' && folders.length > 0 ? { create: (n: string) => `Create ${n} on GitHub` } : {}),
      }}
    />
  )
}

/** The project once it's made: its repositories in its settings, and a task's outputs, before and after it merges. */
function ProjectScene({ state, direction }: { state: State; direction: Direction }) {
  const [added, setAdded] = useState(state === 'remote')
  useEffect(() => setAdded(state === 'remote'), [state])
  const repo: MapRepository = {
    id: 'tidepool',
    name: 'tidepool',
    where: WHERE,
    branch: 'main',
    role: RepositoryRole.Frontend,
    tasks: 1,
    ...(added ? { remote: { host: 'github', path: 'balazs/tidepool', href: 'https://github.com/balazs/tidepool' } } : {}),
  }
  const setup = direction === 'd'
  const files = setup ? SETUP_FILES : FILES
  const prs = [{ repo: 'tidepool', files }]
  const noop = () => undefined
  const merged = (
    <ChangeSet
      state={ChangeState.Merged}
      prs={prs}
      note={
        added
          ? direction === 'a'
            ? 'Into main on this Mac. origin doesn’t have it yet.'
            : 'Into main on this Mac. GitHub doesn’t have it yet.'
          : direction === 'a'
            ? 'Into main on this Mac. It has no remote to push to.'
            : 'Merged into main.'
      }
      {...(added ? { actions: <Button variant="signal">{direction === 'a' ? 'Push main to origin' : 'Push main to GitHub'}</Button> } : {})}
    />
  )
  const branch = (
    <ChangeSet
      state={ChangeState.Branch}
      branch={setup ? 'althar/set-up-tidepool' : 'althar/tide-table'}
      prs={prs}
      {...(added ? { remote: { name: 'origin', pushed: true, ahead: 0 } } : {})}
      {...(!added && direction === 'a' ? { note: 'No code host: this repository has no remote Althar can open a pull request on.' } : {})}
      actions={
        added ? (
          <>
            <Button variant="signal">Open a draft pull request</Button>
            <Button>Merge into main on this Mac</Button>
          </>
        ) : (
          <Button variant="signal">{direction === 'a' ? 'Merge into main on this Mac' : 'Merge into main'}</Button>
        )
      }
    />
  )
  return (
    <div className={s.project}>
      <div className={s.sheet}>
        <ProjectRepositories
          project="Tidepool"
          repositories={[repo]}
          hosts={added ? [GITHUB] : []}
          worktrees="~/Althar/tidepool"
          onRoleChange={noop}
          onTargetChange={noop}
          onLeaveOut={noop}
          onOpen={noop}
          onConnect={noop}
          onAdd={noop}
        />
        {direction !== 'a' && !added && (
          <div className={s.remoteRow}>
            <Button size="small" onClick={() => setAdded(true)}>
              Put tidepool on GitHub…
            </Button>
            <LinkButton onClick={() => setAdded(true)}>Add a remote by its address</LinkButton>
          </div>
        )}
        {direction !== 'a' && added && state === 'remote' && (
          <div className={s.remoteRow}>
            <span>balazs/tidepool on GitHub. main pushed; tasks open pull requests there from now on.</span>
          </div>
        )}
      </div>
      <div className={s.outputs}>
        <div>
          <p className={s.where}>{setup ? 'Set up Tidepool, done' : 'A task, done'}</p>
          {branch}
        </div>
        <div>
          <p className={s.where}>A task, accepted</p>
          {merged}
        </div>
      </div>
    </div>
  )
}

function Lab() {
  const [direction, setDirection] = useState<Direction>(pick(directions, params.get('d'), 'b'))
  const [state, setState] = useState<State>(pick(states, params.get('s'), 'empty'))
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', direction)
    url.searchParams.set('s', state)
    url.searchParams.set('theme', theme)
    history.replaceState(null, '', url)
  }, [direction, state, theme])
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const d = directions.find((one) => one.key === key)
      if (d !== undefined) return setDirection(d.key)
      const n = Number(key)
      const st = states[n - 1]
      if (Number.isInteger(n) && st !== undefined) return setState(st.key)
      if (key === 't') setTheme((now) => (now === 'dark' ? 'light' : 'dark'))
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])
  const inProject = state === 'working' || state === 'remote'
  return (
    <div className={s.lab}>
      <main className={s.scene}>
        {inProject ? (
          <ProjectScene key={`${state}-${direction}`} state={state} direction={direction} />
        ) : (
          <NewProjectScene state={state} direction={direction} onOpen={() => setState('working')} />
        )}
      </main>
      <nav className={s.bars} aria-label="Lab">
        <div className={s.bar}>
          <span className={s.barName}>Direction</span>
          {directions.map((one) => (
            <button key={one.key} type="button" aria-pressed={direction === one.key} onClick={() => setDirection(one.key)}>
              <kbd>{one.key.toUpperCase()}</kbd>
              {one.label}
            </button>
          ))}
          <span className={s.spacer} />
          <button type="button" onClick={() => setTheme((now) => (now === 'dark' ? 'light' : 'dark'))}>
            <kbd>T</kbd>
            {theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        </div>
        <div className={s.bar}>
          <span className={s.barName}>Folder</span>
          {states.map((one, at) => (
            <button key={one.key} type="button" aria-pressed={state === one.key} onClick={() => setState(one.key)}>
              <kbd>{at + 1}</kbd>
              {one.label}
            </button>
          ))}
        </div>
        <p className={s.caption}>{today[state]}</p>
      </nav>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
)
