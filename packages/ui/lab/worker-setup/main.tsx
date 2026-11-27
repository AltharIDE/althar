import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/styles/global.css'

import { type ReactNode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { Brand } from '../../src/foundations/brands/brands'
import { Icon } from '../../src/foundations/Icon/Icon'
import { AGENTS_BUSY, LOAD_BUSY, LOAD_SLOTS } from '../../src/fixtures/load'
import { Button } from '../../src/primitives/Button/Button'
import { CheckList } from '../../src/primitives/CheckList/CheckList'
import { Dialog } from '../../src/primitives/Dialog/Dialog'
import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { Spinner } from '../../src/primitives/Spinner/Spinner'
import { AddWorkerDialog } from '../../src/setup/Computers/AddWorker'
import { type ComputerWorker, Computers } from '../../src/setup/Computers/Computers'
import s from '../../src/setup/Computers/Computers.module.css'
import { AgentsAtOnce, SettingGroup, SettingList, SettingRow } from '../../src/setup/Preferences/Preferences'
import { SettingsLayout } from '../../src/setup/SettingsLayout/SettingsLayout'
import { SettingsNav } from '../../src/setup/SettingsNav/SettingsNav'
import { SheetFact } from '../../src/setup/ToolTiles/ToolParts'
import { CheckRows, type Snap, useChecks } from './checks'
import l from './lab.module.css'

/*
 * What happens right after a worker connects: three directions on the real Settings › Computers and Add a worker.
 *   A · Carry on here: the Add a worker dialog goes on into four steps, one at a time.
 *   B · On its sheet: the dialog closes, and the worker's own sheet holds a Getting it ready list, in any order.
 *   C · Checked, not asked: Althar picks what it can, runs the first check at once, and asks only where one fails.
 * Keys: A B C to switch, T for light or dark, R to start again. ?snap=failing or ?snap=ready opens at a state.
 */

const params = new URLSearchParams(location.search)
const SNAP = (params.get('snap') as Snap) ?? null
const STEP = Number(params.get('step') ?? '0')
/* ?still drops the kit's enter animations, so a screenshot taken at load isn't caught mid fade. */
if (params.has('still')) document.head.insertAdjacentHTML('beforeend', '<style>*,*::before,*::after{animation:none!important;transition:none!important}</style>')

const PROJECTS = [
  { id: 'althar', name: 'Althar' },
  { id: 'mobile', name: 'Althar mobile' },
  { id: 'site', name: 'Charrette site' },
]
const MACHINE = { count: 2, memory: 16, cores: 4 }

const worker = (over: Partial<ComputerWorker> = {}): ComputerWorker => ({
  id: 'wrk_aa123578b8724b209ffa0f8562e0afc4',
  name: 'hermes-box',
  kind: 'Linux · x64 · 4 cores',
  state: 'free',
  task: null,
  memoryFree: '13.1 GB',
  diskFree: '41 GB',
  agents: [
    { id: 'claude-code', name: 'Claude Code', mark: Brand.ClaudeCode, signedIn: false },
    { id: 'codex', name: 'Codex', mark: Brand.Codex, signedIn: true },
  ],
  projects: [],
  projectIds: [],
  managed: true,
  reachable: true,
  ...over,
})

/** Settings › Computers, as the window has it, with what the direction lays over it. */
function Frame({ children, line }: { children?: ReactNode; line?: string }) {
  const [opened, setOpened] = useState<string | null>(null)
  return (
    <SettingsLayout
      section="computers"
      title="Computers"
      lede="Where your agents run."
      side={
        <SettingsNav
          label="Settings"
          groups={[
            [
              { id: 'accounts', title: 'Accounts', icon: 'use' },
              { id: 'agents', title: 'Agents', icon: 'agents' },
              { id: 'computers', title: 'Computers', icon: 'computer' },
            ],
            [
              { id: 'general', title: 'General', icon: 'gear' },
              { id: 'rules', title: 'Rules', icon: 'lock' },
            ],
          ]}
          value="computers"
          onChange={() => {}}
        />
      }
    >
      <Computers
        home={{ name: 'This Mac', load: LOAD_BUSY, agents: AGENTS_BUSY }}
        workers={{ enabled: true, list: [worker()] }}
        slots={LOAD_SLOTS}
        opened={opened}
        onOpen={setOpened}
        onAdd={() => {}}
        onRemove={() => {}}
        text={line === undefined ? {} : { state: { working: 'At work', free: 'Setting up', full: 'Full', offline: 'Offline' }, stateLine: () => line }}
      />
      {children}
    </SettingsLayout>
  )
}

/** The moment it connects, as the dialog has it today: every step ticked, waiting for it. */
function Connecting({ onClose }: { onClose: () => void }) {
  return (
    <AddWorkerDialog
      home="This Mac"
      way="ssh"
      onWay={() => {}}
      address="hermes-box"
      onAddress={() => {}}
      onAdd={() => {}}
      setup={{ name: 'hermes-box', phase: 'done', at: 5, facts: 'Linux · x64 · 41 GB free', version: '0.2.0' }}
      onTrust={() => {}}
      onAgain={() => {}}
      onStop={() => {}}
      code={null}
      onClose={onClose}
    />
  )
}

/** Shows the dialog at its connecting moment for a beat, unless a state was asked for. */
function useConnected() {
  const [connected, setConnected] = useState(SNAP !== null || STEP > 0)
  useEffect(() => {
    if (connected) return
    const timer = window.setTimeout(() => setConnected(true), 1600)
    return () => window.clearTimeout(timer)
  }, [connected])
  return connected
}

/* ── A · Carry on here ─────────────────────────────────────────────────── */

const A_STEPS = ['Its projects', 'Its agents', 'Tasks at once', 'A first task'] as const

function DirectionA() {
  const connected = useConnected()
  const [open, setOpen] = useState(true)
  const [step, setStep] = useState(SNAP === 'ready' ? 4 : STEP)
  const [picked, setPicked] = useState<readonly string[]>(step > 0 ? ['althar'] : [])
  const [atOnce, setAtOnce] = useState(MACHINE.count)
  const agents = useChecks(['sandbox', 'claude', 'codex'], step >= 1, step > 1 || SNAP === 'ready' ? 'ready' : step === 1 ? SNAP : null)
  const first = useChecks(['reach', 'setup', 'mcp', 'task'], step >= 3, step === 3 ? SNAP : SNAP === 'ready' ? 'ready' : null)
  const canGo = step === 0 ? picked.length > 0 : step === 1 ? agents.ready : step === 3 ? first.ready : true
  const summary = [
    PROJECTS.filter((one) => picked.includes(one.id))
      .map((one) => one.name)
      .join(', '),
    'Claude Code, Codex',
    `${atOnce} at once`,
    'Ran a short task in Althar',
  ]
  const body = (index: number) => {
    if (index === 0)
      return (
        <span className={l.under}>
          <CheckList label="Its projects" items={PROJECTS.map((one) => ({ id: one.id, label: one.name }))} value={picked} onChange={setPicked} />
        </span>
      )
    if (index === 1) return <CheckRows label="Its agents" {...agents} />
    if (index === 2)
      return (
        <span className={l.under}>
          <SettingList>
            <AgentsAtOnce compact count={atOnce} machine={MACHINE} most={6} onChange={(n) => setAtOnce(n ?? MACHINE.count)} />
          </SettingList>
        </span>
      )
    return <CheckRows label="A first task" {...first} />
  }
  if (!open) return <Frame line={step >= 4 ? 'Ready for a task' : `Setting up: ${A_STEPS[step]?.toLowerCase()} next`} />
  return (
    <Frame>
      {!connected ? (
        <Connecting onClose={() => setOpen(false)} />
      ) : (
        <Dialog
          title={step >= 4 ? 'hermes-box is ready' : 'Set up hermes-box'}
          description="Connected to This Mac · Linux · x64 · 4 cores"
          onClose={() => setOpen(false)}
          width={560}
          actions={
            step >= 4 ? (
              <>
                <Button onClick={() => setOpen(false)}>Close</Button>
                <Button variant="signal" onClick={() => setOpen(false)}>
                  Give it a task
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => setOpen(false)}>Finish later</Button>
                <Button variant="signal" disabled={!canGo} onClick={() => setStep(step + 1)}>
                  {step === 3 ? 'Done' : 'Continue'}
                </Button>
              </>
            )
          }
        >
          <ol className={s.installSteps} aria-label="Set up hermes-box">
            {A_STEPS.map((label, index) => {
              const state = index < step ? 'done' : index === step ? 'now' : 'later'
              return (
                <li key={label} data-state={state}>
                  <span className={s.tick}>
                    {state === 'done' ? <Icon name="check" size={10} /> : state === 'now' ? <span className={l.dot} /> : null}
                  </span>
                  <span className={s.installWords}>
                    <span className={s.installLabel}>{label}</span>
                    {state === 'done' && <span className={s.installDetail}>{summary[index]}</span>}
                    {state === 'now' && body(index)}
                  </span>
                </li>
              )
            })}
          </ol>
        </Dialog>
      )}
    </Frame>
  )
}

/* ── B · On its sheet ──────────────────────────────────────────────────── */

function Tick({ done, busy }: { done: boolean; busy?: boolean }) {
  return (
    <span className={l.tick} data-done={done}>
      {done ? <Icon name="check" size={10} /> : busy === true ? <Spinner size="small" /> : null}
    </span>
  )
}

function DirectionB() {
  const connected = useConnected()
  const [dialog, setDialog] = useState(true)
  const [opened, setOpened] = useState<string | null>('wrk_aa123578b8724b209ffa0f8562e0afc4')
  const [picked, setPicked] = useState<readonly string[]>(SNAP === null ? [] : ['althar'])
  const [atOnce, setAtOnce] = useState<number | null>(SNAP === 'ready' ? MACHINE.count : null)
  const [row, setRow] = useState<string | null>(SNAP === 'failing' ? 'check' : null)
  const [checking, setChecking] = useState(SNAP !== null)
  const agents = useChecks(['sandbox', 'claude', 'codex'], connected, SNAP)
  const first = useChecks(['reach', 'setup', 'mcp', 'task'], checking, SNAP)
  const left = [picked.length === 0, !agents.ready, atOnce === null, !first.ready].filter(Boolean).length
  const toggle = (id: string) => setRow(row === id ? null : id)
  const open = (id: string, label: string, done: boolean) => (
    <LinkButton onClick={() => toggle(id)} aria-expanded={row === id}>
      {row === id ? 'Close' : done ? 'Change' : label}
    </LinkButton>
  )
  const projectNames = PROJECTS.filter((one) => picked.includes(one.id)).map((one) => one.name)
  return (
    <SettingsLayout
      section="computers"
      title="Computers"
      lede="Where your agents run."
      side={
        <SettingsNav
          label="Settings"
          groups={[
            [
              { id: 'accounts', title: 'Accounts', icon: 'use' },
              { id: 'agents', title: 'Agents', icon: 'agents' },
              { id: 'computers', title: 'Computers', icon: 'computer' },
            ],
            [
              { id: 'general', title: 'General', icon: 'gear' },
              { id: 'rules', title: 'Rules', icon: 'lock' },
            ],
          ]}
          value="computers"
          onChange={() => {}}
        />
      }
    >
      {opened !== null && connected && (
        <SettingGroup
          title={left === 0 ? 'hermes-box is ready' : 'Getting hermes-box ready'}
          note={left === 0 ? 'It takes Althar’s tasks now.' : `${left} of 4 left. It takes no tasks until they’re done.`}
          className={l.ready}
        >
          <SettingList>
            <SettingRow
              title="Its projects"
              note={projectNames.length > 0 ? projectNames.join(', ') : 'None yet'}
              mark={<Tick done={picked.length > 0} />}
              under={
                row === 'projects' ? (
                  <CheckList label="Its projects" items={PROJECTS.map((one) => ({ id: one.id, label: one.name }))} value={picked} onChange={setPicked} />
                ) : undefined
              }
            >
              {() => open('projects', 'Pick', picked.length > 0)}
            </SettingRow>
            <SettingRow
              title="Its agents"
              note={agents.ready ? 'Claude Code, Codex' : agents.failing > 0 ? `${agents.failing} need you` : 'Looking…'}
              mark={<Tick done={agents.ready} busy={!agents.ready && agents.failing === 0} />}
              under={row === 'agents' ? <CheckRows label="Its agents" {...agents} /> : undefined}
            >
              {() => open('agents', 'Fix', agents.ready)}
            </SettingRow>
            <SettingRow
              title="Tasks at once"
              note={atOnce === null ? `${MACHINE.count}, from its 4 cores and 16 GB` : `${atOnce}`}
              mark={<Tick done={atOnce !== null} />}
              under={
                row === 'atonce' ? (
                  <SettingList>
                    <AgentsAtOnce compact count={atOnce ?? MACHINE.count} machine={MACHINE} most={6} onChange={(n) => setAtOnce(n ?? MACHINE.count)} />
                  </SettingList>
                ) : undefined
              }
            >
              {() =>
                atOnce === null ? (
                  <span className={l.ways}>
                    <LinkButton onClick={() => toggle('atonce')}>Change</LinkButton>
                    <Button size="small" onClick={() => setAtOnce(MACHINE.count)}>
                      Keep {MACHINE.count}
                    </Button>
                  </span>
                ) : (
                  open('atonce', 'Change', true)
                )
              }
            </SettingRow>
            <SettingRow
              title="A first task"
              note={first.ready ? 'Ran a short task in Althar' : checking ? (first.failing > 0 ? `${first.failing} need you` : 'Running…') : 'Checks it can run one, in each of its projects'}
              mark={<Tick done={first.ready} busy={checking && !first.ready && first.failing === 0} />}
              under={row === 'check' && checking ? <CheckRows label="A first task" {...first} /> : undefined}
            >
              {() =>
                checking ? (
                  open('check', 'Fix', first.ready)
                ) : (
                  <Button
                    size="small"
                    disabled={picked.length === 0}
                    onClick={() => {
                      setChecking(true)
                      setRow('check')
                    }}
                  >
                    Run it
                  </Button>
                )
              }
            </SettingRow>
          </SettingList>
        </SettingGroup>
      )}
      <Computers
        home={{ name: 'This Mac', load: LOAD_BUSY, agents: AGENTS_BUSY }}
        workers={{
          enabled: true,
          list: [worker({ projects: projectNames, projectIds: picked, agents: worker().agents.map((one) => ({ ...one, signedIn: one.id === 'codex' || agents.ready })) })],
        }}
        slots={LOAD_SLOTS}
        opened={opened}
        onOpen={setOpened}
        onAdd={() => {}}
        onRemove={() => {}}
        text={left === 0 ? {} : { state: { working: 'At work', free: 'Not ready yet', full: 'Full', offline: 'Offline' }, stateLine: () => `${left} of 4 to set up` }}
      />
      {dialog && !connected && <Connecting onClose={() => setDialog(false)} />}
    </SettingsLayout>
  )
}

/* ── C · Checked, not asked ────────────────────────────────────────────── */

function DirectionC() {
  const connected = useConnected()
  const [open, setOpen] = useState(true)
  const [picked, setPicked] = useState<readonly string[]>(['althar'])
  const [atOnce, setAtOnce] = useState(MACHINE.count)
  const [changing, setChanging] = useState<'projects' | 'atonce' | null>(null)
  const checks = useChecks(['reach', 'setup', 'sandbox', 'claude', 'codex', 'mcp', 'task'], connected, SNAP)
  const names = PROJECTS.filter((one) => picked.includes(one.id)).map((one) => one.name)
  if (!open) return <Frame line={checks.ready ? 'Ready for a task' : `${checks.failing} things need you before it takes tasks`} />
  return (
    <Frame>
      {!connected ? (
        <Connecting onClose={() => setOpen(false)} />
      ) : (
        <Dialog
          title={checks.ready ? 'hermes-box is ready' : 'Getting hermes-box ready'}
          description={checks.ready ? `It takes ${names.join(' and ')}’s tasks, ${atOnce} at once.` : 'Connected. Althar is trying a task there.'}
          onClose={() => setOpen(false)}
          width={560}
          actions={
            checks.ready ? (
              <>
                <Button onClick={() => setOpen(false)}>Close</Button>
                <Button variant="signal" onClick={() => setOpen(false)}>
                  Give it a task
                </Button>
              </>
            ) : (
              <Button onClick={() => setOpen(false)}>Finish later</Button>
            )
          }
        >
          <div className={s.adding}>
            <div className={l.facts}>
              <SheetFact label="Works on">
                <span className={l.fact}>
                  <span>{names.length === 0 ? 'None yet' : names.join(', ')}</span>
                  <LinkButton onClick={() => setChanging(changing === 'projects' ? null : 'projects')}>
                    {changing === 'projects' ? 'Done' : 'Change'}
                  </LinkButton>
                </span>
                {changing === 'projects' && (
                  <CheckList label="Works on" keepOne items={PROJECTS.map((one) => ({ id: one.id, label: one.name }))} value={picked} onChange={setPicked} />
                )}
              </SheetFact>
              <SheetFact label="Tasks at once">
                <span className={l.fact}>
                  <span>
                    {atOnce}
                    {atOnce === MACHINE.count && <span className={l.quiet}> · from its 4 cores and 16 GB</span>}
                  </span>
                  <LinkButton onClick={() => setChanging(changing === 'atonce' ? null : 'atonce')}>{changing === 'atonce' ? 'Done' : 'Change'}</LinkButton>
                </span>
                {changing === 'atonce' && (
                  <SettingList>
                    <AgentsAtOnce compact count={atOnce} machine={MACHINE} most={6} onChange={(n) => setAtOnce(n ?? MACHINE.count)} />
                  </SettingList>
                )}
              </SheetFact>
            </div>
            <CheckRows label="Getting hermes-box ready" {...checks} />
          </div>
        </Dialog>
      )}
    </Frame>
  )
}

/* ── The page and its switcher ─────────────────────────────────────────── */

const DIRECTIONS = [
  { key: 'a', name: 'Carry on here', make: () => <DirectionA /> },
  { key: 'b', name: 'On its sheet', make: () => <DirectionB /> },
  { key: 'c', name: 'Checked, not asked', make: () => <DirectionC /> },
] as const

function Lab() {
  const [at, setAt] = useState(() => Math.max(0, DIRECTIONS.findIndex((one) => one.key === params.get('d'))))
  const [dark, setDark] = useState(params.get('theme') === 'dark')
  const [run, setRun] = useState(0)
  useEffect(() => {
    if (dark) document.documentElement.dataset.theme = 'dark'
    else delete document.documentElement.dataset.theme
  }, [dark])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return
      const index = DIRECTIONS.findIndex((one) => one.key === event.key.toLowerCase())
      if (index >= 0) {
        setAt(index)
        setRun((n) => n + 1)
      }
      if (event.key.toLowerCase() === 't') setDark((on) => !on)
      if (event.key.toLowerCase() === 'r') setRun((n) => n + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const direction = DIRECTIONS[at] ?? DIRECTIONS[0]
  return (
    <div className={l.page}>
      <div className={l.stage} key={`${direction.key}-${run}`}>
        {direction.make()}
      </div>
      <div className={l.bar} role="toolbar" aria-label="Directions">
        {DIRECTIONS.map((one, index) => (
          <button
            key={one.key}
            type="button"
            className={l.pick}
            aria-pressed={index === at}
            onClick={() => {
              setAt(index)
              setRun((n) => n + 1)
            }}
          >
            <span className={l.key}>{one.key.toUpperCase()}</span>
            {one.name}
          </button>
        ))}
        <span className={l.gap} />
        <button type="button" className={l.pick} onClick={() => setDark(!dark)}>
          <span className={l.key}>T</span>
          {dark ? 'Dark' : 'Light'}
        </button>
        <button type="button" className={l.pick} onClick={() => setRun(run + 1)}>
          <span className={l.key}>R</span>
          Start again
        </button>
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) createRoot(root).render(<Lab />)
