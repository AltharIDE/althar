import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { type ReactNode, StrictMode, useEffect, useRef, useState } from 'react'

import { createRoot } from 'react-dom/client'

import {
  Brand,
  Button,
  CanState,
  type ConnectCan,
  ChangeSet,
  ChangeState,
  ConnectActions,
  ConnectCard,
  ConnectChecks,
  ConnectFound,
  ConnectText,
  ConnectWays,
  type ConnectWayOption,
  Field,
  FieldArea,
  HostReach,
  LinkButton,
  type MapHost,
  type MapRepository,
  ProjectInk,
  ProjectMark,
  RepositoryRole,
  Segmented,
  Select,
} from '@althar/ui'
import { NewProject, type NewProjectFinding, type NewProjectFolder, type NewProjectPlace, ProjectRepositories } from '@althar/ui/screens'

import { SizeMotion } from '../../../../packages/ui/src/lib/SizeMotion'
import s from './lab.module.css'

/*
 * The new-project lab (README.md): a project set up in a folder with no
 * remote, on the kit's own screens, with no runtime. Its name and folders
 * first, on the page as it is; then where its work goes, as Althar's own
 * walks into GitHub, GitLab and Linear go: one card at a time, each with
 * the service's mark and one thing to do, gliding from one to the next.
 * The bars swap the direction (A–C), the folder's state (1–8), what is
 * connected (G) and the theme (T); the line under them says what that
 * folder does in Althar today.
 */

const directions = [
  { key: 'a', label: 'Today' },
  { key: 'b', label: 'A card a question' },
  { key: 'c', label: 'Ready in one press' },
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
    'Today: works. The row says “no remote”; a task’s outputs say “No code host”. A host and a tracker are asked later, on a card in the project’s first conversation.',
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

const WHERE = '~/code/tidepool'
const FILES = [
  { path: 'src/tides.ts', add: 84, del: 0 },
  { path: 'src/main.ts', add: 31, del: 4 },
  { path: 'README.md', add: 12, del: 2 },
]

/* ---- The services, as connected ---- */

type Host = 'github' | 'gitlab'
type Code = Host | 'here'
interface HostInfo {
  name: string
  brand: Brand
  thing: string
  changes: string
  issues: string
  owners: string[]
  seen: Array<{ value: string; label: string }>
  ways: ConnectWayOption[]
}
const HOST: Record<Host, HostInfo> = {
  github: {
    name: 'GitHub',
    brand: Brand.GitHub,
    thing: 'repository',
    changes: 'pull requests',
    issues: 'GitHub Issues',
    owners: ['balazs', 'charrette'],
    seen: [
      { value: 'private', label: 'Private' },
      { value: 'public', label: 'Public' },
    ],
    ways: [
      { id: 'browser', title: 'Continue with GitHub', line: 'Approve in your browser', brand: Brand.GitHub },
      { id: 'gh', title: 'Use gh’s sign-in', line: 'Signed in as balazs on this Mac', icon: 'terminal' },
      { id: 'token', title: 'Make a token', line: 'On GitHub’s token page, opened filled in', icon: 'lock' },
    ],
  },
  gitlab: {
    name: 'GitLab',
    brand: Brand.GitLab,
    thing: 'project',
    changes: 'merge requests',
    issues: 'GitLab issues',
    owners: ['balazs', 'charrette-group'],
    seen: [
      { value: 'private', label: 'Private' },
      { value: 'internal', label: 'Internal' },
      { value: 'public', label: 'Public' },
    ],
    ways: [
      { id: 'browser', title: 'Continue with GitLab', line: 'Approve in your browser', brand: Brand.GitLab },
      { id: 'glab', title: 'Use glab’s sign-in', line: 'Signed in as balazs on this Mac', icon: 'terminal' },
      { id: 'server', title: 'A company’s own server', line: 'By its address', icon: 'globe' },
    ],
  },
}
const hostsOf = (setup: Setup): ReadonlyArray<Host> => (setup === 'all' ? ['github', 'gitlab'] : setup === 'github' ? ['github'] : [])

interface Team {
  id: string
  key: string
  name: string
  fresh?: boolean
}
const TEAMS: Team[] = [
  { id: 'new', key: 'TID', name: 'Tidepool', fresh: true },
  { id: 'alt', key: 'ALT', name: 'Althar' },
  { id: 'web', key: 'WEB', name: 'Website' },
]
const NEW_TEAM = TEAMS[0] as Team
const OPEN: Record<string, number> = { alt: 212, web: 38 }

type Issues = 'linear' | 'host' | 'none'
interface Goes {
  code: Code
  owner: string
  name: string
  seen: string
  issues: Issues
  team: Team
}

/** What's chosen before anyone chooses: where the person's last project went, so one press can take it all. */
const firstGoes = (setup: Setup, linear: boolean): Goes => {
  const host = hostsOf(setup)[0]
  return {
    code: host ?? 'here',
    owner: 'balazs',
    name: 'tidepool',
    seen: 'private',
    issues: linear ? 'linear' : host !== undefined ? 'host' : 'none',
    team: NEW_TEAM,
  }
}

interface Pager {
  steps: number
  at: number
}
const pagerOf = (pager?: Pager) => (pager === undefined ? {} : { pager })

/* ---- The walk's cards ---- */

type Card = 'code' | 'connect' | 'host' | 'issues' | 'tracker' | 'team' | 'ready'

/** Where its code lives: each host connected, this Mac, and a way to connect another. */
function CodeCard({ setup, goes, pager, onPick }: { setup: Setup; goes: Goes; pager?: Pager; onPick: (id: string) => void }) {
  const more = setup === 'none' ? 'GitHub or GitLab' : setup === 'github' ? 'GitLab' : null
  return (
    <ConnectCard icon="branch" title="Where its code lives" {...pagerOf(pager)}>
      <ConnectWays
        label="Where its code lives"
        onChoose={onPick}
        ways={[
          ...hostsOf(setup).map((id) => ({
            id,
            title: HOST[id].name,
            line: `New ${HOST[id].thing} · ${goes.owner}/${goes.name}`,
            brand: HOST[id].brand,
          })),
          { id: 'here', title: 'Only on this Mac', line: 'Tasks merge into main here', icon: 'folder' as const },
          ...(more === null ? [] : [{ id: 'connect', title: `Connect ${more}`, line: 'Then make it there', icon: 'plug' as const }]),
        ]}
      />
    </ConnectCard>
  )
}

/** Connecting a host from inside the walk: the same card as its walk in Settings, its ways in first. */
function ConnectHostCard({ host, onPick, onBack }: { host: Host; onPick: () => void; onBack: () => void }) {
  const h = HOST[host]
  return (
    <ConnectCard
      brand={h.brand}
      title={`Connect ${h.name}`}
      line="For Tidepool’s code"
      foot={`Kept encrypted on this Mac. Agents never get it; they reach ${h.name} through Althar.`}
    >
      <ConnectWays label={`Ways to connect ${h.name}`} ways={h.ways} onChoose={onPick} />
      <ConnectActions>
        <LinkButton onClick={onBack}>Back</LinkButton>
      </ConnectActions>
    </ConnectCard>
  )
}

/** Its new repository on the host, as the host's own form asks: owner, name, who sees it. */
function HostCard({
  host,
  goes,
  pager,
  onChange,
  onDone,
  onBack,
  done,
  back = 'Somewhere else',
  align,
}: {
  host: Host
  goes: Goes
  pager?: Pager
  onChange: (next: Partial<Goes>) => void
  onDone: () => void
  onBack: () => void
  done: string
  back?: string
  /** Set in a page, from its left edge, as Settings has it. */
  align?: 'start'
}) {
  const h = HOST[host]
  const name = goes.name.trim()
  const taken = name === 'althar' || name === 'tides'
  const fine = name !== '' && !taken && /^[A-Za-z0-9._-]+$/.test(name)
  return (
    <ConnectCard brand={h.brand} title={`New ${h.thing} on ${h.name}`} {...pagerOf(pager)} {...(align === undefined ? {} : { align })}>
      <form
        className={s.hostForm}
        onSubmit={(event) => {
          event.preventDefault()
          if (fine) onDone()
        }}
      >
        <div className={s.ownerName}>
          <Select
            label="Owner"
            variant="filled"
            width={150}
            value={goes.owner}
            options={h.owners.map((owner) => ({ value: owner, label: owner }))}
            onChange={(owner) => onChange({ owner })}
          />
          <span className={s.slash}>/</span>
          <Field
            aria-label={`${h.name} ${h.thing} name`}
            value={goes.name}
            spellCheck={false}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </div>
        {name === '' ? null : taken ? (
          <ConnectFound tone="no">
            {goes.owner}/{name} is taken.
          </ConnectFound>
        ) : fine ? (
          <ConnectFound>
            {goes.owner}/{name} is free.
          </ConnectFound>
        ) : (
          <ConnectFound tone="no">Letters, numbers, - . and _ only.</ConnectFound>
        )}
        <Segmented label="Who can see it" value={goes.seen} options={h.seen} onChange={(seen) => onChange({ seen })} />
        <ConnectText tone="note">Althar pushes main to it, and tasks open {h.changes} there.</ConnectText>
        <ConnectActions primary>
          <Button type="submit" variant="signal" disabled={!fine}>
            {done}
          </Button>
        </ConnectActions>
      </form>
      <ConnectActions>
        <LinkButton onClick={onBack}>{back}</LinkButton>
      </ConnectActions>
    </ConnectCard>
  )
}

/** Where its issues go: the trackers connected, the host's own issues where its code goes there, or not now. */
function IssuesCard({ linear, goes, pager, onPick }: { linear: boolean; goes: Goes; pager?: Pager; onPick: (id: string) => void }) {
  const host = goes.code === 'here' ? null : HOST[goes.code]
  return (
    <ConnectCard icon="issues" title="Where its issues go" {...pagerOf(pager)}>
      <ConnectWays
        label="Where its issues go"
        onChoose={onPick}
        ways={[
          ...(linear ? [{ id: 'linear', title: 'Linear', line: 'Charrette · a new team, or one of 2', brand: Brand.Linear }] : []),
          ...(host === null ? [] : [{ id: 'host', title: host.issues, line: `On ${goes.owner}/${goes.name}`, brand: host.brand }]),
          ...(linear ? [] : [{ id: 'tracker', title: 'Connect Linear, Jira or Trello', line: 'Then choose where', icon: 'plug' as const }]),
          { id: 'none', title: 'Not now', line: 'Its settings can link one later', icon: 'after' as const },
        ]}
      />
    </ConnectCard>
  )
}

/** Connecting a tracker from inside the walk, as Settings does. */
function ConnectTrackerCard({ onPick, onBack }: { onPick: () => void; onBack: () => void }) {
  return (
    <ConnectCard icon="issues" title="Connect a tracker" line="For Tidepool’s issues">
      <ConnectWays
        label="Trackers to connect"
        onChoose={onPick}
        ways={[
          { id: 'linear', title: 'Linear', line: 'Approve in your browser', brand: Brand.Linear },
          { id: 'jira', title: 'Jira', line: 'With an API token', brand: Brand.Jira },
          { id: 'trello', title: 'Trello', line: 'With a key and a token', brand: Brand.Trello },
        ]}
      />
      <ConnectActions>
        <LinkButton onClick={onBack}>Back</LinkButton>
      </ConnectActions>
    </ConnectCard>
  )
}

/** Linear's teams: a new one named after the project, or one there is. */
function TeamCard({ pager, onPick, onBack }: { pager?: Pager; onPick: (team: Team) => void; onBack: () => void }) {
  return (
    <ConnectCard brand={Brand.Linear} title="Choose a team" line="In Charrette" {...pagerOf(pager)}>
      <ConnectWays
        label="Linear teams"
        onChoose={(id) => onPick(TEAMS.find((team) => team.id === id) ?? NEW_TEAM)}
        ways={TEAMS.map((team) =>
          team.fresh === true
            ? { id: team.id, title: `New team: ${team.name}`, line: `Its issues ${team.key}-1, ${team.key}-2…`, icon: 'plus' as const }
            : { id: team.id, title: team.name, line: `${team.key} · ${OPEN[team.id] ?? 0} open issues`, icon: 'issues' as const },
        )}
      />
      <ConnectActions>
        <LinkButton onClick={onBack}>Back</LinkButton>
      </ConnectActions>
    </ConnectCard>
  )
}

/** What making it does, each line ticked as it's done. */
const planOf = (state: State, goes: Goes): ConnectCan[] => {
  const host = goes.code === 'here' ? null : HOST[goes.code]
  const can = (id: string, text: string, fact?: ReactNode): ConnectCan => ({
    id,
    text,
    state: CanState.Waiting,
    ...(fact === undefined ? {} : { fact }),
  })
  return [
    ...(state === 'empty' || state === 'files' ? [can('init', 'Make tidepool a git repository', 'main')] : []),
    ...(state === 'files' || state === 'unborn' ? [can('commit', 'Commit its 14 files')] : []),
    ...(state === 'empty' ? [can('commit', 'Make its first commit')] : []),
    ...(host === null ? [] : [can('host', `Make ${goes.owner}/${goes.name} on ${host.name}`, goes.seen), can('push', 'Push main')]),
    ...(goes.issues === 'linear'
      ? [
          goes.team.fresh === true
            ? can('team', 'Make the Linear team Tidepool', goes.team.key)
            : can('team', `Link Linear’s ${goes.team.name}`, goes.team.key),
        ]
      : []),
    can('project', 'Make Tidepool'),
  ]
}

/** The last card: where it all goes, each a press away from its own card, and Create; then each line ticking as it's made. */
function ReadyCard({
  state,
  ink,
  goes,
  pager,
  making,
  made,
  onEdit,
  onCreate,
  onOpen,
}: {
  state: State
  ink: ProjectInk
  goes: Goes
  pager?: Pager
  making: number | null
  made: boolean
  onEdit: (id: 'code' | 'issues') => void
  onCreate: () => void
  onOpen: () => void
}) {
  const host = goes.code === 'here' ? null : HOST[goes.code]
  const mark = <ProjectMark seed="prj_tidepool" ink={ink} size={pager === undefined ? 52 : 40} />
  if (making !== null) {
    const plan = planOf(state, goes).map((line, at) => ({
      ...line,
      state: at < making ? CanState.Can : at === making ? CanState.Checking : CanState.Waiting,
    }))
    return (
      <ConnectCard picture={mark} title={made ? 'Tidepool is ready' : 'Making Tidepool'} done={made} {...pagerOf(pager)}>
        <ConnectChecks label="Making Tidepool" items={plan} />
        {made && (
          <ConnectActions primary>
            <Button variant="signal" onClick={onOpen} data-first>
              Open Tidepool
            </Button>
          </ConnectActions>
        )}
      </ConnectCard>
    )
  }
  const code: ConnectWayOption =
    host === null
      ? { id: 'code', title: 'Only on this Mac', line: 'Tasks merge into main here', icon: 'folder' }
      : { id: 'code', title: `${goes.owner}/${goes.name}`, line: `New ${goes.seen} ${host.thing} on ${host.name}`, brand: host.brand }
  const issues: ConnectWayOption =
    goes.issues === 'linear'
      ? {
          id: 'issues',
          title: goes.team.fresh === true ? `Linear · new team ${goes.team.key}` : `Linear · ${goes.team.name}`,
          line: 'Its issues and drafts go there',
          brand: Brand.Linear,
        }
      : goes.issues === 'host' && host !== null
        ? { id: 'issues', title: host.issues, line: `On ${goes.owner}/${goes.name}`, brand: host.brand }
        : { id: 'issues', title: 'No tracker yet', line: 'Its settings can link one later', icon: 'issues' }
  return (
    <ConnectCard picture={mark} title="Create Tidepool" {...pagerOf(pager)}>
      <ConnectWays label="Where its work goes" onChoose={(id) => onEdit(id as 'code' | 'issues')} ways={[code, issues]} />
      <ConnectActions primary>
        <Button variant="signal" kbd="⌘↵" onClick={onCreate} data-first>
          Create Tidepool
        </Button>
      </ConnectActions>
    </ConnectCard>
  )
}

/* ---- The first step: its name and folders, each read for what it is ---- */

const FACT: Partial<Record<State, string>> = { empty: 'empty folder', files: 'not a git repository yet', unborn: 'no commits yet' }

const folderFor = (state: State, direction: Direction): ReadonlyArray<NewProjectFolder> => {
  const row = (fact?: string): NewProjectFolder => ({
    id: 'tidepool',
    name: 'tidepool',
    where: WHERE,
    host: null,
    remote: null,
    ...(fact === undefined ? {} : { fact }),
  })
  if (direction === 'a') return state === 'unborn' || state === 'local' || state === 'project' ? [row()] : []
  if (state === 'unreadable') return []
  return [row(FACT[state])]
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
            words: 'tidepool is Tidepool’s already.',
            action: <LinkButton onClick={open}>Open Tidepool</LinkButton>,
          },
        ]
  if (direction === 'a') return []
  const git = (words: string): NewProjectFinding => ({ id: 'git', kind: 'note', icon: 'branch', words })
  switch (state) {
    case 'empty':
      return [git('Althar makes it a git repository on main.')]
    case 'files':
      return [git('Althar makes it a git repository on main, and commits its 14 files.')]
    case 'unborn':
      return [git('Althar commits its 14 files on main first.')]
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
      <p className={s.extraNote}>Its first task sets it up from this.</p>
    </div>
  )
}

/** Where its work goes, on the left, as it's chosen. */
const placesOf = (goes: Goes, chosen: { code: boolean; issues: boolean }): NewProjectPlace[] => {
  const host = goes.code === 'here' ? null : HOST[goes.code]
  const code: NewProjectPlace =
    host === null
      ? { id: 'code', label: 'Code', value: 'This Mac', icon: 'folder' }
      : { id: 'code', label: 'Code', value: `${goes.owner}/${goes.name}`, brand: host.brand }
  const issues: NewProjectPlace =
    goes.issues === 'linear'
      ? { id: 'issues', label: 'Issues', value: `Linear · ${goes.team.key}`, brand: Brand.Linear }
      : goes.issues === 'host' && host !== null
        ? { id: 'issues', label: 'Issues', value: host.issues, brand: host.brand }
        : { id: 'issues', label: 'Issues', value: 'None yet', icon: 'issues' }
  return [...(chosen.code ? [code] : []), ...(chosen.issues ? [issues] : [])]
}

function NewProjectScene({
  state,
  direction,
  setup: given,
  onOpen,
}: {
  state: State
  direction: Direction
  setup: Setup
  onOpen: () => void
}) {
  const quick = direction === 'c'
  const [name, setName] = useState('Tidepool')
  const [ink, setInk] = useState<ProjectInk>(ProjectInk.Teal)
  const [describe, setDescribe] = useState('')
  // What is connected along the way joins what was connected before.
  const [setup, setSetup] = useState<Setup>(given)
  const [linear, setLinear] = useState(given === 'all')
  const [goes, setGoes] = useState<Goes>(() => firstGoes(given, given === 'all'))
  const opening = direction === 'a' ? null : ((params.get('card') as Card | null) ?? null)
  const [card, setCard] = useState<Card | null>(opening)
  const [trail, setTrail] = useState<Card[]>(opening !== null && opening !== 'code' && !quick ? ['code'] : [])
  const [connecting, setConnecting] = useState<Host>(given === 'github' ? 'gitlab' : 'github')
  const [chosen, setChosen] = useState({
    code: opening === 'issues' || opening === 'team' || opening === 'ready',
    issues: opening === 'ready',
  })
  const [making, setMaking] = useState<number | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearInterval(timer.current)
    },
    [],
  )

  const walking = direction !== 'a' && card !== null
  const plan = planOf(state, goes)
  const made = making !== null && making >= plan.length
  const change = (next: Partial<Goes>) => setGoes((now) => ({ ...now, ...next }))
  const go = (next: Card) => {
    setTrail((now) => (card === null ? now : [...now, card]))
    setCard(next)
  }
  const back = () => {
    if (making !== null) return
    setTrail((now) => now.slice(0, -1))
    setCard(trail.at(-1) ?? null)
  }
  // A card a question: on to the next. Ready in one press: back to the card that says it all.
  const after = (next: Card) => {
    if (!quick) return go(next)
    setTrail([])
    setCard('ready')
  }
  const create = () => {
    if (making !== null) return
    setMaking(0)
    const steps = plan.length
    timer.current = window.setInterval(() => {
      setMaking((now) => {
        const next = (now ?? 0) + 1
        if (next >= steps && timer.current !== null) clearInterval(timer.current)
        return next
      })
    }, 520)
  }

  const pager = (at: number): { pager?: Pager } => (quick ? {} : { pager: { steps: 3, at } })
  const walk = (() => {
    switch (card) {
      case 'code':
        return (
          <CodeCard
            setup={setup}
            goes={goes}
            {...pager(0)}
            onPick={(id) => {
              if (id === 'here') {
                change({ code: 'here', ...(goes.issues === 'host' ? { issues: linear ? 'linear' : 'none' } : {}) })
                setChosen((now) => ({ ...now, code: true }))
                return after('issues')
              }
              if (id === 'connect') return go('connect')
              change({ code: id as Host })
              go('host')
            }}
          />
        )
      case 'connect':
        return (
          <ConnectHostCard
            host={connecting}
            onBack={back}
            onPick={() => {
              setSetup((now) => (now === 'none' ? 'github' : 'all'))
              setConnecting('gitlab')
              change({ code: connecting })
              go('host')
            }}
          />
        )
      case 'host':
        return goes.code === 'here' ? null : (
          <HostCard
            host={goes.code}
            goes={goes}
            {...pager(0)}
            onChange={change}
            done={quick ? 'Done' : 'Continue'}
            onBack={() => (quick ? go('code') : back())}
            onDone={() => {
              setChosen((now) => ({ ...now, code: true }))
              after('issues')
            }}
          />
        )
      case 'issues':
        return (
          <IssuesCard
            linear={linear}
            goes={goes}
            {...pager(1)}
            onPick={(id) => {
              if (id === 'linear') return go('team')
              if (id === 'tracker') return go('tracker')
              change({ issues: id as Issues })
              setChosen((now) => ({ ...now, issues: true }))
              after('ready')
            }}
          />
        )
      case 'tracker':
        return (
          <ConnectTrackerCard
            onBack={back}
            onPick={() => {
              setLinear(true)
              go('team')
            }}
          />
        )
      case 'team':
        return (
          <TeamCard
            {...pager(1)}
            onBack={back}
            onPick={(team) => {
              change({ issues: 'linear', team })
              setChosen((now) => ({ ...now, issues: true }))
              after('ready')
            }}
          />
        )
      case 'ready':
        return (
          <ReadyCard
            state={state}
            ink={ink}
            goes={goes}
            {...pager(2)}
            making={making}
            made={made}
            onEdit={(id) => go(id === 'code' ? (goes.code === 'here' ? 'code' : 'host') : 'issues')}
            onCreate={create}
            onOpen={onOpen}
          />
        )
      default:
        return null
    }
  })()

  // Focus goes to what each card asks first, so Return carries on through it.
  const stage = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!walking) return
    const here = stage.current
    const first =
      here?.querySelector<HTMLElement>('[data-first]') ??
      here?.querySelector<HTMLElement>('input') ??
      here?.querySelector<HTMLElement>('[role="group"] button')
    first?.focus()
  }, [card, walking, made])

  const error =
    direction === 'a' && (state === 'empty' || state === 'files' || state === 'unreadable')
      ? 'There’s no git repository in tidepool.'
      : state === 'unreadable'
        ? 'Althar can’t read tidepool: macOS keeps it from opening the folder. Check it in Finder’s Get Info, then choose it again.'
        : undefined
  return (
    <NewProject
      seed="prj_tidepool"
      name={name}
      onNameChange={setName}
      ink={ink}
      onInkChange={setInk}
      folders={folderFor(state, direction)}
      onRemove={() => undefined}
      onChoose={() => undefined}
      onStartFresh={() => undefined}
      found={{ like: null, first: [], more: [] }}
      onAdd={() => undefined}
      findings={findingsFor(state, direction, onOpen)}
      onCreate={() => {
        if (direction === 'a') return
        if (card === null) {
          if (quick) setChosen({ code: true, issues: true })
          return go(quick ? 'ready' : 'code')
        }
        if (card === 'ready') create()
      }}
      onCancel={() => (walking ? back() : undefined)}
      places={placesOf(goes, chosen)}
      {...(error === undefined ? {} : { error })}
      {...(direction !== 'a' && state === 'empty' ? { extra: <DescribeRow value={describe} onChange={setDescribe} /> } : {})}
      {...(walking
        ? {
            walk: (
              <div ref={stage}>
                <SizeMotion step={`${card ?? ''}${making === null ? '' : '-making'}`}>{walk}</SizeMotion>
              </div>
            ),
          }
        : {})}
      text={direction === 'a' ? {} : { create: () => 'Continue', createUnnamed: 'Continue' }}
    />
  )
}

/* ---- The project once it's made ---- */

const GITHUB: MapHost = { id: 'github', name: 'GitHub', brand: Brand.GitHub, reach: HostReach.Connected, account: 'balazs' }

function ProjectScene({ state, direction, setup }: { state: State; direction: Direction; setup: Setup }) {
  const [added, setAdded] = useState(state === 'remote')
  const [putting, setPutting] = useState<Host | null>(null)
  const [goes, setGoes] = useState<Goes>(() => firstGoes(setup, false))
  const host = added ? GITHUB : null
  const repo: MapRepository = {
    id: 'tidepool',
    name: 'tidepool',
    where: WHERE,
    branch: 'main',
    role: RepositoryRole.Frontend,
    tasks: 1,
    ...(host === null
      ? {}
      : { remote: { host: 'github', path: `${goes.owner}/${goes.name}`, href: 'https://github.com/balazs/tidepool' } }),
  }
  const prs = [{ repo: 'tidepool', files: FILES }]
  const noop = () => undefined
  const merged = (
    <ChangeSet
      state={ChangeState.Merged}
      prs={prs}
      note={
        host !== null
          ? direction === 'a'
            ? 'Into main on this Mac. origin doesn’t have it yet.'
            : 'Into main on this Mac. GitHub doesn’t have it yet.'
          : direction === 'a'
            ? 'Into main on this Mac. It has no remote to push to.'
            : 'Merged into main.'
      }
      {...(host !== null
        ? { actions: <Button variant="signal">{direction === 'a' ? 'Push main to origin' : 'Push main to GitHub'}</Button> }
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
          hosts={host === null ? [] : [host]}
          worktrees="~/Althar/tidepool"
          onRoleChange={noop}
          onTargetChange={noop}
          onLeaveOut={noop}
          onOpen={noop}
          onConnect={noop}
          onAdd={noop}
        />
        {direction !== 'a' && !added && putting === null && (
          <div className={s.remoteRow}>
            {hostsOf(setup).map((id) => (
              <Button key={id} size="small" onClick={() => setPutting(id)}>
                Put tidepool on {HOST[id].name}…
              </Button>
            ))}
            <LinkButton>Add a remote by its address</LinkButton>
          </div>
        )}
        {direction !== 'a' && !added && putting !== null && (
          // The same card the new project's walk shows, set in from the settings' left edge.
          <div className={s.inSettings}>
            <HostCard
              host={putting}
              goes={goes}
              onChange={(next) => setGoes((now) => ({ ...now, ...next }))}
              done="Make it and push main"
              back="Cancel"
              align="start"
              onBack={() => setPutting(null)}
              onDone={() => {
                setPutting(null)
                setAdded(true)
              }}
            />
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
  const [state, setState] = useState<State>(pick(states, params.get('s'), 'files'))
  const [setup, setSetup] = useState<Setup>(pick(setups, params.get('c'), 'all'))
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', direction)
    url.searchParams.set('s', state)
    url.searchParams.set('c', setup)
    url.searchParams.set('theme', theme)
    history.replaceState(null, '', url)
  }, [direction, state, setup, theme])
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.closest('[role="group"]') !== null))
        return
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
          <ProjectScene key={`${state}-${direction}-${setup}`} state={state} direction={direction} setup={setup} />
        ) : (
          <NewProjectScene
            key={`${state}-${direction}-${setup}`}
            state={state}
            direction={direction}
            setup={setup}
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
