import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { type ReactNode, StrictMode, useEffect, useState } from 'react'

import { createRoot } from 'react-dom/client'

import {
  Brand,
  BrandMark,
  Button,
  ChangeSet,
  ChangeState,
  Choices,
  type ContainerChoice,
  Field,
  FieldArea,
  HostReach,
  LinkButton,
  type MapHost,
  type MapRepository,
  ProjectInk,
  RepositoryRole,
  Segmented,
  Select,
  SettingGroup,
  SettingList,
  SettingRow,
  StepTrack,
  TaskStatus,
  TrackerBinding,
  trackOf,
} from '@althar/ui'
import { NewProject, type NewProjectFinding, type NewProjectFolder, ProjectRepositories } from '@althar/ui/screens'

import s from './lab.module.css'

/*
 * The new-project lab (README.md): a project set up in a folder with no
 * remote, on the kit's own screens, with no runtime. A new project is two
 * steps: its name and folders, then where its work goes, its code and its
 * issues. The bars swap the direction (A–C), the folder's state (1–8), what
 * is connected (G) and the theme (T); the line under them says what that
 * folder does in Althar today.
 */

const directions = [
  { key: 'a', label: 'Today' },
  { key: 'b', label: 'Two steps, as choices' },
  { key: 'c', label: 'Two steps, as settings rows' },
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

const setups = [
  { key: 'all', label: 'GitHub, GitLab, Linear' },
  { key: 'github', label: 'GitHub only' },
  { key: 'none', label: 'Nothing yet' },
] as const
type Setup = (typeof setups)[number]['key']

/** What each state does in Althar as it is, whichever direction is shown. */
const today: Record<State, string> = {
  empty:
    'Today: choosing it is refused, “There’s no git repository in tidepool.” New repository… would make ~/code/tidepool/tidepool inside it, a folder deeper than meant.',
  files: 'Today: refused the same way. The only way in is git init in a terminal, then choosing it again.',
  unborn:
    'Today: it’s added and the project is made, then the first task fails to start: git worktree add … fatal: invalid reference: main. Nothing says why.',
  local:
    'Today: works. The row says “no remote”; a task’s outputs say “No code host: this repository has no remote Althar can open a pull request on.” Issues are left to the project’s welcome card.',
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
const GITLAB: MapHost = { id: 'gitlab', name: 'GitLab', brand: Brand.GitLab, reach: HostReach.Connected, account: 'balazs' }
const WHERE = '~/code/tidepool'
const TEAMS: ContainerChoice[] = [
  { id: 'alt', label: 'ALT (Althar)' },
  { id: 'web', label: 'WEB (Website)' },
]

const FILES = [
  { path: 'src/tides.ts', add: 84, del: 0 },
  { path: 'src/main.ts', add: 31, del: 4 },
  { path: 'README.md', add: 12, del: 2 },
]

/* ---- Where its work goes: the second step's choices, the same whichever way they're laid out ---- */

type Code = 'here' | 'github' | 'gitlab'
type Issues = 'linear' | 'host' | 'none'
interface Goes {
  code: Code
  owner: string
  name: string
  visibility: 'private' | 'public'
  issues: Issues
  team: ContainerChoice | null
}
const HOSTS: Record<Exclude<Code, 'here'>, { name: string; brand: Brand; changes: string; issues: string; owners: string[] }> = {
  github: { name: 'GitHub', brand: Brand.GitHub, changes: 'pull requests', issues: 'GitHub Issues', owners: ['balazs', 'charrette'] },
  gitlab: {
    name: 'GitLab',
    brand: Brand.GitLab,
    changes: 'merge requests',
    issues: 'GitLab issues',
    owners: ['balazs', 'charrette-group'],
  },
}
const codeHosts = (setup: Setup): ReadonlyArray<Exclude<Code, 'here'>> =>
  setup === 'all' ? ['github', 'gitlab'] : setup === 'github' ? ['github'] : []
const linear = (setup: Setup) => setup === 'all'

/** What's chosen before the person chooses: this Mac for the code, and the tracker their other projects use, else none. */
const firstGoes = (setup: Setup): Goes => ({
  code: codeHosts(setup).find((one) => one === params.get('code')) ?? 'here',
  owner: 'balazs',
  name: 'tidepool',
  visibility: 'private',
  issues: linear(setup) ? 'linear' : 'none',
  team: linear(setup) ? (TEAMS[0] ?? null) : null,
})

/** Where its code goes on a host: owner, name, and who can see it. */
function HostRepo({ goes, onChange }: { goes: Goes; onChange: (next: Partial<Goes>) => void }) {
  if (goes.code === 'here') return null
  const host = HOSTS[goes.code]
  return (
    <div className={s.hostRepo}>
      <span className={s.fieldLabel}>On {host.name}</span>
      <Select
        label="Owner"
        variant="filled"
        width={160}
        value={goes.owner}
        options={host.owners.map((owner) => ({ value: owner, label: owner }))}
        onChange={(owner) => onChange({ owner })}
      />
      <span className={s.slash}>/</span>
      <Field aria-label="Name" value={goes.name} spellCheck={false} onChange={(event) => onChange({ name: event.target.value })} />
      <Segmented
        label="Who can see it"
        value={goes.visibility}
        options={[
          { value: 'private', label: 'Private' },
          { value: 'public', label: 'Public' },
        ]}
        onChange={(visibility) => onChange({ visibility })}
      />
    </div>
  )
}

/** B: each as a choice with a line on what it means. */
function GoesChoices({ setup, goes, onChange }: { setup: Setup; goes: Goes; onChange: (next: Partial<Goes>) => void }) {
  const hosts = codeHosts(setup)
  const onHost = goes.code === 'here' ? null : HOSTS[goes.code]
  const issues = [
    ...(linear(setup) ? [{ value: 'linear' as const, title: 'Linear · Charrette', note: 'Drafts are filed in one of its teams.' }] : []),
    ...(onHost === null
      ? []
      : [{ value: 'host' as const, title: `${onHost.issues}, on ${goes.owner}/${goes.name}`, note: 'Beside its code.' }]),
    { value: 'none' as const, title: 'None for now', note: 'Its settings can link one later.' },
  ]
  return (
    <div className={s.goes}>
      <section className={s.goesPart}>
        <h3 className={s.partTitle}>Code</h3>
        <Choices
          label="Where its code goes"
          value={goes.code}
          onChange={(code) => onChange({ code, ...(code === 'here' && goes.issues === 'host' ? { issues: 'none' } : {}) })}
          options={[
            { value: 'here', title: 'Only on this Mac', note: 'Tasks merge into main here. Its settings can put it on a host later.' },
            ...hosts.map((id) => ({
              value: id,
              title: `A new repository on ${HOSTS[id].name}`,
              note: `Made and pushed as the project is. Tasks open ${HOSTS[id].changes} there.`,
            })),
          ]}
        />
        <HostRepo goes={goes} onChange={onChange} />
        {setup !== 'all' && (
          <p className={s.connectLine}>
            <LinkButton>{setup === 'none' ? 'Connect GitHub, GitLab or Bitbucket' : 'Connect GitLab or Bitbucket'}</LinkButton>
          </p>
        )}
      </section>
      <section className={s.goesPart}>
        <h3 className={s.partTitle}>Issues</h3>
        <Choices label="Where its issues go" value={goes.issues} onChange={(next) => onChange({ issues: next })} options={issues} />
        {goes.issues === 'linear' && (
          <div className={s.hostRepo}>
            <span className={s.fieldLabel}>Linear team</span>
            <Select
              label="Team"
              variant="filled"
              width={200}
              value={goes.team?.id ?? null}
              options={TEAMS.map((team) => ({ value: team.id, label: team.label }))}
              onChange={(id) => onChange({ team: TEAMS.find((team) => team.id === id) ?? null })}
            />
          </div>
        )}
        {!linear(setup) && (
          <p className={s.connectLine}>
            <LinkButton>Connect Linear, Jira or Trello</LinkButton>
          </p>
        )}
      </section>
    </div>
  )
}

/** C: the same, as the project's settings will show it, row by row. */
function GoesRows({ setup, goes, onChange }: { setup: Setup; goes: Goes; onChange: (next: Partial<Goes>) => void }) {
  const hosts = codeHosts(setup)
  const onHost = goes.code === 'here' ? null : HOSTS[goes.code]
  const trackers = [
    ...(linear(setup) ? [{ id: 'linear', label: 'Linear · Charrette', brand: Brand.Linear }] : []),
    ...(onHost === null ? [] : [{ id: 'host', label: `${onHost.issues} · ${goes.owner}/${goes.name}`, brand: onHost.brand }]),
  ]
  return (
    <div className={s.goes}>
      <SettingGroup
        title="Code"
        headingLevel={3}
        {...(setup === 'all' ? {} : { action: <LinkButton>{setup === 'none' ? 'Connect a host' : 'Connect another host'}</LinkButton> })}
      >
        <SettingList>
          <SettingRow
            title="Goes to"
            note={onHost === null ? 'Tasks merge into main on this Mac' : `A new repository; tasks open ${onHost.changes} there`}
            {...(onHost === null ? {} : { mark: <BrandMark brand={onHost.brand} size={18} /> })}
            {...(onHost === null
              ? {}
              : {
                  under: (
                    <div className={s.under}>
                      <HostRepo goes={goes} onChange={onChange} />
                    </div>
                  ),
                })}
          >
            {() => (
              <Select
                label="Goes to"
                value={goes.code}
                options={[
                  { value: 'here', label: 'Only this Mac' },
                  ...hosts.map((id) => ({ value: id, label: `${HOSTS[id].name} · balazs` })),
                ]}
                onChange={(code) => onChange({ code, ...(code === 'here' && goes.issues === 'host' ? { issues: 'none' } : {}) })}
              />
            )}
          </SettingRow>
        </SettingList>
      </SettingGroup>
      <SettingGroup title="Issues" headingLevel={3} {...(linear(setup) ? {} : { action: <LinkButton>Connect a tracker</LinkButton> })}>
        <SettingList>
          <TrackerBinding
            trackers={trackers}
            value={goes.issues === 'none' ? null : goes.issues}
            container={goes.issues === 'linear' ? goes.team : null}
            containers={goes.issues === 'linear' ? TEAMS : []}
            onChange={(id) => onChange({ issues: id === null ? 'none' : (id as Issues) })}
            onContainer={(team) => onChange({ team })}
            text={{ learned: 'None for now', note: 'Where drafts are filed and issues found' }}
          />
        </SettingList>
      </SettingGroup>
    </div>
  )
}

/* ---- The first step: its name and folders, each read for what it is ---- */

const row = (fact?: ReactNode, host?: Code): NewProjectFolder => ({
  id: 'tidepool',
  name: 'tidepool',
  where: WHERE,
  host: host === undefined || host === 'here' ? null : { name: HOSTS[host].name, brand: HOSTS[host].brand },
  remote: null,
  ...(fact === undefined ? {} : { fact }),
})

const FACT: Partial<Record<State, string>> = { empty: 'empty folder', files: 'not a git repository yet', unborn: 'no commits yet' }

const folderFor = (state: State, direction: Direction, code: Code): ReadonlyArray<NewProjectFolder> => {
  if (direction === 'a') return state === 'unborn' || state === 'local' || state === 'project' ? [row()] : []
  if (state === 'unreadable') return []
  return [row(FACT[state], code)]
}

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
  const git = (words: string): NewProjectFinding => ({ id: 'git', kind: 'note', icon: 'branch', words })
  switch (state) {
    case 'empty':
      return [git('Althar makes it a git repository on main, with an empty first commit.')]
    case 'files':
      return [git('Althar makes it a git repository on main, and commits its 14 files first.')]
    case 'unborn':
      return [git('Althar commits its 14 files on main first, for tasks to start from.')]
    default:
      return []
  }
}

/** An empty folder's own row: what it's for, which its first task starts from. */
function DescribeRow({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className={s.extra}>
      <span className={s.extraLabel}>What you’re making</span>
      <FieldArea
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="A small web app that shows the next high and low tides for a stretch of coast, from public tide tables."
      />
      <p className={s.extraNote}>Its first task sets it up from this: the code to start from, and how its tasks run.</p>
    </div>
  )
}

const STEPS = ['Name and folders', 'Code and issues']

function NewProjectScene({
  state,
  direction,
  setup,
  step,
  onStep,
  onOpen,
}: {
  state: State
  direction: Direction
  setup: Setup
  step: 1 | 2
  onStep: (step: 1 | 2) => void
  onOpen: () => void
}) {
  const [name, setName] = useState('Tidepool')
  const [ink, setInk] = useState<ProjectInk>(ProjectInk.Teal)
  const [describe, setDescribe] = useState('')
  const [goes, setGoes] = useState<Goes>(() => firstGoes(setup))
  useEffect(() => setGoes(firstGoes(setup)), [setup])
  const change = (next: Partial<Goes>) => setGoes((now) => ({ ...now, ...next }))
  const walk = direction !== 'a'
  const second = walk && step === 2
  const folders = folderFor(state, direction, second ? goes.code : 'here')
  const refused = direction === 'a' && (state === 'empty' || state === 'files' || state === 'unreadable')
  const error = refused
    ? 'There’s no git repository in tidepool.'
    : state === 'unreadable'
      ? 'Althar can’t read tidepool: macOS keeps it from opening the folder. Check it in Finder’s Get Info, then choose it again.'
      : undefined
  const host = goes.code === 'here' ? null : HOSTS[goes.code]
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
      onCreate={() => (walk && step === 1 ? onStep(2) : undefined)}
      onCancel={() => undefined}
      {...(error === undefined || second ? {} : { error })}
      {...(walk && step === 1 && state === 'empty' ? { extra: <DescribeRow value={describe} onChange={setDescribe} /> } : {})}
      {...(walk
        ? {
            track: (
              <StepTrack
                steps={trackOf(STEPS, step - 1)}
                status={TaskStatus.Running}
                labels
                className={s.track}
                text={{ label: 'Steps' }}
              />
            ),
          }
        : {})}
      {...(second
        ? {
            body:
              direction === 'b' ? (
                <GoesChoices setup={setup} goes={goes} onChange={change} />
              ) : (
                <GoesRows setup={setup} goes={goes} onChange={change} />
              ),
            back: (
              <Button variant="quiet" onClick={() => onStep(1)}>
                Back
              </Button>
            ),
          }
        : {})}
      text={{
        ...(second ? { folders: 'Where its work goes' } : {}),
        ...(walk && step === 1 ? { create: () => 'Continue', createUnnamed: 'Continue' } : {}),
        ...(second && host !== null ? { create: (n: string) => `Create ${n} and its ${host.name} repository` } : {}),
      }}
    />
  )
}

/* ---- The project once it's made ---- */

function ProjectScene({ state, direction, setup }: { state: State; direction: Direction; setup: Setup }) {
  const [added, setAdded] = useState<Code>(state === 'remote' ? 'github' : 'here')
  useEffect(() => setAdded(state === 'remote' ? 'github' : 'here'), [state])
  const host = added === 'here' ? null : added === 'github' ? GITHUB : GITLAB
  const repo: MapRepository = {
    id: 'tidepool',
    name: 'tidepool',
    where: WHERE,
    branch: 'main',
    role: RepositoryRole.Frontend,
    tasks: 1,
    ...(host === null ? {} : { remote: { host: host.id, path: 'balazs/tidepool', href: `https://${host.id}.com/balazs/tidepool` } }),
  }
  const prs = [{ repo: 'tidepool', files: FILES }]
  const noop = () => undefined
  const hostName = host?.name ?? ''
  const merged = (
    <ChangeSet
      state={ChangeState.Merged}
      prs={prs}
      note={
        host !== null
          ? direction === 'a'
            ? 'Into main on this Mac. origin doesn’t have it yet.'
            : `Into main on this Mac. ${hostName} doesn’t have it yet.`
          : direction === 'a'
            ? 'Into main on this Mac. It has no remote to push to.'
            : 'Merged into main.'
      }
      {...(host !== null
        ? { actions: <Button variant="signal">{direction === 'a' ? 'Push main to origin' : `Push main to ${hostName}`}</Button> }
        : {})}
    />
  )
  const branch = (
    <ChangeSet
      state={ChangeState.Branch}
      branch="althar/tide-table"
      prs={prs}
      {...(host !== null ? { remote: { name: 'origin', pushed: true, ahead: 0 } } : {})}
      {...(host === null && direction === 'a'
        ? { note: 'No code host: this repository has no remote Althar can open a pull request on.' }
        : {})}
      actions={
        host !== null ? (
          <>
            <Button variant="signal">{added === 'gitlab' ? 'Open a draft merge request' : 'Open a draft pull request'}</Button>
            <Button>Merge into main on this Mac</Button>
          </>
        ) : (
          <Button variant="signal">{direction === 'a' ? 'Merge into main on this Mac' : 'Merge into main'}</Button>
        )
      }
    />
  )
  const offered = codeHosts(setup)
  return (
    <div className={s.project}>
      <div className={s.sheet}>
        <ProjectRepositories
          project="Tidepool"
          repositories={[repo]}
          hosts={host === null ? [] : [host]}
          worktrees="~/Althar/tidepool"
          onRoleChange={noop}
          onTargetChange={noop}
          onLeaveOut={noop}
          onOpen={noop}
          onConnect={noop}
          onAdd={noop}
        />
        {direction !== 'a' && host === null && (
          <div className={s.remoteRow}>
            {offered.map((id) => (
              <Button key={id} size="small" onClick={() => setAdded(id)}>
                Put tidepool on {HOSTS[id].name}…
              </Button>
            ))}
            <LinkButton onClick={() => setAdded('github')}>Add a remote by its address</LinkButton>
          </div>
        )}
        {direction !== 'a' && host !== null && (
          <div className={s.remoteRow}>
            <span>
              balazs/tidepool on {hostName}. main is pushed; tasks open {added === 'gitlab' ? 'merge requests' : 'pull requests'} there from
              now on.
            </span>
          </div>
        )}
      </div>
      <div className={s.outputs}>
        <div>
          <p className={s.where}>A task, done</p>
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
  const [setup, setSetup] = useState<Setup>(pick(setups, params.get('c'), 'all'))
  const [step, setStep] = useState<1 | 2>(params.get('step') === '2' ? 2 : 1)
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', direction)
    url.searchParams.set('s', state)
    url.searchParams.set('c', setup)
    url.searchParams.set('step', String(step))
    url.searchParams.set('theme', theme)
    history.replaceState(null, '', url)
  }, [direction, state, setup, step, theme])
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
      if (key === 'g') return setSetup((now) => setups[(setups.findIndex((one) => one.key === now) + 1) % setups.length]?.key ?? 'all')
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
          <ProjectScene key={`${state}-${direction}`} state={state} direction={direction} setup={setup} />
        ) : (
          <NewProjectScene
            state={state}
            direction={direction}
            setup={setup}
            step={direction === 'a' ? 1 : step}
            onStep={setStep}
            onOpen={() => setState('working')}
          />
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
          {direction !== 'a' && !inProject && (
            <>
              {([1, 2] as const).map((n) => (
                <button key={n} type="button" aria-pressed={step === n} onClick={() => setStep(n)}>
                  Step {n}
                </button>
              ))}
            </>
          )}
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
        <div className={s.bar}>
          <span className={s.barName}>Connected</span>
          {setups.map((one) => (
            <button key={one.key} type="button" aria-pressed={setup === one.key} onClick={() => setSetup(one.key)}>
              {one.label}
            </button>
          ))}
          <kbd>G</kbd>
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
