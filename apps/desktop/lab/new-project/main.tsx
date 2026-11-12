import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { Fragment, type ReactNode, StrictMode, useEffect, useRef, useState } from 'react'

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
  type ConnectWayOption,
  ConnectWays,
  Composer,
  FirstConnections,
  type FirstConnectionsRow,
  Icon,
  IconButton,
  LinkButton,
  Menu,
  MenuItem,
  ProjectHeader,
  ProjectInk,
  type ProjectPart,
  ProjectTabs,
  Prose,
  Room,
  Segmented,
  Select,
  TaskFace,
  TaskMark,
  Thread,
  Turn,
  WorkedFor,
  You,
} from '@althar/ui'
import { device } from '@althar/ui/device'
import { NewProject } from '@althar/ui/screens'

import { SizeMotion } from '../../../../packages/ui/src/lib/SizeMotion'
import s from './lab.module.css'

/*
 * The new-project lab (README.md): a project in a folder with no remote. Its
 * name and folder first, on the New project page as it is, which takes any
 * folder; then, in the project's first conversation, what it still needs:
 * git where it has none, where its code lives (GitHub, GitLab or only this
 * computer) and where its issues go, each a walk like the integrations' own.
 * A–D are how the conversation offers them; 1–7 the folder; G what is
 * connected; T the theme; R starts again.
 */

const directions = [
  { key: 'a', label: 'Today’s card, with git' },
  { key: 'b', label: 'A walk in the conversation' },
  { key: 'c', label: 'The coordinator asks' },
  { key: 'd', label: 'Only what blocks, now' },
] as const
type Direction = (typeof directions)[number]['key']

const states = [
  { key: 'empty', label: 'Empty folder' },
  { key: 'files', label: 'Files, no git' },
  { key: 'unborn', label: 'Git, no commits' },
  { key: 'local', label: 'Git, no remote' },
  { key: 'unreadable', label: 'Can’t be read' },
  { key: 'project', label: 'Already a project' },
  { key: 'later', label: 'Later: a task is done' },
] as const
type State = (typeof states)[number]['key']

const setups = [
  { key: 'all', label: 'GitHub, GitLab, Linear' },
  { key: 'github', label: 'GitHub only' },
  { key: 'none', label: 'Nothing yet' },
] as const
type Setup = (typeof setups)[number]['key']

/** What each state does in Althar as it is. */
const today: Record<State, string> = {
  empty: 'Today: refused, “There’s no git repository in tidepool.” New repository… would make ~/code/tidepool/tidepool, a folder deeper.',
  files: 'Today: refused the same way. The only way in is git init in a terminal, then choosing it again.',
  unborn: 'Today: the project is made, then its first task fails: git worktree add … fatal: invalid reference: main. Nothing says why.',
  local:
    'Today: works. With GitHub connected, its first conversation offers nothing; a task’s card says “No code host”, as if something were broken.',
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

/* ---- What the folder needs, and what's connected ---- */

type GitNeed = 'init' | 'empty' | 'commit' | null
const gitNeed = (state: State): GitNeed => (state === 'files' ? 'init' : state === 'empty' ? 'empty' : state === 'unborn' ? 'commit' : null)

type Host = 'github' | 'gitlab'
const HOST: Record<Host, { name: string; brand: Brand; thing: string; issues: string }> = {
  github: { name: 'GitHub', brand: Brand.GitHub, thing: 'repository', issues: 'GitHub Issues' },
  gitlab: { name: 'GitLab', brand: Brand.GitLab, thing: 'project', issues: 'GitLab issues' },
}
const hostsOf = (setup: Setup): Host[] => (setup === 'all' ? ['github', 'gitlab'] : setup === 'github' ? ['github'] : [])
const linearOf = (setup: Setup) => setup === 'all'
const isHost = (code: Made['code']): code is Host => code === 'github' || code === 'gitlab'

/** What has been set up so far. */
interface Made {
  git: 'needed' | 'done' | 'later' | 'fine'
  code: 'unasked' | 'here' | Host
  issues: 'unasked' | 'linear' | 'host' | 'none'
}
const firstMade = (state: State): Made => ({
  git: gitNeed(state) === null ? 'fine' : 'needed',
  code: 'unasked',
  issues: 'unasked',
})

const gitFacts = (need: GitNeed): string[] =>
  need === 'empty'
    ? ['Start git, on main', 'Make an empty first commit']
    : need === 'commit'
      ? ['Add a .gitignore for node_modules and .env', 'Commit its 14 files, on main']
      : ['Start git, on main', 'Add a .gitignore for node_modules and .env', 'Commit its 14 files']
const gitDone = (need: GitNeed) => (need === 'empty' ? 'main, with an empty first commit' : 'main, first commit 3f2a91c')

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

/* ---- The walks: the same cards the integrations' own walks use ---- */

interface Walk {
  /** Where it is set: from the left edge of what it's in, or centred. */
  align?: 'start' | 'centre'
  pager?: { steps: number; at: number }
}
const walkProps = ({ align = 'start', pager }: Walk) => ({ align, ...(pager === undefined ? {} : { pager }) })

function GitCard({ need, onDone, onLater, ...walk }: Walk & { need: GitNeed; onDone: () => void; onLater?: () => void }) {
  const ticking = useTicking(gitFacts(need), onDone)
  return (
    <ConnectCard
      icon="branch"
      title={need === 'commit' ? 'Make tidepool’s first commit' : 'Set up git in tidepool'}
      line="Tasks branch from its first commit."
      {...walkProps(walk)}
    >
      <ConnectChecks label="What it does" items={ticking.items} />
      <ConnectActions align="start">
        <Button variant="signal" busy={ticking.busy} onClick={ticking.start}>
          {need === 'commit' ? 'Commit' : 'Set up git'}
        </Button>
        {onLater !== undefined && !ticking.busy && (
          <Button variant="quiet" onClick={onLater}>
            Not now
          </Button>
        )}
      </ConnectActions>
    </ConnectCard>
  )
}

function CodeCard({ setup, onChoose, ...walk }: Walk & { setup: Setup; onChoose: (code: 'here' | Host) => void }) {
  const hosts = hostsOf(setup)
  const ways: ConnectWayOption[] = [
    ...(['github', 'gitlab'] as const).map((id) =>
      hosts.includes(id)
        ? { id, title: `A new ${HOST[id].thing} on ${HOST[id].name}`, line: 'As balazs, private', brand: HOST[id].brand }
        : { id, title: `Connect ${HOST[id].name}`, line: `Then a new ${HOST[id].thing} there`, brand: HOST[id].brand },
    ),
    { id: 'here', title: `Only on ${here}`, line: 'Finished work merges into main here', icon: 'folder' },
  ]
  return (
    <ConnectCard icon="branch" title="Where should its code live?" {...walkProps(walk)}>
      <ConnectWays label="Where its code lives" ways={ways} onChoose={(id) => onChoose(id as 'here' | Host)} />
    </ConnectCard>
  )
}

function HostCard({ host, onDone, onBack, ...walk }: Walk & { host: Host; onDone: () => void; onBack: () => void }) {
  const h = HOST[host]
  const [owner, setOwner] = useState('balazs')
  const [name, setName] = useState('tidepool')
  const [seen, setSeen] = useState<'private' | 'public'>('private')
  const ticking = useTicking([`Create ${owner}/${name}`, 'Push main to it', 'Make it tidepool’s remote'], onDone)
  return (
    <ConnectCard brand={h.brand} title={`New ${h.thing} on ${h.name}`} {...walkProps(walk)}>
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

function IssuesCard({
  setup,
  code,
  onChoose,
  ...walk
}: Walk & { setup: Setup; code: Made['code']; onChoose: (to: Made['issues']) => void }) {
  const ways: ConnectWayOption[] = [
    linearOf(setup)
      ? { id: 'linear', title: 'Linear', line: 'A new team for it, or one you have', brand: Brand.Linear }
      : { id: 'linear', title: 'Connect Linear', line: 'Or Jira or Trello', brand: Brand.Linear },
    ...(isHost(code) ? [{ id: 'host', title: HOST[code].issues, line: 'On balazs/tidepool', brand: HOST[code].brand }] : []),
    { id: 'none', title: 'Not now', line: 'Link a tracker later, in its settings', icon: 'close' },
  ]
  return (
    <ConnectCard icon="issues" title="Where should its issues go?" {...walkProps(walk)}>
      <ConnectWays label="Where its issues go" ways={ways} onChoose={(id) => onChoose(id as Made['issues'])} />
    </ConnectCard>
  )
}

function TeamCard({ onDone, ...walk }: Walk & { onDone: () => void }) {
  return (
    <ConnectCard brand={Brand.Linear} title="Which Linear team?" {...walkProps(walk)}>
      <ConnectWays
        label="Linear teams"
        ways={[
          { id: 'new', title: 'A new team, Tidepool', line: 'Its issues TID-1, TID-2…', icon: 'create' },
          { id: 'alt', title: 'Althar', line: 'ALT · 212 open', brand: Brand.Linear },
          { id: 'web', title: 'Web', line: 'WEB · 38 open', brand: Brand.Linear },
        ]}
        onChoose={onDone}
      />
    </ConnectCard>
  )
}

/* ---- The window: tabs, header, the conversation beside the board ---- */

const FOLDS: BoardFolds = { collapsed: [], opened: [] }

const partOf = (code: Made['code']): ProjectPart =>
  isHost(code)
    ? { id: 'tidepool', name: 'tidepool', brand: HOST[code].brand, openLabel: `Open on ${HOST[code].name}`, onOpen: noop }
    : { id: 'tidepool', name: 'tidepool', openLabel: 'Show in Finder', onOpen: noop }

function Window({ made, talk, composer, upNext }: { made: Made; talk: ReactNode; composer: ReactNode; upNext?: ReactNode }) {
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
        parts={[partOf(made.code)]}
      />
      <div className={s.rooms}>
        <div className={s.talk}>
          <TaskFace className={s.face} composer={composer}>
            {talk}
          </TaskFace>
        </div>
        <div className={s.board}>
          <Board label="Tidepool’s work" defaultFolds={FOLDS}>
            <BoardColumn
              lane={BoardLane.Next}
              count={0}
              empty={
                upNext ?? (
                  <BoardEmpty title="Nothing queued">Tell the coordinator what you want done. The tasks it plans line up here.</BoardEmpty>
                )
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

function Talk({ placeholder = 'Tell the coordinator something', onSay }: { placeholder?: string; onSay?: (text: string) => void }) {
  const [draft, setDraft] = useState('')
  return (
    <Composer
      value={draft}
      onChange={setDraft}
      onSubmit={(text) => {
        onSay?.(text)
        setDraft('')
      }}
      placeholder={placeholder}
    />
  )
}

/** The one line a remote earns, once the code has somewhere to live. */
const codeLine = (code: Made['code']) =>
  isHost(code)
    ? `tidepool is on ${HOST[code].name} at balazs/tidepool, private, with main pushed. Tasks open ${code === 'gitlab' ? 'merge' : 'pull'} requests there.`
    : null

/* ---- A: today's first-conversation card, with git, and code and issues each a row ---- */

function CardScene({ state, setup }: { state: State; setup: Setup }) {
  const need = gitNeed(state)
  const [made, setMade] = useState<Made>(() => firstMade(state))
  const [open, setOpen] = useState<'git' | Host | 'team' | null>(null)
  const [gone, setGone] = useState(false)
  const hosts = hostsOf(setup)
  const tick = <Icon name="check" size={14} />
  const rows: FirstConnectionsRow[] = []
  if (made.git !== 'fine')
    rows.push({
      id: 'git',
      mark: <Icon name="branch" size={15} />,
      name: 'Git',
      note:
        made.git === 'done'
          ? gitDone(need)
          : need === 'empty'
            ? 'Empty folder'
            : need === 'commit'
              ? 'No commits yet'
              : 'Not a repository yet',
      end:
        made.git === 'done' ? (
          tick
        ) : (
          <Button size="small" variant="signal" onClick={() => setOpen('git')}>
            Set up
          </Button>
        ),
    })
  if (hosts.length > 0)
    rows.push({
      id: 'code',
      mark: isHost(made.code) ? <BrandMark brand={HOST[made.code].brand} size={16} /> : <Icon name="folder" size={15} />,
      name: 'Code',
      note: isHost(made.code) ? 'balazs/tidepool' : `Only on ${here}`,
      end: isHost(made.code) ? (
        tick
      ) : (
        <Menu
          label="Put it on"
          align="end"
          trigger={
            <Button size="small" trailingIcon="down">
              Put it on
            </Button>
          }
        >
          {hosts.map((id) => (
            <MenuItem key={id} lead={<BrandMark brand={HOST[id].brand} size={14} />} onSelect={() => setOpen(id)}>
              {HOST[id].name}
            </MenuItem>
          ))}
        </Menu>
      ),
    })
  if (linearOf(setup))
    rows.push({
      id: 'issues',
      mark: <BrandMark brand={Brand.Linear} size={16} />,
      name: 'Issues',
      note: made.issues === 'linear' ? 'Linear, Tidepool team' : 'Not linked',
      end:
        made.issues === 'linear' ? (
          tick
        ) : (
          <Button size="small" onClick={() => setOpen('team')}>
            Link Linear
          </Button>
        ),
    })
  const close = (next: Partial<Made>) => {
    setMade((m) => ({ ...m, ...next }))
    setOpen(null)
  }
  const walk =
    open === 'git' ? (
      <GitCard need={need} onDone={() => close({ git: 'done' })} onLater={() => setOpen(null)} />
    ) : open === 'github' || open === 'gitlab' ? (
      <HostCard host={open} onDone={() => close({ code: open })} onBack={() => setOpen(null)} />
    ) : open === 'team' ? (
      <TeamCard onDone={() => close({ issues: 'linear' })} />
    ) : undefined
  const line = codeLine(made.code)
  return (
    <Window
      made={made}
      composer={<Talk />}
      talk={
        <Thread label="Conversation">
          {!gone && (
            <FirstConnections
              rows={rows}
              {...(hosts.length === 0
                ? { hosts: (['github', 'gitlab'] as const).map((id) => ({ id, name: HOST[id].name, brand: HOST[id].brand })) }
                : {})}
              {...(linearOf(setup)
                ? {}
                : {
                    trackers: [
                      { id: 'linear', name: 'Linear', brand: Brand.Linear },
                      { id: 'jira', name: 'Jira', brand: Brand.Jira },
                      { id: 'trello', name: 'Trello', brand: Brand.Trello },
                    ],
                  })}
              onConnect={(id) => (id === 'github' || id === 'gitlab' ? setOpen(id) : id === 'linear' ? setOpen('team') : undefined)}
              onHide={() => setGone(true)}
              {...(walk === undefined ? {} : { walk })}
              text={{
                title: 'Set up Tidepool',
                issuesTitle: 'Set up Tidepool',
                line: made.git === 'needed' ? 'Tasks need git first. The rest can wait.' : 'Tasks start without these.',
                issuesLine: made.git === 'needed' ? 'Tasks need git first. The rest can wait.' : 'Tasks start without these.',
              }}
            />
          )}
          {line !== null && <AltharLine>{line}</AltharLine>}
        </Thread>
      }
    />
  )
}

/* ---- B: a walk in the conversation, one question at a time ---- */

type Stop = 'git' | 'code' | Host | 'issues' | 'team' | 'done'

const summaryOf = (made: Made, need: GitNeed): ConnectCan[] => [
  ...(made.git === 'fine'
    ? []
    : [
        {
          id: 'git',
          text: made.git === 'done' ? `Git: ${gitDone(need)}` : 'Git: not yet',
          state: made.git === 'done' ? CanState.Can : CanState.Waiting,
        },
      ]),
  {
    id: 'code',
    text: isHost(made.code) ? `Code: ${HOST[made.code].name}, balazs/tidepool` : `Code: only on ${here}`,
    state: CanState.Can,
  },
  {
    id: 'issues',
    text:
      made.issues === 'linear'
        ? 'Issues: Linear, Tidepool team'
        : made.issues === 'host' && isHost(made.code)
          ? `Issues: ${HOST[made.code].issues}`
          : 'Issues: none yet',
    state: made.issues === 'none' ? CanState.Waiting : CanState.Can,
  },
]

function WalkScene({ state, setup }: { state: State; setup: Setup }) {
  const need = gitNeed(state)
  const [made, setMade] = useState<Made>(() => firstMade(state))
  const [stop, setStop] = useState<Stop>(need === null ? 'code' : 'git')
  const steps = need === null ? 2 : 3
  const pager = (which: 'git' | 'code' | 'issues') => ({
    steps,
    at: need === null ? (which === 'code' ? 0 : 1) : which === 'git' ? 0 : which === 'code' ? 1 : 2,
  })
  const go = (next: Stop, change: Partial<Made> = {}) => {
    setMade((m) => ({ ...m, ...change }))
    setStop(next)
  }
  const card =
    stop === 'git' ? (
      <GitCard need={need} pager={pager('git')} onDone={() => go('code', { git: 'done' })} onLater={() => go('code', { git: 'later' })} />
    ) : stop === 'code' ? (
      <CodeCard setup={setup} pager={pager('code')} onChoose={(code) => (code === 'here' ? go('issues', { code: 'here' }) : go(code))} />
    ) : stop === 'github' || stop === 'gitlab' ? (
      <HostCard host={stop} pager={pager('code')} onDone={() => go('issues', { code: stop })} onBack={() => go('code')} />
    ) : stop === 'issues' ? (
      <IssuesCard
        setup={setup}
        code={made.code}
        pager={pager('issues')}
        onChoose={(to) => (to === 'linear' ? go('team') : go('done', { issues: to }))}
      />
    ) : stop === 'team' ? (
      <TeamCard pager={pager('issues')} onDone={() => go('done', { issues: 'linear' })} />
    ) : (
      <ConnectCard icon="check" title="Tidepool is set up" align="start" pager={{ steps, at: steps }} done>
        <ConnectChecks label="Set up" items={summaryOf(made, need)} />
      </ConnectCard>
    )
  return (
    <Window
      made={made}
      composer={<Talk />}
      talk={
        <Thread label="Conversation">
          <div className={s.walkCard}>
            <SizeMotion step={stop}>{card}</SizeMotion>
          </div>
        </Thread>
      }
    />
  )
}

/* ---- C: the coordinator asks, in its own words, with its answers to press ---- */

interface Option {
  id: string
  label: string
  brand?: Brand
}
interface Asked {
  id: string
  prose: string
  options: Option[]
  /** What follows the answer: a line from Althar, the coordinator's words, and what it set up. */
  after: (id: string) => { line?: string; prose?: string; made: Partial<Made> }
}

function asksOf(state: State, setup: Setup): Asked[] {
  const need = gitNeed(state)
  const hosts = hostsOf(setup)
  const git: Asked[] =
    need === null
      ? []
      : [
          {
            id: 'git',
            prose:
              need === 'empty'
                ? 'tidepool is empty. Shall I set up git in it, on main, with an empty first commit? Then tell me what you’re making, and a first task sets it up.'
                : need === 'commit'
                  ? 'tidepool has git but no commits yet, so tasks have nothing to branch from. Shall I commit its 14 files on main, with a .gitignore?'
                  : 'tidepool isn’t a git repository yet. Shall I set it up? It’d be on main, with a .gitignore and its 14 files as the first commit.',
            options: [
              { id: 'yes', label: need === 'commit' ? 'Commit them' : 'Set it up' },
              { id: 'no', label: 'Not yet' },
            ],
            after: (id) =>
              id === 'yes'
                ? { line: `Set up git in tidepool: ${gitDone(need)}.`, made: { git: 'done' } }
                : { prose: 'Tasks wait for it. Say when.', made: { git: 'later' } },
          },
        ]
  return [
    ...git,
    {
      id: 'code',
      prose:
        hosts.length === 0
          ? `Where should its code live? It’s only on ${here} now. Connect GitHub or GitLab and I’ll make it a repository there.`
          : `Where should its code live? It’s only on ${here} now; you have ${hosts.map((h) => HOST[h].name).join(' and ')} connected.`,
      options: [
        ...(['github', 'gitlab'] as const).map((id) => ({
          id,
          label: hosts.includes(id) ? HOST[id].name : `Connect ${HOST[id].name}`,
          brand: HOST[id].brand,
        })),
        { id: 'here', label: `Only on ${here}` },
      ],
      after: (id) =>
        id === 'here'
          ? {
              prose: 'Then finished work merges into main here. Ask me to put it on GitHub or GitLab whenever you like.',
              made: { code: 'here' },
            }
          : {
              prose: `Made balazs/tidepool on ${HOST[id as Host].name}, private, and pushed main. Tasks open ${id === 'gitlab' ? 'merge' : 'pull'} requests there from now on.`,
              made: { code: id as Host },
            },
    },
    {
      id: 'issues',
      prose: linearOf(setup) ? 'And its issues? You have Linear connected.' : 'And its issues? Nothing is connected for them yet.',
      options: [
        { id: 'linear', label: linearOf(setup) ? 'A new Linear team' : 'Connect Linear', brand: Brand.Linear },
        ...(setup === 'none' ? [] : [{ id: 'host', label: 'GitHub Issues', brand: Brand.GitHub }]),
        { id: 'none', label: 'Not now' },
      ],
      after: (id) =>
        id === 'linear'
          ? {
              prose: 'Made a Linear team, Tidepool (TID), and linked it. Hand me an issue and its task links back to it.',
              made: { issues: 'linear' },
            }
          : id === 'host'
            ? { prose: 'Its issues are GitHub’s, on balazs/tidepool.', made: { issues: 'host' } }
            : { prose: 'Fine. Link one any time in its settings, or ask me.', made: { issues: 'none' } },
    },
  ]
}

function AskScene({ state, setup }: { state: State; setup: Setup }) {
  const asks = asksOf(state, setup)
  const [made, setMade] = useState<Made>(() => firstMade(state))
  const [answers, setAnswers] = useState<string[]>([])
  const [thinking, setThinking] = useState(false)
  const answer = (ask: Asked, id: string) => {
    if (thinking) return
    setAnswers((now) => [...now, id])
    setThinking(true)
    setTimeout(() => {
      setMade((m) => ({ ...m, ...ask.after(id).made }))
      setThinking(false)
    }, 900)
  }
  const current = thinking ? undefined : asks[answers.length]
  // Typed answers count too: the first option the words name.
  const say = (text: string) => {
    if (current === undefined) return
    const low = text.toLowerCase()
    const found = current.options.find((o) => low.includes(o.id) || low.includes(o.label.toLowerCase()))
    if (found !== undefined) answer(current, found.id)
  }
  const shown = thinking ? answers.length : answers.length + 1
  return (
    <Window
      made={made}
      composer={<Talk placeholder="Answer, or tell the coordinator something" onSay={say} />}
      talk={
        <Thread label="Conversation">
          {asks.slice(0, shown).map((ask, i) => {
            const chosen = answers[i]
            const after = chosen === undefined || (thinking && i === answers.length - 1) ? null : ask.after(chosen)
            return (
              <Fragment key={ask.id}>
                <Turn voice="Coordinator" at="now">
                  {i === 0 && <WorkedFor took="3s" />}
                  <Prose>{ask.prose}</Prose>
                  {chosen === undefined && (
                    <div className={s.replies}>
                      {ask.options.map((option, k) => (
                        <Button
                          key={option.id}
                          size="small"
                          variant={k === 0 ? 'signal' : 'default'}
                          onClick={() => answer(ask, option.id)}
                        >
                          <span className={s.reply}>
                            {option.brand !== undefined && <BrandMark brand={option.brand} size={13} />}
                            {option.label}
                          </span>
                        </Button>
                      ))}
                    </div>
                  )}
                </Turn>
                {chosen !== undefined && <You at="now">{ask.options.find((o) => o.id === chosen)?.label ?? chosen}</You>}
                {after?.line !== undefined && <AltharLine>{after.line}</AltharLine>}
                {after?.prose !== undefined && (
                  <Turn voice="Coordinator" at="now">
                    <Prose>{after.prose}</Prose>
                  </Turn>
                )}
              </Fragment>
            )
          })}
        </Thread>
      }
    />
  )
}

/* ---- D: only what blocks, now; where its code goes once there's something to send ---- */

const FILES = [
  { path: 'src/stations.ts', add: 96, del: 0 },
  { path: 'src/main.ts', add: 22, del: 4 },
]

function BlockScene({ state, setup }: { state: State; setup: Setup }) {
  const need = gitNeed(state)
  const later = state === 'later'
  const [made, setMade] = useState<Made>(() => (later ? { git: 'fine', code: 'unasked', issues: 'unasked' } : firstMade(state)))
  const [putting, setPutting] = useState<Host | null>(null)
  const [merged, setMerged] = useState(false)
  const [linking, setLinking] = useState(false)
  const hosts = hostsOf(setup)
  const line = codeLine(made.code)
  const actions = isHost(made.code) ? (
    <>
      <Button variant="signal">Open a draft pull request</Button>
      <Button onClick={() => setMerged(true)}>Merge into main</Button>
    </>
  ) : (
    <>
      <Button variant="signal" onClick={() => setMerged(true)}>
        Merge into main
      </Button>
      {hosts.length > 0 && (
        <Menu label="Put it on" trigger={<Button trailingIcon="down">Put it on a host first</Button>}>
          {hosts.map((id) => (
            <MenuItem key={id} lead={<BrandMark brand={HOST[id].brand} size={14} />} onSelect={() => setPutting(id)}>
              {HOST[id].name}
            </MenuItem>
          ))}
        </Menu>
      )}
    </>
  )
  const talk = later ? (
    <Thread label="Conversation">
      <You at="10:12">Add a station picker, with the five nearest stations first.</You>
      <TaskMark task="1" verb="finished" detail="Sonnet 5 led" at="10:31" steps={['Implement']} step={0} now="Done" last onJump={noop} />
      <div className={s.walkCard}>
        <SizeMotion step={putting ?? (merged ? 'merged' : isHost(made.code) ? 'pr' : 'branch')}>
          {putting !== null ? (
            <HostCard
              host={putting}
              onDone={() => {
                setMade((m) => ({ ...m, code: putting }))
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
      {line !== null && <AltharLine>{line}</AltharLine>}
    </Thread>
  ) : (
    <Thread label="Conversation">
      {made.git === 'needed' ? (
        <div className={s.walkCard}>
          <GitCard need={need} onDone={() => setMade((m) => ({ ...m, git: 'done' }))} />
        </div>
      ) : made.git === 'done' ? (
        <AltharLine>Set up git in tidepool: {gitDone(need)}.</AltharLine>
      ) : null}
    </Thread>
  )
  // Issues come in from where issues would show: the board's empty Up next.
  const upNext = linking ? (
    <div className={s.inLane}>
      <TeamCard onDone={() => setLinking(false)} />
    </div>
  ) : (
    <BoardEmpty
      title="Nothing queued"
      action={
        <LinkButton onClick={() => setLinking(true)}>
          {linearOf(setup) ? 'Bring in its issues from Linear' : 'Connect Linear, Jira or Trello'}
        </LinkButton>
      }
    >
      Tell the coordinator what you want done. The tasks it plans line up here.
    </BoardEmpty>
  )
  return <Window made={made} composer={<Talk />} talk={talk} upNext={upNext} />
}

/* ---- Step one: the New project page as it is, taking any folder ---- */

function NewProjectStage({ state, onCreate }: { state: State; onCreate: () => void }) {
  const [name, setName] = useState('Tidepool')
  const [ink, setInk] = useState(INK)
  const where = state === 'unreadable' ? '~/Documents/tidepool' : '~/code/tidepool'
  const error =
    state === 'unreadable' ? (
      <>
        Althar can’t read tidepool: macOS keeps Documents closed until you allow it. <LinkButton>Allow in System Settings</LinkButton>
      </>
    ) : state === 'project' ? (
      <>
        tidepool is Tidepool already. <LinkButton>Open Tidepool</LinkButton>
      </>
    ) : null
  return (
    <NewProject
      seed={SEED}
      name={name}
      onNameChange={setName}
      ink={ink}
      onInkChange={setInk}
      folders={[{ id: 'tidepool', name: 'tidepool', where, host: null, remote: null }]}
      onRemove={noop}
      onChoose={noop}
      found={{ like: null, first: [], more: [] }}
      onAdd={noop}
      onCreate={() => {
        if (error === null) onCreate()
      }}
      onCancel={noop}
      error={error}
    />
  )
}

/* ---- The lab ---- */

function Lab() {
  const [direction, setDirection] = useState<Direction>(pick(directions, params.get('d'), 'a'))
  const [state, setState] = useState<State>(pick(states, params.get('s'), 'files'))
  const [setup, setSetup] = useState<Setup>(pick(setups, params.get('c'), 'all'))
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  const [inProject, setInProject] = useState(params.get('p') === '1')
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
    if (inProject) url.searchParams.set('p', '1')
    url.searchParams.set('theme', theme)
    history.replaceState(null, '', url)
  }, [direction, state, setup, theme, inProject])
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
      if (key === 'r') {
        setInProject(false)
        return setRound((now) => now + 1)
      }
      if (key === 't') setTheme((now) => (now === 'dark' ? 'light' : 'dark'))
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])
  const scene = `${direction}-${state}-${setup}-${round}`
  const project = inProject || state === 'later'
  return (
    <div className={s.lab}>
      <main className={s.scene}>
        {!project ? (
          <div className={s.page}>
            <NewProjectStage key={scene} state={state} onCreate={() => setInProject(true)} />
          </div>
        ) : state === 'later' || direction === 'd' ? (
          <BlockScene key={scene} state={state} setup={setup} />
        ) : direction === 'a' ? (
          <CardScene key={scene} state={state} setup={setup} />
        ) : direction === 'b' ? (
          <WalkScene key={scene} state={state} setup={setup} />
        ) : (
          <AskScene key={scene} state={state} setup={setup} />
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
          <button type="button" onClick={() => setInProject((now) => !now)}>
            {project ? 'Back to New project' : 'Skip to the project'}
          </button>
          <button
            type="button"
            onClick={() => {
              setInProject(false)
              setRound((now) => now + 1)
            }}
          >
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
