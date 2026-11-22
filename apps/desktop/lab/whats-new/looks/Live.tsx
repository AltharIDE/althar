import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'

import {
  type AcpConnectionDraft,
  AgentCatalog,
  Brand,
  CanvasLine,
  type CatalogAgent,
  Composer,
  type ComposerComment,
  Decision,
  Goal,
  Heading,
  type LaunchStep,
  type ModelInfo,
  Permission,
  RunMark,
  type SavedAcpConnection,
  Select,
  StatusDrawer,
  StatusLine,
  type StatusItem,
  TaskLaunch,
  Terminal,
} from '@althar/ui'

import { Releases, WayIn, Words } from '../parts'
import { dated, FELT, FLAGSHIP, FLAGSHIP_WHY, type Highlight, HIGHLIGHTS, NOW } from '../notes'
import s from './live.module.css'

/*
 * Look 2, the real thing: each of 0.10.0's features shown by the kit's own
 * piece of it, live on a stage beside its words, as the person will meet it
 * in the window. The flagship by a held task's card with its Run on choice;
 * computer use by the ask it makes; artifacts by a drawn version and the
 * comments waiting in the composer; goals by the composer's goal; more
 * agents by Settings' catalog; terminals by the window's foot with its
 * drawer up. Every piece can be pressed; nothing it does leaves its stage.
 */

const OPUS: ModelInfo = {
  id: 'claude-opus-5-5',
  name: 'Claude Opus 5.5',
  short: 'Opus 5.5',
  mark: Brand.Anthropic,
  runtime: 'claude-code',
  efforts: ['Low', 'Medium', 'High', 'Max'],
}
const SOL: ModelInfo = {
  id: 'gpt-6.1-sol',
  name: 'GPT-6.1 Sol',
  short: 'Sol',
  mark: Brand.OpenAI,
  runtime: 'codex',
  efforts: ['Low', 'Medium', 'High', 'Extra high'],
}

const highlight = (name: string): Highlight => HIGHLIGHTS.find((one) => one.name === name)!

/** A feature: its words on one side, its stage on the other, swapping sides down the page. */
function Feature({
  name,
  words,
  ways,
  flip = false,
  height,
  align = 'center',
  children,
}: {
  name: string
  words: string
  ways?: ReactNode
  flip?: boolean
  /** The stage's height, pinned, so what happens on it never moves the page. */
  height: number
  /** Where the piece sits on its stage: what grows upward, as the composer does, sits at its foot. */
  align?: 'center' | 'end'
  children: ReactNode
}) {
  return (
    <section className={s.feature} data-flip={flip || undefined} aria-label={name}>
      <div className={s.words}>
        <p className={s.kicker}>New</p>
        <Heading level={2} className={s.name}>
          {name}
        </Heading>
        <p className={s.text}>
          <Words text={words} />
        </p>
        {ways !== undefined && <div className={s.ways}>{ways}</div>}
      </div>
      <div className={s.stage} data-align={align} style={{ '--h': `${height}px` } as CSSProperties}>
        {children}
      </div>
    </section>
  )
}

/* ---- the flagship: a held task's card, and where it runs ---- */

const STEPS: readonly LaunchStep[] = [
  { id: 'lead', label: 'Implement', agents: [OPUS], fixed: 'the lead' },
  { id: 'review', label: 'Review', agents: [SOL], optional: true },
]

function Placement() {
  const [worker, setWorker] = useState('auto')
  return (
    <div className={s.piece}>
      <TaskLaunch
        task="1162"
        title="Run the checkout tests in every browser"
        project="althar"
        defaultSteps={STEPS}
        picker={() => null}
        held
        hideEnd
        onStart={() => {}}
        footNote={
          <>
            <Select
              label="Run on"
              variant="filled"
              value={worker}
              options={[
                { value: 'home', label: 'This home' },
                { value: 'auto', label: 'Best available worker' },
                { value: 'runner-1', label: 'runner-1' },
                { value: 'runner-2', label: 'runner-2' },
              ]}
              onChange={setWorker}
            />
            {worker !== 'home' && (
              <>
                {' '}
                <output>Setup and lead run on the worker. Review runs on this home.</output>
              </>
            )}
          </>
        }
      />
    </div>
  )
}

/* ---- computer use: the ask it makes, once a turn ---- */

function ComputerAsk() {
  // Answered, it folds to its line; Undo brings the ask back, so it can be tried again.
  return (
    <div className={s.piece}>
      <Permission
        id="computer-use"
        project="althar"
        step="Implement"
        agent={OPUS}
        what="Use the apps on your computer this turn"
        cmd="Simulator, Safari"
        why="To sign in on the iOS app and check the new checkout screen."
        offers={[Decision.AllowOnce, Decision.Deny]}
        onUndo={() => {}}
      />
    </div>
  )
}

/* ---- artifacts you talk to: a version drawn, and what you said of the last ---- */

const COMMENTS: readonly ComposerComment[] = [
  {
    id: 'c1',
    n: 1,
    note: 'Say what it costs first',
    place: 'h1.hero',
    facts: [
      { label: 'On', value: 'h1.hero', kind: 'code' },
      { label: 'Says', value: 'Plans for every team', kind: 'quote' },
    ],
  },
  {
    id: 'c2',
    n: 2,
    note: 'Less space under the plans',
    place: 'section.plans',
    facts: [
      { label: 'On', value: 'section.plans', kind: 'code' },
      { label: 'Gap', value: '96px', kind: 'words' },
    ],
  },
]

function ArtifactTalk() {
  const [comments, setComments] = useState(COMMENTS)
  const [draft, setDraft] = useState('')
  return (
    <div className={s.piece}>
      <CanvasLine
        className={s.drawn}
        canvas={{ canvasId: 'pricing', name: 'pricing', title: 'Pricing page', kind: 'html', version: 3 }}
        action="published"
        note="The price leads now, and the plans sit closer."
      />
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={() => {
          setDraft('')
          setComments([])
        }}
        placeholder="Say what you think"
        comments={comments}
        onRemoveComment={(id) => setComments(comments.filter((one) => one.id !== id))}
      />
    </div>
  )
}

/* ---- goals: the composer's goal, at work ---- */

function GoalAtWork() {
  const [expanded, setExpanded] = useState(true)
  const [status, setStatus] = useState<'active' | 'paused'>('active')
  const [objective, setObjective] = useState('Get the checkout tests passing in every supported browser.')
  const [cleared, setCleared] = useState(false)
  const [draft, setDraft] = useState('')
  return (
    <div className={s.piece}>
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={(text) => {
          setDraft('')
          const goal = /^\/goal\s+(.+)/.exec(text.trim())
          if (goal?.[1] !== undefined) {
            setObjective(goal[1])
            setStatus('active')
            setCleared(false)
          }
        }}
        placeholder={cleared ? '/goal and what it should reach' : 'Tell the lead'}
        above={
          cleared ? undefined : (
            <Goal
              goal={{
                objective,
                status,
                rounds: 3,
                roundLimit: 12,
                progress: status === 'active' ? 'Passing in Chromium and Firefox. WebKit next.' : null,
                detail: null,
                waiting: false,
              }}
              objectiveLimit={4000}
              expanded={expanded}
              onExpand={setExpanded}
              onPause={() => setStatus('paused')}
              onResume={() => setStatus('active')}
              onEdit={setObjective}
              onClear={() => setCleared(true)}
            />
          )
        }
      />
    </div>
  )
}

/* ---- more agents: Settings' catalog ---- */

const connection = (id: string, name: string, command: string, args: readonly string[]): AcpConnectionDraft => ({
  id,
  name,
  command,
  args,
  mode: null,
  readerMode: null,
  modeOption: 'mode',
  modelOption: 'model',
  effortOption: null,
  held: {},
  registryId: id,
  registryVersion: null,
})

const REGISTRY: readonly CatalogAgent[] = [
  {
    id: 'goose',
    name: 'Goose',
    description: 'An open agent that runs on your machine.',
    version: '1.9.0',
    guide: null,
    command: 'goose',
    args: ['acp'],
    mode: null,
    readerMode: null,
  },
  {
    id: 'kimi',
    name: 'Kimi CLI',
    description: 'Moonshot’s coding agent, in the terminal.',
    version: '0.42.0',
    guide: null,
    command: 'kimi',
    args: ['--acp'],
    mode: null,
    readerMode: null,
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    description: 'Alibaba’s coding agent for Qwen3 Coder.',
    version: '0.8.1',
    guide: null,
    command: 'qwen',
    args: ['--experimental-acp'],
    mode: null,
    readerMode: null,
  },
]

const ADDED: readonly SavedAcpConnection[] = [
  { connection: connection('goose', 'Goose', 'goose', ['acp']), state: 'ready', reason: null, version: '1.9.0' },
  { connection: connection('kimi', 'Kimi CLI', 'kimi', ['--acp']), state: 'checking', reason: null, version: null },
]

function Agents() {
  const [connections, setConnections] = useState(ADDED)
  const timers = useRef<number[]>([])
  const settle = (id: string) =>
    timers.current.push(
      window.setTimeout(
        () =>
          setConnections((now) =>
            now.map((one) =>
              one.connection.id === id ? { ...one, state: 'ready', version: one.connection.registryVersion ?? '0.42.0' } : one,
            ),
          ),
        1600,
      ),
    )
  const check = (id: string) => {
    setConnections((now) => now.map((one) => (one.connection.id === id ? { ...one, state: 'checking', reason: null } : one)))
    settle(id)
  }
  // Kimi CLI's check, under way as the page opens, comes back.
  useEffect(() => {
    settle('kimi')
    const pending = timers.current
    return () => pending.forEach((one) => window.clearTimeout(one))
  }, [])
  return (
    <div className={s.piece}>
      <AgentCatalog
        items={REGISTRY}
        connections={connections}
        onRefresh={() => {}}
        onSave={(draft, saved) => {
          setConnections((now) => [
            ...now.filter((one) => one.connection.id !== draft.id),
            { connection: draft, state: 'unchecked', reason: null, version: null },
          ])
          saved?.()
        }}
        onCheck={check}
        onRemove={(id) => setConnections((now) => now.filter((one) => one.connection.id !== id))}
        onGuide={() => {}}
      />
    </div>
  )
}

/* ---- terminals: the window's foot, its drawer up ---- */

const FOOT: readonly StatusItem[] = [
  { kind: 'run', id: 'dev', name: 'dev', phase: 'up', url: 'http://localhost:5173' },
  { kind: 'run', id: 'test', name: 'test', phase: 'finished' },
  { kind: 'terminal', id: 'zsh', name: 'althar' },
]

const OUTPUT: Record<string, { command?: string; lines: string[]; exit?: number; live?: string }> = {
  dev: {
    lines: [
      '  VITE v7.1.3  ready in 412 ms',
      '',
      '  ➜  Local:   http://localhost:5173/',
      '  ➜  Network: use --host to expose',
      '19:04:31 [vite] hmr update /src/checkout/Pay.tsx',
    ],
    live: '',
  },
  test: {
    command: 'bun run test checkout',
    lines: [
      ' ✓ checkout/cart (12)',
      ' ✓ checkout/pay (9)',
      ' ✓ checkout/receipt (4)',
      '',
      ' Test Files  3 passed (3)',
      '      Tests  25 passed (25)',
    ],
    exit: 0,
  },
  zsh: { command: 'git status --short', lines: [' M src/checkout/Pay.tsx', ' M src/checkout/Pay.test.tsx'], live: '' },
}

function Foot() {
  const [chosen, setChosen] = useState<string | undefined>('dev')
  const [items, setItems] = useState(FOOT)
  const [height, setHeight] = useState(196)
  const item = items.find((one) => one.id === chosen)
  const out = chosen === undefined ? undefined : OUTPUT[chosen]
  return (
    <div className={s.window}>
      <div className={s.foot}>
        {item !== undefined && out !== undefined && (
          <StatusDrawer
            label="Runs and terminals"
            height={height}
            max={236}
            onHeight={setHeight}
            onLower={() => setChosen(undefined)}
            title={
              <span className={s.drawerTitle}>
                {item.kind === 'run' && <RunMark phase={item.phase} />}
                <span className={s.drawerName}>{item.name}</span>
                {item.kind === 'run' && item.url !== undefined && (
                  <span className={s.drawerWhere}>{item.url.replace(/^https?:\/\//, '')}</span>
                )}
              </span>
            }
          >
            <Terminal
              flush
              lines={out.lines}
              {...(out.command === undefined ? {} : { command: out.command })}
              {...(out.exit === undefined ? {} : { exit: out.exit })}
              {...(out.live === undefined ? {} : { live: out.live })}
            />
          </StatusDrawer>
        )}
        <StatusLine
          items={items}
          {...(chosen === undefined ? {} : { chosen })}
          onPress={(id) => setChosen(chosen === id ? undefined : id)}
          onDismiss={(id) => {
            setItems(items.filter((one) => one.id !== id))
            if (chosen === id) setChosen(undefined)
          }}
          onNewTerminal={() => {}}
          newTerminalKbd="Ctrl+`"
        />
      </div>
    </div>
  )
}

/** Look 2: the real thing. */
export function Live({ back }: { back?: ReactNode }) {
  const computer = highlight('Computer use')
  const artifacts = highlight('Artifacts you talk to')
  const goals = highlight('Goals')
  const agents = highlight('More agents')
  const terminals = highlight('Terminals in Althar')
  return (
    <div className={s.page}>
      <div className={s.column}>
        {back}
        <header className={s.hero}>
          <p className={s.eyebrow}>
            <span className={s.version}>Althar {NOW.version}</span> · {dated(NOW.date)}
          </p>
          <Heading level={1} className={s.title}>
            {NOW.title}
          </Heading>
          <p className={s.lede}>Your own host and workers, computer use, artifacts you talk to, goals, and more.</p>
        </header>

        <Feature
          name={FLAGSHIP.title}
          words={FLAGSHIP_WHY}
          height={380}
          ways={
            <>
              <WayIn way={{ label: 'Connect a home', to: 'homes' }} />
              <WayIn way={{ label: 'Add a worker', to: 'workers' }} />
            </>
          }
        >
          <Placement />
        </Feature>
        <Feature name={computer.name} words={computer.whole} height={340} flip>
          <ComputerAsk />
        </Feature>
        <Feature name={artifacts.name} words={artifacts.whole} height={320} align="end">
          <ArtifactTalk />
        </Feature>
        <Feature name={goals.name} words={goals.whole} height={320} align="end" flip>
          <GoalAtWork />
        </Feature>
        <Feature name={agents.name} words={agents.whole} height={320} ways={<WayIn way={agents.way} />}>
          <Agents />
        </Feature>
        <Feature name={terminals.name} words={terminals.whole} height={340} flip>
          <Foot />
        </Feature>

        <section className={s.felt} aria-labelledby="live-felt">
          <Heading level={2} id="live-felt" className={s.feltTitle}>
            Also improved
          </Heading>
          <ul className={s.feltList}>
            {FELT.map((one) => (
              <li key={one.name}>
                <span className={s.feltName}>{one.name}</span>
                <span className={s.feltLine}>{one.line}</span>
              </li>
            ))}
          </ul>
        </section>

        <Releases className={s.releases} />
      </div>
    </div>
  )
}
