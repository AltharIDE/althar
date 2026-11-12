import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { type ReactNode, StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { createRoot } from 'react-dom/client'

import {
  AltharLine,
  Board,
  BoardCard,
  BoardColumn,
  BoardEmpty,
  type BoardFolds,
  BoardLane,
  BranchChip,
  Brand,
  Button,
  Composer,
  type ComposerFile,
  EmptyState,
  Fact,
  Icon,
  IconButton,
  type LaunchPick,
  type LaunchStep,
  LinkButton,
  ModelPick,
  ProjectHeader,
  ProjectInk,
  ProjectMark,
  type ProjectPart,
  ProjectTabs,
  Prose,
  Room,
  TaskFace,
  TaskKind,
  TaskLaunch,
  TaskMark,
  TaskStatus,
  Thread,
  ThreadSkeleton,
  trackOf,
  Turn,
  WorkedFor,
  You,
} from '@althar/ui'
import { device } from '@althar/ui/device'

import { OPUS, SONNET, effortFor, useModelPrefs } from '../../../../packages/ui/src/fixtures/models'
import s from './lab.module.css'

/*
 * The new-project lab (README.md): setting up a project in a folder with no
 * remote, in the project's own window, on the kit's real pieces, with no
 * runtime. A: the new tab is the project already, waiting for its folder;
 * dropped, it is named, read and opened, and its first task is planned. B:
 * you name it and say what you're making, and it opens with that under way.
 * Neither asks where its code goes: with no remote, work merges into main on
 * this computer, and a remote is one sentence to the coordinator, later.
 */

const directions = [
  { key: 'a', label: 'Drop it in' },
  { key: 'b', label: 'Say what you’re making' },
] as const
type Direction = (typeof directions)[number]['key']

const states = [
  { key: 'empty', label: 'Empty folder' },
  { key: 'files', label: 'Files, no git' },
  { key: 'unborn', label: 'Git, no commits' },
  { key: 'local', label: 'Git, no remote' },
  { key: 'unreadable', label: 'Can’t be read' },
  { key: 'project', label: 'Already a project' },
  { key: 'working', label: 'Later: at work' },
  { key: 'remote', label: 'Later: on GitHub' },
] as const
type State = (typeof states)[number]['key']

/** What each state does in Althar as it is. */
const today: Record<State, string> = {
  empty:
    'Today: refused, “There’s no git repository in tidepool.” New repository… would make ~/code/tidepool/tidepool, a folder deeper than meant.',
  files: 'Today: refused the same way. The only way in is git init in a terminal, then choosing it again.',
  unborn: 'Today: the project is made, then its first task fails: git worktree add … fatal: invalid reference: main. Nothing says why.',
  local: 'Today: works. The row says “no remote”, and a task’s outputs say “No code host”, as if something were missing.',
  unreadable: 'Today: called “There’s no git repository in tidepool.”, the wrong reason, with no way to fix it.',
  project: 'Today: it’s added again, as a second project on the same folder, with a line saying so.',
  working: 'Today: tasks merge into main on this Mac; their card says “No code host”, and once merged “It has no remote to push to.”',
  remote: 'Today: nothing in Althar adds a remote. One added with git remote add is read on the next look.',
}

const params = new URLSearchParams(location.search)
const pick = <K extends string>(list: ReadonlyArray<{ key: K }>, value: string | null, fallback: K) =>
  list.find((one) => one.key === value)?.key ?? fallback

const here = device.this
const README = 'A tide table for the Pacific coast, in the browser.'
const SEED = 'prj_tidepool'
const INK = ProjectInk.Teal

interface Folder {
  readonly name: string
  readonly where: string
  /** What the composer's chip says under its name. */
  readonly meta: string
}
const FOLDER: Record<State, Folder> = {
  empty: { name: 'tidepool', where: '~/code/tidepool', meta: 'Empty' },
  files: { name: 'tidepool', where: '~/code/tidepool', meta: '14 files' },
  unborn: { name: 'tidepool', where: '~/code/tidepool', meta: '14 files' },
  local: { name: 'tidepool', where: '~/code/tidepool', meta: '14 files' },
  unreadable: { name: 'tidepool', where: '~/Documents/tidepool', meta: '' },
  project: { name: 'tidepool', where: '~/code/tidepool', meta: '14 files' },
  working: { name: 'tidepool', where: '~/code/tidepool', meta: '' },
  remote: { name: 'tidepool', where: '~/code/tidepool', meta: '' },
}
/** The id a project's mark is drawn from: Tidepool's own, or what its name would give. */
const seedOf = (name: string) => (name.trim().toLowerCase() === 'tidepool' ? SEED : `prj_${name.trim().toLowerCase()}`)
const titled = (folder: string) => folder.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** What Althar did to the folder so tasks can start: said once, as the project's first line. */
const gitLine: Partial<Record<State, string>> = {
  empty: 'Started git in tidepool, on main.',
  files: 'Started git in tidepool, on main, with its 14 files as the first commit.',
  unborn: 'Made tidepool’s first commit on main, with its 14 files.',
}

/* ---- The pieces every scene shares ---- */

/** Arrives once: fades in where it will stay, after a beat, as streamed words do. */
function Arrive({ children, after = 0 }: { children: ReactNode; after?: number }) {
  const el = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = el.current
    if (node === null || typeof node.animate !== 'function') return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: after, fill: 'backwards' })
      return
    }
    node.animate(
      [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: 260,
        delay: after,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'backwards',
      },
    )
  }, [after])
  return (
    <div ref={el} className={s.arrive}>
      {children}
    </div>
  )
}

function usePicker() {
  const prefs = useModelPrefs()
  return ({ agent, owner }: LaunchPick) => (
    <ModelPick
      variant="field"
      placement="below"
      owner={owner}
      model={agent}
      pinned={prefs.pinned}
      effort={effortFor(agent, prefs.efforts)}
      defaultEffort={effortFor(agent, prefs.efforts)}
      onChange={() => {}}
      onEffort={() => {}}
    />
  )
}

const FOLDS: BoardFolds = { collapsed: [], opened: [] }
const noop = () => undefined

/**
 * The project's window, as the desktop draws it: its tabs, its header once
 * it has a name, then the conversation beside the board. `named` is null
 * while the tab is still a new project.
 */
function Window({
  named,
  pop,
  parts = [],
  running = 0,
  talk,
  composer,
  board,
}: {
  named: string | null
  /** The name and mark just landed: the mark grows in from the drop. */
  pop?: boolean
  parts?: ProjectPart[]
  running?: number
  talk: ReactNode
  composer?: ReactNode
  board: ReactNode
}) {
  const head = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (pop !== true || head.current === null) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const marks = head.current.querySelectorAll<HTMLElement>('[aria-hidden="true"]:has(> svg)')
    marks.forEach((mark) =>
      mark.animate(
        [
          { transform: 'scale(0.6)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        {
          duration: 420,
          easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
        },
      ),
    )
  }, [pop, named])
  return (
    <div className={s.window}>
      <div ref={head}>
        <ProjectTabs
          lights="drawn"
          tabs={[
            { id: 'meridian', name: 'Meridian', seed: 'meridian', ink: ProjectInk.Clay, running: true, yours: 0 },
            {
              id: 'new',
              name: named ?? 'New project',
              seed: named === null ? 'new' : seedOf(named),
              ink: named === null ? ProjectInk.Sand : INK,
              running: running > 0,
              yours: 0,
            },
          ]}
          current="new"
          yours={0}
          onSelect={noop}
          onClose={noop}
          end={<IconButton icon="gear" label="Settings" kbd="⌘," size="small" />}
        />
        {
          <ProjectHeader
            name={named ?? 'New project'}
            seed={named === null ? 'new' : seedOf(named)}
            ink={named === null ? ProjectInk.Sand : INK}
            yours={0}
            inProgress={running}
            onYours={noop}
            room={Room.Both}
            onRoom={noop}
            parts={parts}
          />
        }
      </div>
      <div className={s.rooms}>
        <div className={s.talk}>
          <TaskFace className={s.face} composer={composer}>
            {talk}
          </TaskFace>
        </div>
        <div className={s.board}>{board}</div>
      </div>
    </div>
  )
}

function EmptyBoard({ name }: { name: string }) {
  return (
    <Board label={`${name}’s work`} defaultFolds={FOLDS}>
      <BoardColumn
        lane={BoardLane.Next}
        count={0}
        empty={<BoardEmpty title="Nothing queued">Tell the coordinator what you want done. The tasks it plans line up here.</BoardEmpty>}
      />
      <BoardColumn lane={BoardLane.Running} count={0} />
      <BoardColumn lane={BoardLane.Yours} count={0} />
      <BoardColumn lane={BoardLane.Settled} count={0} />
    </Board>
  )
}

const LOCAL_PART: ProjectPart = { id: 'tidepool', name: 'tidepool', openLabel: 'Show in Finder', onOpen: noop }
const GITHUB_PART: ProjectPart = {
  id: 'tidepool',
  name: 'tidepool',
  brand: Brand.GitHub,
  openLabel: 'Open on GitHub',
  onOpen: noop,
}

/* ---- The project, opened: its first word and its first task ---- */

const SETUP: LaunchStep[] = [{ id: 'impl', label: 'Implement', agents: [OPUS], fixed: 'the lead' }]

/** What the coordinator says first, having read the folder: what it is, and what happens with no remote. */
function firstWord(state: State, said: string | null): { prose: ReactNode; task: string } {
  if (state === 'empty')
    return {
      prose: (
        <>
          <p>
            A first task sets Tidepool up from that: Vite and TypeScript, a page with today’s tides, and how it runs, kept for the tasks
            after.
          </p>
          <p>With no remote, finished work merges into main here, on {here}.</p>
        </>
      ),
      task: 'Set up Tidepool',
    }
  return {
    prose: (
      <>
        <p>
          Tidepool is a tide table in TypeScript and Vite, reading NOAA’s predictions for one station.
          {said !== null && said !== README
            ? ' A first task learns how it runs, then it’s ready for that.'
            : ' A first task learns how it runs and keeps that for the tasks after.'}
        </p>
        <p>With no remote, finished work merges into main here, on {here}.</p>
      </>
    ),
    task: 'Learn how Tidepool runs',
  }
}

function Opened({
  state,
  said,
  pop,
  reading,
}: {
  state: State
  /** What the person said they're making, in B; in A with an empty folder, once they say it. */
  said: string | null
  pop: boolean
  reading: boolean
}) {
  const picker = usePicker()
  const [draft, setDraft] = useState('')
  const [asked, setAsked] = useState<string | null>(said)
  const [started, setStarted] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const waiting = state === 'empty' && asked === null
  useEffect(() => {
    if (!reading && waiting) input.current?.focus()
  }, [reading, waiting])
  const word = firstWord(state, asked)
  const line = gitLine[state]
  const talk = (
    <Thread label="Conversation">
      {reading ? (
        <ThreadSkeleton label="Reading tidepool" />
      ) : (
        <>
          {line !== undefined && (
            <Arrive>
              <AltharLine>{line}</AltharLine>
            </Arrive>
          )}
          {state === 'empty' && said === null && (
            <Arrive after={280}>
              <Turn voice="Coordinator" at="now">
                <Prose>What are you making?</Prose>
              </Turn>
            </Arrive>
          )}
          {!waiting && (
            <>
              {asked !== null && (
                <Arrive after={said === null ? 0 : 200}>
                  <You at="now">{asked}</You>
                </Arrive>
              )}
              <Arrive after={said === null && asked !== null ? 500 : 380}>
                <Turn voice="Coordinator" at="now">
                  <WorkedFor took={state === 'empty' ? '4s' : '9s'} />
                  <Prose>{word.prose}</Prose>
                </Turn>
              </Arrive>
              <Arrive after={said === null && asked !== null ? 1000 : 900}>
                <TaskLaunch
                  task="1"
                  preset="Change"
                  title={word.task}
                  project="Tidepool"
                  estimate="About 6 min"
                  defaultSteps={SETUP}
                  picker={picker}
                  hideEnd
                  wait={20}
                  onStart={() => setStarted(true)}
                />
              </Arrive>
            </>
          )}
        </>
      )}
    </Thread>
  )
  const composer = (
    <Composer
      value={draft}
      onChange={setDraft}
      onSubmit={(text) => {
        if (text.trim() === '') return
        if (waiting) setAsked(text.trim())
        setDraft('')
      }}
      inputRef={input}
      placeholder={waiting ? README : 'Tell the coordinator something'}
    />
  )
  const board = started ? (
    <Board label="Tidepool’s work" defaultFolds={FOLDS}>
      <BoardColumn lane={BoardLane.Next} count={0} />
      <BoardColumn lane={BoardLane.Running} count={1}>
        <BoardCard
          status={TaskStatus.Running}
          word="Implement"
          kind={TaskKind.Change}
          at="now"
          title={word.task}
          track={trackOf(['Implement'], 0)}
          object={<BranchChip name="tidepool/learn-how-it-runs" add={0} del={0} />}
          foot={<Fact>{OPUS.short} leads</Fact>}
          onOpen={noop}
        />
      </BoardColumn>
      <BoardColumn lane={BoardLane.Yours} count={0} />
      <BoardColumn lane={BoardLane.Settled} count={0} />
    </Board>
  ) : (
    <EmptyBoard name="Tidepool" />
  )
  return <Window named="Tidepool" pop={pop} parts={[LOCAL_PART]} running={started ? 1 : 0} talk={talk} composer={composer} board={board} />
}

/* ---- What can't go on: said where the folder would have gone, with the way out ---- */

function Refused({ state, onAnother }: { state: State; onAnother: () => void }) {
  if (state === 'project')
    return (
      <EmptyState
        mark={<ProjectMark seed={SEED} ink={INK} size={28} />}
        title="tidepool is Tidepool already"
        line="Made on 3 Nov, with 4 tasks settled."
        actions={
          <>
            <Button variant="signal">Open Tidepool</Button>
            <LinkButton onClick={onAnother}>Choose another folder</LinkButton>
          </>
        }
      />
    )
  return (
    <EmptyState
      icon="lock"
      title="Althar can’t open tidepool"
      line={`${here === 'this Mac' ? 'macOS' : 'The system'} keeps Documents closed to Althar until you allow it.`}
      actions={
        <>
          <Button variant="signal">Allow in System Settings</Button>
          <LinkButton onClick={onAnother}>Choose another folder</LinkButton>
        </>
      }
    />
  )
}

/* ---- A: the new tab is the project, waiting for its folder ---- */

function DropScene({ state }: { state: State }) {
  const [phase, setPhase] = useState<'waiting' | 'reading' | 'open' | 'refused'>('waiting')
  const [over, setOver] = useState(false)
  const take = () => {
    setOver(false)
    if (state === 'unreadable' || state === 'project') return setPhase('refused')
    setPhase('reading')
    setTimeout(() => setPhase('open'), 1100)
  }
  // A folder dropped anywhere on the window, as the app takes one.
  useEffect(() => {
    if (phase === 'open' || phase === 'reading') return
    const enter = (event: DragEvent) => {
      event.preventDefault()
      setOver(true)
    }
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setOver(false)
    }
    const drop = (event: DragEvent) => {
      event.preventDefault()
      take()
    }
    window.addEventListener('dragover', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  })
  if (phase === 'reading' || phase === 'open')
    return <Opened state={state} said={null} pop={phase === 'reading'} reading={phase === 'reading'} />
  return (
    <Window
      named={null}
      talk={
        <div className={s.invite}>
          {phase === 'refused' ? (
            <Arrive>
              <Refused state={state} onAnother={() => setPhase('waiting')} />
            </Arrive>
          ) : (
            <div className={s.drop} data-over={over}>
              <span className={s.dropGlyph} aria-hidden="true">
                <Icon name="folder" size={22} />
              </span>
              <h2 className={s.dropTitle}>Drop its folder here</h2>
              <p className={s.dropLine}>Empty, a few files or a whole repository.</p>
              <div className={s.dropActions}>
                <Button onClick={take} data-first>
                  Choose a folder…
                </Button>
                <Button variant="quiet" onClick={take}>
                  Start in a new folder
                </Button>
              </div>
            </div>
          )}
        </div>
      }
      board={<EmptyBoard name="The project" />}
    />
  )
}

/* ---- B: name it, say what you're making ---- */

function SayScene({ state }: { state: State }) {
  const folder = FOLDER[state]
  const known = state === 'files' || state === 'unborn' || state === 'local' || state === 'project'
  const [name, setName] = useState(titled(folder.name))
  const [said, setSaid] = useState(known ? README : '')
  const [phase, setPhase] = useState<'naming' | 'reading' | 'open'>('naming')
  const [chip, setChip] = useState(true)
  const nameField = useRef<HTMLInputElement>(null)
  const sayField = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const field = sayField.current
    if (field === null) return
    field.focus()
    field.select()
  }, [])
  const seed = name.trim() === '' ? 'new' : seedOf(name)
  const bad = chip && (state === 'unreadable' || state === 'project')
  const start = (text: string) => {
    if (bad || name.trim() === '') return
    setSaid(text.trim())
    setPhase('reading')
    setTimeout(() => setPhase('open'), 700)
  }
  if (phase !== 'naming') return <Opened state={state} said={said === '' ? null : said} pop={false} reading={phase === 'reading'} />
  const files: ComposerFile[] = chip
    ? [{ id: 'folder', name: folder.name, folder: true, meta: folder.meta === '' ? folder.where : `${folder.where} · ${folder.meta}` }]
    : []
  return (
    <Window
      named={name.trim() === '' ? null : name.trim()}
      talk={
        <div className={s.begin}>
          <div className={s.beginInner}>
            <label className={s.nameRow}>
              <span key={seed} className={s.markSwap}>
                <ProjectMark seed={seed} ink={seed === 'new' ? ProjectInk.Sand : INK} size={40} />
              </span>
              <input
                ref={nameField}
                className={s.bigName}
                value={name}
                placeholder="Name it"
                aria-label="Name"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    sayField.current?.focus()
                  }
                }}
              />
            </label>
            <Composer
              value={said}
              onChange={setSaid}
              onSubmit={start}
              inputRef={sayField}
              placeholder="What are you making?"
              files={files}
              onRemoveFile={() => setChip(false)}
              onAddFiles={() => setChip(true)}
              text={{ send: `Start ${name.trim() === '' ? 'it' : name.trim()}` }}
            />
            <div className={s.whereRow}>
              {bad ? (
                <Arrive>
                  <Refused state={state} onAnother={() => setChip(false)} />
                </Arrive>
              ) : chip ? null : (
                // With no folder of its own, a new one named after it.
                <p className={s.where}>
                  <Icon name="folder" size={13} />
                  <span>New folder</span>
                  <code>~/code/{name.trim().toLowerCase().replace(/\s+/g, '-') || 'new-project'}</code>
                  <LinkButton onClick={() => setChip(true)}>Choose a folder…</LinkButton>
                </p>
              )}
            </div>
          </div>
        </div>
      }
      board={<EmptyBoard name="The project" />}
    />
  )
}

/* ---- Later: at work with no remote, and the sentence that makes one ---- */

function LaterScene({ state }: { state: State }) {
  const [onHost, setOnHost] = useState(state === 'remote')
  const [draft, setDraft] = useState(state === 'working' ? 'Put it on GitHub' : '')
  const [asking, setAsking] = useState(false)
  const talk = (
    <Thread label="Conversation">
      <TaskMark task="1" verb="merged" detail="into main" at="10:04" steps={['Implement']} step={0} now="Settled" onJump={noop} />
      <You at="10:12">Add a station picker, with the five nearest stations first.</You>
      <Turn voice="Coordinator" at="10:12">
        <Prose>One task: Sonnet builds the picker, using the run steps the first task kept.</Prose>
      </Turn>
      <TaskMark
        task="2"
        verb="started"
        detail={`${SONNET.short} leads`}
        at="10:12"
        steps={['Implement']}
        step={0}
        now="Implement"
        last
        onJump={noop}
      />
      {(asking || onHost) && (
        <>
          <You at="10:31">Put it on GitHub</You>
          {asking && !onHost ? (
            <ThreadSkeleton label="Making balazs/tidepool" />
          ) : (
            <Arrive>
              <Turn voice="Coordinator" at="10:31">
                <WorkedFor took="8s" />
                <Prose>
                  <p>
                    It’s on GitHub, private, at{' '}
                    <a href="https://github.com/balazs/tidepool" onClick={(event) => event.preventDefault()}>
                      balazs/tidepool
                    </a>
                    , with main pushed. Tasks open pull requests there from now on; the station picker will too.
                  </p>
                </Prose>
              </Turn>
            </Arrive>
          )}
        </>
      )}
    </Thread>
  )
  const composer = (
    <Composer
      value={draft}
      onChange={setDraft}
      onSubmit={(text) => {
        if (!/github/i.test(text)) return setDraft('')
        setDraft('')
        setAsking(true)
        setTimeout(() => setOnHost(true), 1400)
      }}
      placeholder="Tell the coordinator something"
    />
  )
  const board = (
    <Board label="Tidepool’s work" defaultFolds={FOLDS}>
      <BoardColumn lane={BoardLane.Next} count={0} />
      <BoardColumn lane={BoardLane.Running} count={1}>
        <BoardCard
          status={TaskStatus.Running}
          word="Implement"
          kind={TaskKind.Change}
          at="19m"
          title="Add a station picker"
          track={trackOf(['Implement'], 0)}
          object={<BranchChip name="tidepool/station-picker" add={142} del={9} />}
          foot={<Fact>{SONNET.short} leads</Fact>}
          onOpen={noop}
        />
      </BoardColumn>
      <BoardColumn lane={BoardLane.Yours} count={0} />
      <BoardColumn lane={BoardLane.Settled} count={1}>
        <BoardCard
          status={TaskStatus.Done}
          word="Merged"
          kind={TaskKind.Change}
          at="27m"
          title="Learn how Tidepool runs"
          object={<BranchChip name="main" add={38} del={0} />}
          foot={<Fact>Merged into main</Fact>}
          onOpen={noop}
        />
      </BoardColumn>
    </Board>
  )
  return <Window named="Tidepool" parts={[onHost ? GITHUB_PART : LOCAL_PART]} running={1} talk={talk} composer={composer} board={board} />
}

/* ---- The lab ---- */

function Lab() {
  const [direction, setDirection] = useState<Direction>(pick(directions, params.get('d'), 'a'))
  const [state, setState] = useState<State>(pick(states, params.get('s'), 'files'))
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  const [round, setRound] = useState(0)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    const url = new URL(location.href)
    url.search = ''
    url.searchParams.set('d', direction)
    url.searchParams.set('s', state)
    url.searchParams.set('theme', theme)
    history.replaceState(null, '', url)
  }, [direction, state, theme])
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
      if (key === 'r') return setRound((now) => now + 1)
      if (key === 't') setTheme((now) => (now === 'dark' ? 'light' : 'dark'))
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])
  const later = state === 'working' || state === 'remote'
  const scene = `${direction}-${state}-${round}`
  return (
    <div className={s.lab}>
      <main className={s.scene}>
        {later ? (
          <LaterScene key={scene} state={state} />
        ) : direction === 'a' ? (
          <DropScene key={scene} state={state} />
        ) : (
          <SayScene key={scene} state={state} />
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
