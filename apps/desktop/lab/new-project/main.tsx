import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { type CSSProperties, type KeyboardEvent as KeyEvent, type ReactNode, StrictMode, useEffect, useRef, useState } from 'react'

import { createRoot } from 'react-dom/client'

import {
  AltharLine,
  Board,
  BoardColumn,
  BoardEmpty,
  type BoardFolds,
  BoardLane,
  Brand,
  BrandMark,
  Button,
  CanState,
  ChangeSet,
  ChangeState,
  type ConnectCan,
  ConnectActions,
  ConnectCard,
  ConnectChecks,
  ConnectField,
  ConnectFound,
  Composer,
  Field,
  Icon,
  IconButton,
  LinkButton,
  Menu,
  MenuItem,
  Popover,
  ProjectHeader,
  ProjectInk,
  type ProjectPart,
  ProjectTabs,
  Room,
  Segmented,
  Select,
  Spinner,
  TaskFace,
  TaskMark,
  Thread,
  You,
} from '@althar/ui'
import { device } from '@althar/ui/device'
import { NewProject, type NewProjectFolder, repositoryFolder } from '@althar/ui/screens'

import { SizeMotion } from '../../../../packages/ui/src/lib/SizeMotion'
import s from './lab.module.css'

/*
 * The new-project lab (README.md): a project set up on the New project page
 * itself, in the room its side has. Where its code comes from first, a
 * repository on GitHub or GitLab cloned above all, or a folder on this
 * computer, or nothing yet; then git where it has none, where its code lives
 * and where its issues go, each with a choice made already. Create does all
 * of it in place, each part ticking as it is done, and opens the project
 * ready. A–C are three ways of laying the side out; 1–8 the folder Choose a
 * folder finds; G what is connected; T the theme; R starts again.
 */

const directions = [
  { key: 'a', label: 'Your repositories first' },
  { key: 'b', label: 'Three ways in' },
  { key: 'c', label: 'One sheet' },
] as const
type Direction = (typeof directions)[number]['key']

const states = [
  { key: 'none', label: 'Nothing chosen yet' },
  { key: 'empty', label: 'Empty folder' },
  { key: 'files', label: 'Files, no git' },
  { key: 'unborn', label: 'Git, no commits' },
  { key: 'local', label: 'Git, no remote' },
  { key: 'unreadable', label: 'Can’t be read' },
  { key: 'project', label: 'Already a project' },
  { key: 'later', label: 'Later: a task is done' },
] as const
type State = (typeof states)[number]['key']
type FolderKind = Exclude<State, 'none' | 'later'>
const isFolder = (state: State): state is FolderKind => state !== 'none' && state !== 'later'

const setups = [
  { key: 'all', label: 'GitHub, GitLab, Linear' },
  { key: 'github', label: 'GitHub only' },
  { key: 'none', label: 'Nothing yet' },
] as const
type Setup = (typeof setups)[number]['key']

/** What each state does in Althar as it is. */
const today: Record<State, string> = {
  none: 'Today: Choose a folder… takes only a git repository, and New repository… makes an empty one. There’s no clone, and nothing on where its code lives or its issues.',
  empty: 'Today: refused, “There’s no git repository in tidepool.” New repository… would make ~/code/tidepool/tidepool, a folder deeper.',
  files: 'Today: refused the same way. The only way in is git init in a terminal, then choosing it again.',
  unborn: 'Today: the project is made, then its first task fails: git worktree add … fatal: invalid reference: main. Nothing says why.',
  local: 'Today: works, and nothing asks where its code lives; a task’s card says “No code host”, as if something were broken.',
  unreadable: 'Today: called “There’s no git repository in tidepool.”, the wrong reason, with no way to fix it.',
  project: 'Today: it’s added again, as a second project on the same folder.',
  later: 'Today: the card says “No code host”, and once merged “It has no remote to push to.” Nothing in Althar adds one.',
}

const params = new URLSearchParams(location.search)
const pick = <K extends string>(list: ReadonlyArray<{ key: K }>, value: string | null, fallback: K) =>
  list.find((one) => one.key === value)?.key ?? fallback

const here = device.this
const SEED = 'prj_tidepool'
const INK = ProjectInk.Teal
const noop = () => undefined
const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

/* ---- What's connected, and what's on it ---- */

type Host = 'github' | 'gitlab'
const HOST: Record<Host, { name: string; brand: Brand; thing: string; issues: string; changes: string }> = {
  github: { name: 'GitHub', brand: Brand.GitHub, thing: 'repository', issues: 'GitHub Issues', changes: 'pull requests' },
  gitlab: { name: 'GitLab', brand: Brand.GitLab, thing: 'project', issues: 'GitLab issues', changes: 'merge requests' },
}
const hostsOf = (setup: Setup): Host[] => (setup === 'all' ? ['github', 'gitlab'] : setup === 'github' ? ['github'] : [])
const linearOf = (setup: Setup) => setup === 'all'

/** A repository on a host it's connected to. */
interface Repo {
  readonly id: string
  readonly host: Host
  readonly remote: string
  readonly about: string
  readonly lang: string
  readonly ink: ProjectInk
  readonly pushed: string
  readonly open: boolean
  readonly issues: number
  /** Where it is on this computer already: added, not cloned. */
  readonly here?: string
  /** Its group's single sign-on, which cloning waits for. */
  readonly sso?: string
}

/* Most recently pushed first, as the hosts list them. */
const REPOS: readonly Repo[] = [
  {
    id: 'gh-althar',
    host: 'github',
    remote: 'charrette/althar',
    about: 'Agents that ship',
    lang: 'TypeScript',
    ink: ProjectInk.Indigo,
    pushed: '2 hours ago',
    open: false,
    issues: 212,
  },
  {
    id: 'gh-tidepool',
    host: 'github',
    remote: 'balazs/tidepool',
    about: 'Tide tables for the stations near you',
    lang: 'TypeScript',
    ink: ProjectInk.Indigo,
    pushed: 'yesterday',
    open: false,
    issues: 12,
  },
  {
    id: 'gl-infra',
    host: 'gitlab',
    remote: 'charrette/infra',
    about: 'Terraform for all of it',
    lang: 'HCL',
    ink: ProjectInk.Plum,
    pushed: 'yesterday',
    open: false,
    issues: 4,
    sso: 'charrette',
  },
  {
    id: 'gh-meridian',
    host: 'github',
    remote: 'charrette/meridian',
    about: 'Invoices and payments',
    lang: 'TypeScript',
    ink: ProjectInk.Indigo,
    pushed: '3 days ago',
    open: false,
    issues: 31,
    here: '~/code/meridian',
  },
  {
    id: 'gh-site',
    host: 'github',
    remote: 'charrette/site',
    about: 'charrette.studio',
    lang: 'Astro',
    ink: ProjectInk.Ochre,
    pushed: '3 days ago',
    open: true,
    issues: 3,
  },
  {
    id: 'gl-tidepool-ios',
    host: 'gitlab',
    remote: 'charrette/tidepool-ios',
    about: 'Tidepool for iPhone',
    lang: 'Swift',
    ink: ProjectInk.Clay,
    pushed: 'last week',
    open: false,
    issues: 7,
  },
  {
    id: 'gh-dotfiles',
    host: 'github',
    remote: 'balazs/dotfiles',
    about: '',
    lang: 'Shell',
    ink: ProjectInk.Moss,
    pushed: 'in March',
    open: true,
    issues: 0,
  },
]
const CLONES_INTO = '~/Althar'
const nameOf = (remote: string) => remote.split('/').at(-1) ?? remote

/** A repository's URL, pasted: one of the listed, or any other on GitHub or GitLab. */
const repoOfUrl = (typed: string): Repo | null => {
  const found = /^(?:https?:\/\/|git@)?(github\.com|gitlab\.com)[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(typed.trim())
  if (found === null) return null
  const host: Host = found[1]?.toLowerCase() === 'gitlab.com' ? 'gitlab' : 'github'
  const remote = found[2] ?? ''
  return (
    REPOS.find((r) => r.host === host && r.remote === remote) ?? {
      id: `url-${remote}`,
      host,
      remote,
      about: 'From its URL',
      lang: '',
      ink: ProjectInk.Slate,
      pushed: '',
      open: true,
      issues: 0,
    }
  )
}

const TEAMS = [
  { value: 'new', label: 'A new team, Tidepool (TID)' },
  { value: 'alt', label: 'Althar (ALT)' },
  { value: 'web', label: 'Web (WEB)' },
] as const
type Team = (typeof TEAMS)[number]['value']

/* ---- The setup: where its code comes from, where it lives, where its issues go; Create does it ---- */

type Door = 'clone' | 'folder' | 'new'
type Source = { kind: 'none' } | { kind: 'repo'; repo: Repo } | { kind: 'folder'; folder: FolderKind } | { kind: 'new' }
type Home = Host | 'here'
type Issues = 'linear' | 'host' | 'none'
type Part = 'source' | 'home' | 'issues'
type Status = 'idle' | 'waiting' | 'doing' | 'done'
interface Task {
  readonly part: Part
  readonly text: string
  readonly ms: number
}

/** What Create made, for the project it opens. */
interface Done {
  readonly lines: readonly string[]
  readonly host: Host | null
}

const whereOf = (folder: FolderKind) => (folder === 'unreadable' ? '~/Documents/tidepool' : '~/code/tidepool')

/** What git is in the folder, as its card says it. */
const gitWords: Record<Exclude<FolderKind, 'unreadable' | 'project'>, string> = {
  empty: 'Empty. Git starts in it on main, with an empty first commit.',
  files: 'No git yet. It starts on main, with its 14 files as the first commit and a .gitignore.',
  unborn: 'Git, with no commits yet. Its 14 files become the first, on main.',
  local: 'Git on main, 214 commits, no remote.',
}

function useSetup({
  state,
  setup,
  name,
  onName,
  start,
  ink,
  onDone,
}: {
  state: State
  setup: Setup
  name: string
  onName: (name: string) => void
  start: 'none' | 'like'
  ink: ProjectInk
  onDone: (done: Done) => void
}) {
  const hosts = hostsOf(setup)
  const slug = repositoryFolder(name)
  const like = (repo: Repo) => slug !== '' && nameOf(repo.remote).includes(slug)
  const [source, setSource] = useState<Source>(() => {
    if (isFolder(state)) return { kind: 'folder', folder: state }
    const found = start === 'like' ? REPOS.find((r) => hosts.includes(r.host) && like(r) && r.sso === undefined) : undefined
    return found === undefined ? { kind: 'none' } : { kind: 'repo', repo: found }
  })
  const [door, setDoor] = useState<Door>(isFolder(state) ? 'folder' : 'clone')
  const [home, setHome] = useState<Home>(hosts[0] ?? 'here')
  const [owner, setOwner] = useState('balazs')
  const [repoName, setRepoName] = useState(slug === '' ? 'tidepool' : slug)
  const [visible, setVisible] = useState<'private' | 'public'>('private')
  const [issuesPick, setIssuesPick] = useState<Issues | null>(null)
  const [team, setTeam] = useState<Team>('new')
  const [at, setAt] = useState<number | null>(null)
  const [failed, setFailed] = useState<ReactNode>(null)

  const repo = source.kind === 'repo' ? source.repo : null
  const codeHost: Host | null = repo !== null ? repo.host : home === 'here' ? null : home
  const remote = repo?.remote ?? `${owner}/${repoName}`
  const folderName = repo === null ? 'tidepool' : nameOf(repo.remote)
  const where =
    repo === null ? (source.kind === 'folder' ? whereOf(source.folder) : '~/code/tidepool') : (repo.here ?? `${CLONES_INTO}/${folderName}`)
  const issueWays: Issues[] = [...(linearOf(setup) ? ['linear' as const] : []), ...(codeHost === null ? [] : ['host' as const]), 'none']
  const issuesDefault: Issues = repo !== null && repo.issues > 0 ? 'host' : linearOf(setup) ? 'linear' : 'none'
  const issues = issuesPick !== null && issueWays.includes(issuesPick) ? issuesPick : issuesDefault
  const blocked = source.kind === 'folder' && (source.folder === 'unreadable' || source.folder === 'project')
  const teamName = TEAMS.find((t) => t.value === team)?.label ?? ''

  const tasks: Task[] = []
  if (repo !== null && repo.here === undefined) tasks.push({ part: 'source', text: `Cloning ${repo.remote} into ${where}`, ms: 1700 })
  if (source.kind === 'folder' && source.folder === 'files')
    tasks.push({ part: 'source', text: 'Starting git on main', ms: 500 }, { part: 'source', text: 'Committing its 14 files', ms: 600 })
  if (source.kind === 'folder' && source.folder === 'empty') tasks.push({ part: 'source', text: 'Starting git on main', ms: 600 })
  if (source.kind === 'folder' && source.folder === 'unborn')
    tasks.push({ part: 'source', text: 'Committing its 14 files on main', ms: 600 })
  if (source.kind === 'new') tasks.push({ part: 'source', text: 'Making ~/code/tidepool, with git on main', ms: 600 })
  if (repo === null && codeHost !== null)
    tasks.push(
      { part: 'home', text: `Creating ${remote} on ${HOST[codeHost].name}`, ms: 800 },
      { part: 'home', text: `Pushing main to ${remote}`, ms: 700 },
    )
  if (issues === 'linear')
    tasks.push({
      part: 'issues',
      text: team === 'new' ? 'Making the Linear team Tidepool (TID)' : `Linking it to ${teamName} in Linear`,
      ms: 700,
    })
  if (issues === 'host' && codeHost !== null) tasks.push({ part: 'issues', text: `Taking its issues from ${remote}`, ms: 500 })

  /** What Create made, said once in the project. */
  const linesOf = (): string[] => {
    const lines: string[] = []
    if (repo !== null)
      lines.push(
        repo.here === undefined
          ? `Cloned ${repo.remote} from ${HOST[repo.host].name} into ${where}, on main. Tasks open ${HOST[repo.host].changes} there.`
          : `Added ${repo.here}, ${repo.remote} on ${HOST[repo.host].name}. Tasks open ${HOST[repo.host].changes} there.`,
      )
    if (source.kind === 'folder' && source.folder === 'files')
      lines.push('Started git in tidepool on main, with its 14 files as the first commit.')
    if (source.kind === 'folder' && source.folder === 'empty') lines.push('Started git in tidepool on main, with an empty first commit.')
    if (source.kind === 'folder' && source.folder === 'unborn') lines.push('Committed tidepool’s 14 files on main.')
    if (source.kind === 'new') lines.push('Made ~/code/tidepool, with git on main.')
    if (repo === null)
      lines.push(
        codeHost === null
          ? `tidepool is only on ${here}: finished work merges into main here.`
          : `Made ${remote} on ${HOST[codeHost].name}, ${visible}, and pushed main. Tasks open ${HOST[codeHost].changes} there.`,
      )
    if (issues === 'linear')
      lines.push(team === 'new' ? 'Its issues are in Linear, in a new team, Tidepool (TID).' : `Its issues are in Linear, in ${teamName}.`)
    if (issues === 'host' && codeHost !== null)
      lines.push(`Its issues are on ${HOST[codeHost].name}${repo !== null && repo.issues > 0 ? `, ${repo.issues} open` : ''}.`)
    return lines
  }

  // Create runs its tasks one after another; each part ticks as its own are done.
  const latest = useRef({ tasks, repo, finish: () => onDone({ lines: linesOf(), host: codeHost }) })
  useEffect(() => {
    latest.current = { tasks, repo, finish: () => onDone({ lines: linesOf(), host: codeHost }) }
  })
  useEffect(() => {
    if (at === null) return
    const now = latest.current
    if (at >= now.tasks.length) {
      const id = setTimeout(() => now.finish(), 650)
      return () => clearTimeout(id)
    }
    const task = now.tasks[at]
    if (task === undefined) return
    const failing = now.repo
    if (task.part === 'source' && failing !== null && failing.sso !== undefined) {
      const sso = failing.sso
      const id = setTimeout(() => {
        setAt(null)
        setFailed(
          <>
            {HOST[failing.host].name} wants you signed in to {sso} before {failing.remote} can be cloned.{' '}
            <LinkButton>Sign in to {sso}</LinkButton>
          </>,
        )
      }, 900)
      return () => clearTimeout(id)
    }
    const id = setTimeout(() => setAt(at + 1), task.ms)
    return () => clearTimeout(id)
  }, [at])

  const status = (part: Part): Status => {
    if (at === null) return 'idle'
    const mine = tasks.flatMap((task, i) => (task.part === part ? [i] : []))
    if (mine.length === 0) return at >= tasks.length ? 'done' : 'waiting'
    if (mine.every((i) => i < at)) return 'done'
    return mine.includes(at) ? 'doing' : 'waiting'
  }
  const running = at !== null

  const choose = (next: Source) => {
    setFailed(null)
    setSource(next)
    if (next.kind === 'repo' && name.trim() === '') {
      const n = nameOf(next.repo.remote)
      onName(n.charAt(0).toUpperCase() + n.slice(1))
    }
  }

  const folders: NewProjectFolder[] =
    repo !== null
      ? [{ id: repo.id, name: folderName, where, host: { name: HOST[repo.host].name, brand: HOST[repo.host].brand }, remote: repo.remote }]
      : source.kind === 'folder'
        ? [{ id: 'tidepool', name: 'tidepool', where, host: null, remote: null }]
        : source.kind === 'new'
          ? [{ id: 'new', fresh: true, name: 'tidepool', where }]
          : []

  // What Create will do, in the foot; while it does it, what it's doing.
  const doing = [
    repo === null ? null : repo.here === undefined ? `clones ${repo.remote}` : `adds ${repo.here}`,
    source.kind === 'folder' && source.folder !== 'local' ? 'starts git' : null,
    source.kind === 'new' ? 'makes a new repository' : null,
    repo === null && codeHost !== null ? `creates ${remote} on ${HOST[codeHost].name}` : null,
    issues === 'linear' ? (team === 'new' ? 'makes a Linear team' : 'links Linear') : null,
    issues === 'host' && codeHost !== null ? `takes its ${HOST[codeHost].name} issues` : null,
  ].filter((part): part is string => part !== null)
  const said =
    doing.length === 0
      ? ''
      : `${doing
          .join(', ')
          .replace(/^./, (c) => c.toUpperCase())
          .replace(/, ([^,]*)$/, ' and $1')}.`
  const footNote =
    at !== null
      ? `${tasks[at]?.text ?? 'Opening Tidepool'}…`
      : source.kind === 'none' || blocked
        ? undefined
        : `${said}${repo === null && codeHost === null ? ` Its code stays on ${here}.` : ''}`.trim()

  return {
    hosts,
    setup,
    ink,
    like,
    source,
    choose,
    door,
    setDoor: (next: Door) => {
      setDoor(next)
      choose(
        next === 'new'
          ? { kind: 'new' }
          : next === 'folder'
            ? isFolder(state)
              ? { kind: 'folder', folder: state }
              : { kind: 'none' }
            : source.kind === 'repo'
              ? source
              : { kind: 'none' },
      )
    },
    chooseFolder: () => choose({ kind: 'folder', folder: isFolder(state) ? state : 'files' }),
    repo,
    codeHost,
    remote,
    where,
    home,
    setHome,
    owner,
    setOwner,
    repoName,
    setRepoName,
    visible,
    setVisible,
    issues,
    issueWays,
    setIssues: setIssuesPick,
    team,
    setTeam,
    running,
    status,
    folders,
    footNote,
    failed,
    create: () => {
      if (running) return
      if (blocked) {
        setFailed(
          source.kind === 'folder' && source.folder === 'project' ? (
            <>
              tidepool is Tidepool already. <LinkButton>Open Tidepool</LinkButton>
            </>
          ) : (
            <>
              Althar can’t read tidepool. <LinkButton>Allow in System Settings</LinkButton>
            </>
          ),
        )
        return
      }
      setFailed(null)
      setAt(0)
    },
  }
}
type SetupState = ReturnType<typeof useSetup>

/* ---- The pieces each layout draws it with ---- */

/** A part of the setup, with how it's going once Create is pressed. */
function Section({ title, status, children }: { title: string; status: Status; children: ReactNode }) {
  return (
    <section className={s.section} aria-busy={status === 'doing' || undefined}>
      <header className={s.sectionHead}>
        <h3 className={s.sectionTitle}>{title}</h3>
        <StatusMark status={status} />
      </header>
      {children}
    </section>
  )
}

function StatusMark({ status }: { status: Status }) {
  if (status === 'doing') return <Spinner size="small" />
  if (status === 'done')
    return (
      <span className={s.tick} title="Done" aria-hidden="true">
        <Icon name="check" size={10} />
      </span>
    )
  return null
}

/** One of a few, as a row: its mark, what it is, and once chosen, what it needs. */
function Pick({
  checked,
  onChoose,
  mark,
  title,
  note,
  children,
}: {
  checked: boolean
  onChoose: () => void
  mark: ReactNode
  title: string
  note?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={cx(s.pick, checked && s.pickOn)}>
      <button type="button" role="radio" aria-checked={checked} className={s.pickHead} onClick={onChoose}>
        <span className={s.dot} aria-hidden="true" />
        <span className={s.pickMark}>{mark}</span>
        <span className={s.pickTitle}>{title}</span>
        {note !== undefined && <span className={s.pickNote}>{note}</span>}
      </button>
      {checked && children !== undefined && <div className={s.pickMore}>{children}</div>}
    </div>
  )
}

/** Something it could use, not connected yet. */
function ConnectRow({ brand, title, note, onConnect }: { brand: Brand; title: string; note: string; onConnect: () => void }) {
  return (
    <div className={s.connectRow}>
      <span className={s.dotless} aria-hidden="true" />
      <span className={s.pickMark}>
        <BrandMark brand={brand} size={16} />
      </span>
      <span className={s.pickTitle}>{title}</span>
      <span className={s.pickNote}>{note}</span>
      <Button size="small" onClick={onConnect}>
        Connect
      </Button>
    </div>
  )
}

/** A new repository's owner, name and who can see it. */
function HostFields({ S }: { S: SetupState }) {
  return (
    <div className={s.hostFields}>
      <Select
        variant="filled"
        label="Owner"
        width={124}
        value={S.owner}
        onChange={S.setOwner}
        options={[
          { value: 'balazs', label: 'balazs' },
          { value: 'charrette', label: 'charrette' },
        ]}
      />
      <span className={s.slash}>/</span>
      <Field
        aria-label="Name"
        value={S.repoName}
        onChange={(event) => S.setRepoName(event.target.value)}
        spellCheck={false}
        className={s.nameField}
      />
      <Segmented
        label="Who can see it"
        value={S.visible}
        onChange={S.setVisible}
        options={[
          { value: 'private', label: 'Private' },
          { value: 'public', label: 'Public' },
        ]}
      />
    </div>
  )
}

/** Your repositories on the hosts it's connected to, those named like the project first: each chosen in a press. */
function Repositories({ S, height, onConnect }: { S: SetupState; height: number; onConnect: (host: Host) => void }) {
  const [typed, setTyped] = useState('')
  const [only, setOnly] = useState<'all' | Host>('all')
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const pasted = repoOfUrl(typed)
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean)
  const listed =
    pasted === null
      ? REPOS.filter(
          (r) =>
            S.hosts.includes(r.host) &&
            (only === 'all' || r.host === only) &&
            words.every((w) => `${r.remote} ${r.about} ${r.lang}`.toLowerCase().includes(w)),
        )
      : [pasted]
  const shown = [...listed.filter(S.like), ...listed.filter((r) => !S.like(r))]
  const chosen = S.repo?.id
  const rows = () => Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[data-row]') ?? [])
  const onField = (event: KeyEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      rows()[0]?.focus()
    } else if (event.key === 'Enter' && shown[0] !== undefined) {
      event.preventDefault()
      S.choose({ kind: 'repo', repo: shown[0] })
    }
  }
  const onRow = (event: KeyEvent<HTMLButtonElement>) => {
    const all = rows()
    const at = all.indexOf(event.currentTarget)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      ;(event.key === 'ArrowDown' ? all[at + 1] : at === 0 ? field.current : all[at - 1])?.focus()
    }
  }
  return (
    <div className={s.repos}>
      <div className={s.reposBar}>
        <label className={s.find}>
          <Icon name="search" size={14} />
          <input
            ref={field}
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={onField}
            aria-label="Find a repository, or paste its URL"
            placeholder={S.hosts.length === 0 ? 'Paste a repository’s URL' : 'Find a repository, or paste its URL'}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        {S.hosts.length > 1 && (
          <Segmented
            label="Which host"
            value={only}
            onChange={setOnly}
            options={[
              { value: 'all', label: 'All' },
              { value: 'github', label: 'GitHub' },
              { value: 'gitlab', label: 'GitLab' },
            ]}
          />
        )}
      </div>
      {S.hosts.length === 0 && pasted === null ? (
        <div className={s.connectHosts} style={{ height }}>
          {(['github', 'gitlab'] as const).map((id) => (
            <div key={id} className={s.connectHost}>
              <BrandMark brand={HOST[id].brand} size={28} />
              <span className={s.connectHostName}>{HOST[id].name}</span>
              <span className={s.connectHostNote}>Your repositories there, each cloned in a press</span>
              <Button size="small" variant="signal" onClick={() => onConnect(id)}>
                Connect {HOST[id].name}
              </Button>
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className={s.reposQuiet} style={{ height }}>
          None match “{typed}”.
        </p>
      ) : (
        <ul ref={list} className={s.repoList} style={{ height }} aria-label="Repositories">
          {shown.map((repo) => {
            const [owner, name] = repo.remote.split('/')
            const on = chosen === repo.id
            return (
              <li key={repo.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  data-row
                  className={cx(s.repo, S.like(repo) && s.repoLike, on && s.repoOn)}
                  onClick={() => S.choose({ kind: 'repo', repo })}
                  onKeyDown={onRow}
                >
                  <span className={s.repoMark}>
                    <BrandMark brand={HOST[repo.host].brand} size={20} />
                  </span>
                  <span className={s.repoMain}>
                    <span className={s.repoName}>
                      <span>
                        <span className={s.owner}>{owner}/</span>
                        {name}
                      </span>
                      {!repo.open && <Icon name="lock" size={11} />}
                      {S.like(repo) && <span className={s.likeTag}>Named like the project</span>}
                    </span>
                    <span className={s.repoFacts}>
                      {repo.about !== '' && <span className={s.about}>{repo.about}</span>}
                      {repo.lang !== '' && (
                        <span className={s.lang}>
                          <i style={{ background: `var(--project-${repo.ink})` }} />
                          {repo.lang}
                        </span>
                      )}
                      {repo.here === undefined ? repo.pushed !== '' && <span>{repo.pushed}</span> : <span>On {here}</span>}
                    </span>
                  </span>
                  <span className={cx(s.repoAct, on && s.repoActOn)}>
                    <Icon name={on ? 'check' : repo.here === undefined ? 'download' : 'plus'} size={12} />
                    {on ? 'Chosen' : repo.here === undefined ? 'Clone' : 'Add'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Where its code comes from, once chosen: the repository or folder, and what git is in it. */
function SourceCard({ S, status, onChange }: { S: SetupState; status: Status; onChange?: () => void }) {
  const source = S.source
  const change = onChange !== undefined && !S.running && (
    <LinkButton className={s.cardChange} onClick={onChange}>
      Change
    </LinkButton>
  )
  if (source.kind === 'repo') {
    const [owner, name] = source.repo.remote.split('/')
    return (
      <div className={cx(s.card, status === 'doing' && s.cardBusy)}>
        <span className={s.cardMark}>
          <BrandMark brand={HOST[source.repo.host].brand} size={22} />
        </span>
        <span className={s.cardMain}>
          <span className={s.cardName}>
            <span className={s.owner}>{owner}/</span>
            {name}
          </span>
          <span className={s.cardFacts}>
            <span className={s.mono}>{S.where}</span>
            <span>{source.repo.issues > 0 ? `main · ${source.repo.issues} open issues` : 'main'}</span>
          </span>
        </span>
        {change}
        {status === 'doing' && source.repo.here === undefined && <span className={s.fill} aria-hidden="true" />}
      </div>
    )
  }
  if (source.kind === 'folder') {
    const bad = source.folder === 'unreadable' || source.folder === 'project'
    return (
      <div className={cx(s.card, s.cardTall)}>
        <span className={s.cardMark}>
          <Icon name="folder" size={18} />
        </span>
        <span className={s.cardMain}>
          <span className={s.cardName}>tidepool</span>
          <span className={s.cardFacts}>
            <span className={s.mono}>{S.where}</span>
          </span>
        </span>
        {change}
        <p className={cx(s.cardLine, bad && s.cardBad)}>
          <Icon name={bad ? 'lock' : 'branch'} size={13} />
          <span>
            {source.folder === 'unreadable' ? (
              <>
                Althar can’t read it: macOS keeps Documents closed until you allow it. <LinkButton>Allow in System Settings</LinkButton>
              </>
            ) : source.folder === 'project' ? (
              <>
                It’s Tidepool already. <LinkButton>Open Tidepool</LinkButton>
              </>
            ) : (
              gitWords[source.folder]
            )}
          </span>
        </p>
      </div>
    )
  }
  if (source.kind === 'new')
    return (
      <div className={s.card}>
        <span className={s.cardMark}>
          <Icon name="create" size={18} />
        </span>
        <span className={s.cardMain}>
          <span className={s.cardName}>tidepool</span>
          <span className={s.cardFacts}>
            <span className={s.mono}>{S.where}</span>
            <span>A new repository, on main</span>
          </span>
        </span>
        {change}
      </div>
    )
  return null
}

/** Where its code lives: a new repository on a host it's connected to, or only this computer. */
function HomePicks({ S, onConnect }: { S: SetupState; onConnect: (host: Host) => void }) {
  return (
    <SizeMotion step={S.home}>
      <div role="radiogroup" aria-label="Where its code lives" className={s.picks}>
        {(['github', 'gitlab'] as const).map((id) =>
          S.hosts.includes(id) ? (
            <Pick
              key={id}
              checked={S.home === id}
              onChoose={() => S.setHome(id)}
              mark={<BrandMark brand={HOST[id].brand} size={16} />}
              title={`A new ${HOST[id].thing} on ${HOST[id].name}`}
              {...(S.home === id ? {} : { note: `${S.owner}/${S.repoName}` })}
            >
              <HostFields S={S} />
            </Pick>
          ) : (
            <ConnectRow
              key={id}
              brand={HOST[id].brand}
              title={HOST[id].name}
              note={`Then a new ${HOST[id].thing} there`}
              onConnect={() => onConnect(id)}
            />
          ),
        )}
        <Pick
          checked={S.home === 'here'}
          onChoose={() => S.setHome('here')}
          mark={<Icon name="folder" size={15} />}
          title={`Only on ${here}`}
          note="Finished work merges into main here"
        />
      </div>
    </SizeMotion>
  )
}

/** Where its issues go: Linear, its host's own, or nowhere yet. */
function IssuePicks({ S }: { S: SetupState }) {
  const host = S.codeHost
  return (
    <SizeMotion step={S.issues}>
      <div role="radiogroup" aria-label="Where its issues go" className={s.picks}>
        {S.issueWays.includes('host') && host !== null && (
          <Pick
            checked={S.issues === 'host'}
            onChoose={() => S.setIssues('host')}
            mark={<BrandMark brand={HOST[host].brand} size={16} />}
            title={HOST[host].issues}
            note={S.repo !== null && S.repo.issues > 0 ? `${S.repo.issues} open on ${S.remote}` : `On ${S.remote}`}
          />
        )}
        {S.issueWays.includes('linear') ? (
          <Pick
            checked={S.issues === 'linear'}
            onChoose={() => S.setIssues('linear')}
            mark={<BrandMark brand={Brand.Linear} size={16} />}
            title="Linear"
            {...(S.issues === 'linear' ? {} : { note: 'A new team, or one you have' })}
          >
            <Select variant="filled" label="Linear team" width={260} value={S.team} onChange={S.setTeam} options={TEAMS} />
          </Pick>
        ) : (
          <ConnectRow brand={Brand.Linear} title="Linear" note="Or Jira, or Trello" onConnect={noop} />
        )}
        <Pick
          checked={S.issues === 'none'}
          onChoose={() => S.setIssues('none')}
          mark={<Icon name="close" size={14} />}
          title="None for now"
          note="Link a tracker any time in its settings"
        />
      </div>
    </SizeMotion>
  )
}

/** Where its code lives, when it came from there. */
function HomeFixed({ S }: { S: SetupState }) {
  const repo = S.repo
  if (repo === null)
    return (
      <p className={s.fixed}>
        <Icon name="download" size={14} />
        <span>On the host it’s cloned from.</span>
      </p>
    )
  return (
    <p className={s.fixed}>
      <BrandMark brand={HOST[repo.host].brand} size={14} />
      <span>
        On {HOST[repo.host].name}, at <span className={s.mono}>{repo.remote}</span>. Tasks open {HOST[repo.host].changes} there.
      </span>
    </p>
  )
}

/* ---- A: your repositories first; then what the one chosen still needs ---- */

function FirstSide({ S, onConnect }: { S: SetupState; onConnect: (host: Host) => void }) {
  const chosen = S.source.kind !== 'none'
  return (
    <SizeMotion step={chosen ? 'chosen' : 'browse'}>
      {chosen ? (
        <div className={s.stack}>
          <Section title="Code" status={S.status('source')}>
            <SourceCard S={S} status={S.status('source')} onChange={() => S.choose({ kind: 'none' })} />
          </Section>
          <Section title="Where its code lives" status={S.status('home')}>
            {S.repo === null ? <HomePicks S={S} onConnect={onConnect} /> : <HomeFixed S={S} />}
          </Section>
          <Section title="Issues" status={S.status('issues')}>
            <IssuePicks S={S} />
          </Section>
        </div>
      ) : (
        <div className={s.stack}>
          <div className={s.heroHead}>
            <h2 className={s.hero}>Clone a repository</h2>
            {S.hosts.length > 0 && (
              <span className={s.accounts}>
                {S.hosts.map((id) => (
                  <span key={id} className={s.account}>
                    <BrandMark brand={HOST[id].brand} size={12} />
                    {id === 'github' ? 'balazs, charrette' : 'charrette'}
                  </span>
                ))}
              </span>
            )}
          </div>
          <Repositories S={S} height={316} onConnect={onConnect} />
          <div className={s.orRow}>
            <span className={s.or}>or</span>
            <Button size="small" icon="folder" onClick={S.chooseFolder}>
              Choose a folder on {here}…
            </Button>
            <Button size="small" icon="plus" onClick={() => S.choose({ kind: 'new' })}>
              Start empty
            </Button>
          </div>
        </div>
      )}
    </SizeMotion>
  )
}

/* ---- B: three ways in, side by side; what's under them keeps its place ---- */

function DoorsSide({ S, onConnect }: { S: SetupState; onConnect: (host: Host) => void }) {
  const doors: Array<{ id: Door; title: string; note: string; art: ReactNode }> = [
    {
      id: 'clone',
      title: 'Clone',
      note: S.hosts.length === 0 ? 'From GitHub or GitLab' : `From ${S.hosts.map((h) => HOST[h].name).join(' or ')}`,
      art: (
        <span className={s.doorMarks}>
          <BrandMark brand={Brand.GitHub} size={22} />
          <BrandMark brand={Brand.GitLab} size={22} />
        </span>
      ),
    },
    { id: 'folder', title: 'A folder', note: `On ${here}`, art: <Icon name="folder" size={22} /> },
    { id: 'new', title: 'Start empty', note: 'A new repository', art: <Icon name="create" size={22} /> },
  ]
  const source = S.source
  return (
    <div className={s.stack}>
      <div role="radiogroup" aria-label="Where its code comes from" className={s.doors}>
        {doors.map((door) => (
          <button
            key={door.id}
            type="button"
            role="radio"
            aria-checked={S.door === door.id}
            className={cx(s.door, door.id === 'clone' && s.doorClone)}
            onClick={() => S.setDoor(door.id)}
          >
            <span className={s.doorArt}>{door.art}</span>
            <span className={s.doorTitle}>{door.title}</span>
            <span className={s.doorNote}>{door.note}</span>
          </button>
        ))}
      </div>
      <div className={s.doorBody}>
        {S.door === 'clone' ? (
          S.running && source.kind === 'repo' ? (
            <div className={s.zone}>
              <SourceCard S={S} status={S.status('source')} />
            </div>
          ) : (
            <Repositories S={S} height={196} onConnect={onConnect} />
          )
        ) : (
          <div className={cx(s.zone, source.kind === 'none' && s.zoneEmpty)}>
            {source.kind === 'none' ? (
              <>
                <Icon name="folder" size={18} />
                <span className={s.zoneTitle}>Drop a folder here</span>
                <Button size="small" icon="folder" onClick={S.chooseFolder}>
                  Choose a folder…
                </Button>
              </>
            ) : (
              <SourceCard S={S} status={S.status('source')} {...(S.door === 'folder' ? { onChange: S.chooseFolder } : {})} />
            )}
          </div>
        )}
      </div>
      <Section title="Where its code lives" status={S.status('home')}>
        {S.repo === null && S.door !== 'clone' ? <HomePicks S={S} onConnect={onConnect} /> : <HomeFixed S={S} />}
      </Section>
      <Section title="Issues" status={S.status('issues')}>
        <IssuePicks S={S} />
      </Section>
    </div>
  )
}

/* ---- C: one sheet, every row chosen already: the repository named like it, a new one on GitHub, Linear ---- */

function RepoField({ S, onConnect }: { S: SetupState; onConnect: (host: Host) => void }) {
  const [open, setOpen] = useState(false)
  const repo = S.repo
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Repositories"
      width={520}
      padded={false}
      trigger={
        <button type="button" className={cx(s.repoField, repo !== null && S.like(repo) && s.repoLike)}>
          {repo === null ? (
            <>
              <span className={s.doorMarks}>
                <BrandMark brand={Brand.GitHub} size={18} />
                <BrandMark brand={Brand.GitLab} size={18} />
              </span>
              <span className={s.repoFieldName}>Choose a repository to clone</span>
            </>
          ) : (
            <>
              <BrandMark brand={HOST[repo.host].brand} size={20} />
              <span className={s.repoMain}>
                <span className={s.repoName}>
                  <span>
                    <span className={s.owner}>{repo.remote.split('/')[0]}/</span>
                    {nameOf(repo.remote)}
                  </span>
                  {!repo.open && <Icon name="lock" size={11} />}
                  {S.like(repo) && <span className={s.likeTag}>Named like the project</span>}
                </span>
                <span className={s.repoFacts}>
                  <span className={s.mono}>into {S.where}</span>
                  {repo.issues > 0 && <span>{repo.issues} open issues</span>}
                </span>
              </span>
            </>
          )}
          <Icon name="chevronD" size={14} />
          {S.status('source') === 'doing' && repo?.here === undefined && <span className={s.fill} aria-hidden="true" />}
        </button>
      }
    >
      <div className={s.popRepos} style={{ '--ink': `var(--project-${S.ink})` } as CSSProperties}>
        <Repositories
          S={{
            ...S,
            choose: (next: Source) => {
              S.choose(next)
              setOpen(false)
            },
          }}
          height={300}
          onConnect={onConnect}
        />
      </div>
    </Popover>
  )
}

function SheetSide({ S, onConnect }: { S: SetupState; onConnect: (host: Host) => void }) {
  const host = S.codeHost
  return (
    <div className={s.sheet}>
      <div className={s.sheetRow}>
        <span className={s.sheetLabel}>
          Code <StatusMark status={S.status('source')} />
        </span>
        <div className={s.sheetControl}>
          <Segmented
            label="Where its code comes from"
            value={S.door}
            onChange={S.setDoor}
            options={[
              { value: 'clone', label: 'Clone' },
              { value: 'folder', label: 'A folder' },
              { value: 'new', label: 'Start empty' },
            ]}
          />
          <SizeMotion step={S.door}>
            {S.door === 'clone' ? (
              <RepoField S={S} onConnect={onConnect} />
            ) : S.source.kind === 'none' ? (
              <Button size="small" icon="folder" onClick={S.chooseFolder}>
                Choose a folder…
              </Button>
            ) : (
              <SourceCard S={S} status={S.status('source')} {...(S.door === 'folder' ? { onChange: S.chooseFolder } : {})} />
            )}
          </SizeMotion>
        </div>
      </div>
      <div className={s.sheetRow}>
        <span className={s.sheetLabel}>
          Lives on <StatusMark status={S.status('home')} />
        </span>
        <div className={s.sheetControl}>
          {S.repo !== null || S.door === 'clone' ? (
            <HomeFixed S={S} />
          ) : (
            <SizeMotion step={S.home}>
              <div className={s.sheetStack}>
                <div className={s.sheetLine}>
                  <Select
                    variant="filled"
                    label="Where its code lives"
                    width={190}
                    value={S.home}
                    onChange={S.setHome}
                    options={[
                      ...S.hosts.map((h) => ({ value: h, label: HOST[h].name })),
                      { value: 'here' as const, label: `Only on ${here}` },
                    ]}
                  />
                  {S.hosts.length < 2 && (
                    <LinkButton onClick={() => onConnect(S.hosts.includes('github') ? 'gitlab' : 'github')}>
                      Connect {S.hosts.includes('github') ? 'GitLab' : 'GitHub or GitLab'}
                    </LinkButton>
                  )}
                </div>
                {host !== null && <HostFields S={S} />}
              </div>
            </SizeMotion>
          )}
        </div>
      </div>
      <div className={s.sheetRow}>
        <span className={s.sheetLabel}>
          Issues <StatusMark status={S.status('issues')} />
        </span>
        <div className={s.sheetControl}>
          <div className={s.sheetLine}>
            <Select
              variant="filled"
              label="Where its issues go"
              width={190}
              value={S.issues}
              onChange={S.setIssues}
              options={S.issueWays.map((way) => ({
                value: way,
                label: way === 'linear' ? 'Linear' : way === 'host' && host !== null ? HOST[host].issues : 'None for now',
              }))}
            />
            {S.issues === 'linear' && (
              <Select variant="filled" label="Linear team" width={240} value={S.team} onChange={S.setTeam} options={TEAMS} />
            )}
            {S.issues === 'host' && S.repo !== null && S.repo.issues > 0 && <span className={s.sheetNote}>{S.repo.issues} open</span>}
            {!linearOf(S.setup) && <LinkButton>Connect Linear, Jira or Trello</LinkButton>}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---- Step one: the New project page, its side the setup ---- */

function SetupPage({
  direction,
  state,
  setup,
  onDone,
  onConnect,
}: {
  direction: Direction
  state: State
  setup: Setup
  onDone: (done: Done) => void
  onConnect: (host: Host) => void
}) {
  const [name, setName] = useState('Tidepool')
  const [ink, setInk] = useState(INK)
  const S = useSetup({ state, setup, name, onName: setName, start: direction === 'c' ? 'like' : 'none', ink, onDone })
  const side =
    direction === 'a' ? (
      <FirstSide S={S} onConnect={onConnect} />
    ) : direction === 'b' ? (
      <DoorsSide S={S} onConnect={onConnect} />
    ) : (
      <SheetSide S={S} onConnect={onConnect} />
    )
  return (
    <NewProject
      seed={SEED}
      name={name}
      onNameChange={setName}
      ink={ink}
      onInkChange={setInk}
      folders={S.folders}
      onRemove={noop}
      onChoose={S.chooseFolder}
      found={null}
      onAdd={noop}
      side={
        <fieldset className={s.fieldset} disabled={S.running}>
          {side}
        </fieldset>
      }
      {...(S.footNote === undefined ? {} : { footNote: S.footNote })}
      onCreate={S.create}
      onCancel={noop}
      creating={S.running}
      error={S.failed}
      text={{ needsFolder: 'Choose where its code comes from first.' }}
    />
  )
}

/* ---- The project, as Create opens it ---- */

const FOLDS: BoardFolds = { collapsed: [], opened: [] }

const partOf = (host: Host | null): ProjectPart =>
  host === null
    ? { id: 'tidepool', name: 'tidepool', openLabel: 'Show in Finder', onOpen: noop }
    : { id: 'tidepool', name: 'tidepool', brand: HOST[host].brand, openLabel: `Open on ${HOST[host].name}`, onOpen: noop }

function Window({ host, talk }: { host: Host | null; talk: ReactNode }) {
  const [draft, setDraft] = useState('')
  return (
    <div className={s.window}>
      <ProjectTabs
        lights="drawn"
        tabs={[
          { id: 'meridian', name: 'Meridian', seed: 'meridian', ink: ProjectInk.Clay, running: true, yours: 0 },
          { id: 'tidepool', name: 'Tidepool', seed: SEED, ink: INK, running: false, yours: 0 },
        ]}
        current="tidepool"
        yours={0}
        onSelect={noop}
        onClose={noop}
        end={<IconButton icon="gear" label="Settings" kbd="⌘," size="small" />}
      />
      <ProjectHeader
        name="Tidepool"
        seed={SEED}
        ink={INK}
        yours={0}
        inProgress={0}
        onYours={noop}
        room={Room.Both}
        onRoom={noop}
        parts={[partOf(host)]}
      />
      <div className={s.rooms}>
        <div className={s.talk}>
          <TaskFace
            className={s.face}
            composer={
              <Composer value={draft} onChange={setDraft} onSubmit={() => setDraft('')} placeholder="Tell the coordinator something" />
            }
          >
            {talk}
          </TaskFace>
        </div>
        <div className={s.board}>
          <Board label="Tidepool’s work" defaultFolds={FOLDS}>
            <BoardColumn
              lane={BoardLane.Next}
              count={0}
              empty={
                <BoardEmpty title="Nothing queued">Tell the coordinator what you want done. The tasks it plans line up here.</BoardEmpty>
              }
            />
            <BoardColumn lane={BoardLane.Running} count={0} />
            <BoardColumn lane={BoardLane.Yours} count={0} />
            <BoardColumn lane={BoardLane.Settled} count={0} />
          </Board>
        </div>
      </div>
    </div>
  )
}

function ReadyScene({ done }: { done: Done }) {
  return (
    <Window
      host={done.host}
      talk={
        <Thread label="Conversation">
          {done.lines.map((line) => (
            <AltharLine key={line}>{line}</AltharLine>
          ))}
        </Thread>
      }
    />
  )
}

/* ---- Later: a task done in a project with no remote, and putting it on a host then ---- */

/** Ticks a list off one line at a time, then says it's done. */
function useTicking(lines: readonly string[], onDone: () => void) {
  const [at, setAt] = useState<number | null>(null)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  useEffect(() => {
    if (at === null) return
    if (at >= lines.length) {
      const id = setTimeout(() => done.current(), 380)
      return () => clearTimeout(id)
    }
    const id = setTimeout(() => setAt(at + 1), 420)
    return () => clearTimeout(id)
  }, [at, lines.length])
  const items: ConnectCan[] = lines.map((text, i) => ({
    id: String(i),
    text,
    state: at === null ? CanState.Waiting : i < at ? CanState.Can : i === at ? CanState.Checking : CanState.Waiting,
  }))
  return { items, start: () => setAt(0), busy: at !== null }
}

function HostCard({ host, onDone, onBack }: { host: Host; onDone: (remote: string) => void; onBack: () => void }) {
  const h = HOST[host]
  const [owner, setOwner] = useState('balazs')
  const [name, setName] = useState('tidepool')
  const [seen, setSeen] = useState<'private' | 'public'>('private')
  const ticking = useTicking([`Create ${owner}/${name}`, 'Push main to it', 'Make it tidepool’s remote'], () => onDone(`${owner}/${name}`))
  return (
    <ConnectCard brand={h.brand} title={`New ${h.thing} on ${h.name}`} align="start">
      {ticking.busy ? (
        <ConnectChecks label="Making it" items={ticking.items} />
      ) : (
        <div className={s.hostForm}>
          <div className={s.ownerName}>
            <Select
              label="Owner"
              width={150}
              value={owner}
              onChange={setOwner}
              options={[
                { value: 'balazs', label: 'balazs' },
                { value: 'charrette', label: 'charrette' },
              ]}
            />
            <span className={s.slash}>/</span>
            <ConnectField label="Name" value={name} onChange={setName} onSubmit={ticking.start} focus />
          </div>
          <ConnectFound>
            {owner}/{name} is free
          </ConnectFound>
          <Segmented
            label="Who can see it"
            value={seen}
            onChange={setSeen}
            options={[
              { value: 'private', label: 'Private' },
              { value: 'public', label: 'Public' },
            ]}
          />
        </div>
      )}
      <ConnectActions align="start">
        <Button variant="signal" busy={ticking.busy} onClick={ticking.start}>
          Create and push main
        </Button>
        {!ticking.busy && (
          <Button variant="quiet" onClick={onBack}>
            Back
          </Button>
        )}
      </ConnectActions>
    </ConnectCard>
  )
}

const FILES = [
  { path: 'src/stations.ts', add: 96, del: 0 },
  { path: 'src/main.ts', add: 22, del: 4 },
]

function LaterScene({ setup }: { setup: Setup }) {
  const [code, setCode] = useState<{ host: Host; remote: string } | null>(null)
  const [putting, setPutting] = useState<Host | null>(null)
  const [merged, setMerged] = useState(false)
  const hosts = hostsOf(setup)
  const actions =
    code !== null ? (
      <>
        <Button variant="signal">{code.host === 'gitlab' ? 'Open a draft merge request' : 'Open a draft pull request'}</Button>
        <Button onClick={() => setMerged(true)}>Merge into main</Button>
      </>
    ) : (
      <>
        <Button variant="signal" onClick={() => setMerged(true)}>
          Merge into main
        </Button>
        {hosts.length > 0 && (
          <Menu label="Put it on" trigger={<Button trailingIcon="chevronD">Put it on a host first</Button>}>
            {hosts.map((id) => (
              <MenuItem key={id} lead={<BrandMark brand={HOST[id].brand} size={14} />} onSelect={() => setPutting(id)}>
                {HOST[id].name}
              </MenuItem>
            ))}
          </Menu>
        )}
      </>
    )
  return (
    <Window
      host={code?.host ?? null}
      talk={
        <Thread label="Conversation">
          <You at="10:12">Add a station picker, with the five nearest stations first.</You>
          <TaskMark
            task="1"
            verb="finished"
            detail="Sonnet 5 led"
            at="10:31"
            steps={['Implement']}
            step={0}
            now="Done"
            last
            onJump={noop}
          />
          <div className={s.walkCard}>
            <SizeMotion step={putting ?? (merged ? 'merged' : code === null ? 'branch' : 'pr')}>
              {putting !== null ? (
                <HostCard
                  host={putting}
                  onDone={(remote) => {
                    setCode({ host: putting, remote })
                    setPutting(null)
                  }}
                  onBack={() => setPutting(null)}
                />
              ) : (
                <ChangeSet
                  state={merged ? ChangeState.Merged : ChangeState.Branch}
                  branch="tidepool/station-picker"
                  prs={[{ repo: 'tidepool', files: FILES }]}
                  {...(merged ? { note: 'Merged into main.' } : { actions })}
                />
              )}
            </SizeMotion>
          </div>
          {code !== null && (
            <AltharLine>
              tidepool is on {HOST[code.host].name} at {code.remote}, with main pushed. Tasks open {HOST[code.host].changes} there.
            </AltharLine>
          )}
        </Thread>
      }
    />
  )
}

/* ---- The lab ---- */

function Lab() {
  const [direction, setDirection] = useState<Direction>(pick(directions, params.get('d'), 'a'))
  const [state, setState] = useState<State>(pick(states, params.get('s'), 'none'))
  const [setup, setSetup] = useState<Setup>(pick(setups, params.get('c'), 'all'))
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  const [done, setDone] = useState<{ scene: string; done: Done } | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    const url = new URL(location.href)
    url.search = ''
    url.searchParams.set('d', direction)
    url.searchParams.set('s', state)
    url.searchParams.set('c', setup)
    url.searchParams.set('theme', theme)
    history.replaceState(null, '', url)
  }, [direction, state, setup, theme])
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const d = directions.find((one) => one.key === key)
      if (d !== undefined) return setDirection(d.key)
      const n = Number(key)
      const st = states[n - 1]
      if (Number.isInteger(n) && st !== undefined) return setState(st.key)
      if (key === 'g') return setSetup((now) => setups[(setups.findIndex((one) => one.key === now) + 1) % setups.length]?.key ?? 'all')
      if (key === 'r') return setRound((now) => now + 1)
      if (key === 't') setTheme((now) => (now === 'dark' ? 'light' : 'dark'))
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])
  // Anything changed in the bars starts the page again.
  const scene = `${direction}-${state}-${setup}-${round}`
  const ready = done !== null && done.scene === scene ? done.done : null
  return (
    <div className={s.lab}>
      <main className={s.scene}>
        {state === 'later' ? (
          <LaterScene key={scene} setup={setup} />
        ) : ready !== null ? (
          <ReadyScene key={scene} done={ready} />
        ) : (
          <div className={s.page}>
            <SetupPage
              key={scene}
              direction={direction}
              state={state}
              setup={setup}
              onDone={(made) => setDone({ scene, done: made })}
              onConnect={(host) => setSetup(host === 'github' ? 'github' : 'all')}
            />
          </div>
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
          <button type="button" onClick={() => setRound((now) => now + 1)}>
            <kbd>R</kbd>
            Again
          </button>
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
