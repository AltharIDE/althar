import {
  AcceptCard,
  Accounts,
  type AccountEntry,
  AllowedBy,
  Board,
  BoardColumn,
  BoardLane,
  BoardList,
  Brand,
  Button,
  CallCard,
  ChromeButton,
  Composer,
  Connections,
  EdgeSheet,
  GraphChanged,
  GraphNodeState,
  IconButton,
  Island,
  Issue,
  Logo,
  NeedCard,
  NeedChange,
  NeedCommand,
  NeedOptions,
  NextRow,
  ProjectHead,
  ProjectTabs,
  RateLimit,
  Review,
  Room,
  RoomSwitch,
  type RuntimeEntry,
  RuntimeState,
  type ServiceConnection,
  type ServiceOption,
  SettledRow,
  TaskCard,
  TaskLaunch,
  type LaunchStep,
  TaskStatus,
  TitleBar,
  Turn,
  Verdict,
  FindingState,
  WorkCard,
  WorkStatus,
  You,
  ModelPick,
  AgentTabs,
  ControlAgents,
  ControlDetail,
  ControlFoot,
  ControlGrid,
  ControlMarks,
  ControlModule,
  ControlPicture,
  ControlToggle,
  Icon,
  ModelSwitches,
} from '@althar/ui'
import { Home, ProjectRules } from '@althar/ui/screens'
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'

// Prototype: the kit's demo world, read from its source. Ported, the site would keep its own copy.
import { CALLS, NEXT, READY_TWO_REPOS, RUNNING as BOARD_RUNNING, SETTLED } from '../../../../../../packages/ui/src/fixtures/board'
import {
  FROM_231,
  MER_231,
  PLAN_432,
  STAGES,
  T432,
  ALWAYS_ASK,
  ALWAYS_ON,
  NEVER,
  NEVER_ON,
} from '../../../../../../packages/ui/src/fixtures/coordinator'
import { EDGE_NEEDS, EDGE_WORK, edgeRowOf, NOTCH } from '../../../../../../packages/ui/src/fixtures/edge'
import { DECISION, PROJECT_LIST, PUBLISH, READY, RUNNING, SINCE } from '../../../../../../packages/ui/src/fixtures/home'
import { MARKED } from '../../../../../../packages/ui/src/fixtures/marks'
import { FINDINGS, PROJECT, reviewDoc, STEPS } from '../../../../../../packages/ui/src/fixtures/meridian'
import { CODEX, GEMINI_PRO, OPUS, QWEN, SONNET } from '../../../../../../packages/ui/src/fixtures/models'
import { SERVICES } from '../../../../../../packages/ui/src/fixtures/setup'
import appIcon from '../../../../../desktop/resources/icons/cobalt.svg?url'
import s from './app.module.css'

/*
 * The app, as the pictures show it: whole windows and single pieces, drawn
 * by @althar/ui's own components with the kit's demo world (Meridian, a
 * payments API, and task 432, the refunds backfill from Linear's MER-231),
 * touched up where a picture wants it: every account a person might have,
 * all six code hosts and trackers connected.
 */

const none = () => {}

/* ---- the frame every window shares: the tabs, with the system's lights drawn ---- */

const TABS = MARKED.map((p) => ({ id: p.id, name: p.name, seed: p.id, ink: p.ink, running: p.running, yours: p.yours ? 1 : 0 }))

export function Tabs({ current }: { current: string | null }) {
  return <ProjectTabs tabs={TABS.slice(0, 3)} current={current} onSelect={none} onClose={none} yours={3} lights="drawn" />
}

/* ---- the home: what needs you across every project, what runs, what happened ---- */

export function HomeWindow({
  className,
  style,
  looked = '3 h ago',
  narrow = false,
}: {
  className?: string
  style?: CSSProperties
  looked?: string
  /** Laid out for a narrow window: the stream alone. */
  narrow?: boolean
}) {
  const needs = [
    <NeedCard
      key="publish"
      kind={PUBLISH.kind}
      project={PUBLISH.project}
      task={PUBLISH.task}
      title={PUBLISH.title}
      at={PUBLISH.at}
      detail={<NeedCommand command={PUBLISH.command} agent={PUBLISH.agent} step={PUBLISH.step} />}
      actions={
        <>
          <Button size="small">Deny</Button>
          <Button size="small" variant="signal">
            Allow once
          </Button>
        </>
      }
    />,
    <NeedCard
      key="accept"
      kind={READY.kind}
      project={READY.project}
      task={READY.task}
      title={READY.title}
      at={READY.at}
      detail={<NeedChange {...READY.change} />}
      actions={<Button size="small">Review</Button>}
    />,
    <NeedCard
      key="decision"
      kind={DECISION.kind}
      project={DECISION.project}
      task={DECISION.task}
      title={DECISION.title}
      at={DECISION.at}
      detail={<NeedOptions options={DECISION.options} />}
      actions={<Button size="small">Decide</Button>}
    />,
  ]
  return (
    <div className={`${s.window} ${narrow ? s.narrow : ''} ${className ?? ''}`} style={style}>
      {!narrow && <Tabs current={null} />}
      <TitleBar
        lights="none"
        end={
          <>
            <WorkStatus running={RUNNING.length} yours={3} />
            <IconButton icon="gear" label="Settings" kbd="⌘," size="small" />
          </>
        }
      >
        <span className={s.brand}>
          <Logo size={15} />
          Althar
        </span>
      </TitleBar>
      <div className={s.body}>
        <Home
          waiting={3}
          needs={needs}
          running={RUNNING}
          since={SINCE}
          looked={looked}
          projects={PROJECT_LIST}
          onOpenTask={none}
          onOpenEvent={none}
          onOpenProject={none}
          onTalk={none}
          onOpenFolder={none}
        />
      </div>
    </div>
  )
}

/* ---- where task 432 comes from: Linear's MER-231 ---- */

export function Issue231() {
  return <Issue {...MER_231} />
}

/* ---- the lead's plan for task 432: its team, step by step ---- */

/** The plan, put together a step at a time when `assemble` is set, as the lead does it. */
export function useAssembling(assemble: boolean, plan: readonly LaunchStep[] = PLAN_432) {
  const [shown, setShown] = useState(assemble ? 0 : plan.length)
  useEffect(() => {
    if (!assemble) return setShown(plan.length)
    setShown(0)
    let n = 0
    const timer = window.setInterval(() => {
      n += 1
      setShown(n)
      if (n >= plan.length) window.clearInterval(timer)
    }, 520)
    return () => window.clearInterval(timer)
  }, [assemble, plan])
  return plan.slice(0, shown)
}

export function Launch({
  steps,
  wait = 30,
  task = '432',
  title = 'Backfill idempotency keys on refunds created before PR 1184',
  from = true,
  estimate,
  narrow = false,
}: {
  steps?: readonly LaunchStep[]
  wait?: number
  task?: string
  title?: string
  from?: boolean
  estimate?: string
  /** Laid out for a narrow window: each step's agents under its name, the estimate shorter. */
  narrow?: boolean
}) {
  const plan = steps ?? PLAN_432
  estimate ??= narrow ? 'About 40 min · about $2' : 'About 40 min · about $2 on your subscriptions'
  const launch = (
    <TaskLaunch
      task={task}
      title={title}
      {...(from ? { from: FROM_231 } : {})}
      project={PROJECT}
      estimate={estimate}
      steps={plan}
      picker={({ agent, owner }) => (
        <ModelPick
          variant="field"
          placement="below"
          owner={owner}
          model={agent}
          pinned={[]}
          effort="High"
          defaultEffort="High"
          onChange={none}
          onEffort={none}
        />
      )}
      wait={wait}
      onStart={none}
    />
  )
  return narrow ? <div className={s.narrowPlan}>{launch}</div> : launch
}

/** A plan growing a step at a time (`children`), over the room it takes once `whole`, so nothing under it moves as it grows. */
export function Growing({ children, whole }: { children: ReactNode; whole: ReactNode }) {
  return (
    <div className={s.reserve}>
      <div aria-hidden="true">{whole}</div>
      {children}
    </div>
  )
}

/* ---- a project, its conversation beside its board, as Both shows it ---- */

const ASK = 'Backfill idempotency keys on the refunds made before PR 1184. MER-231 has the details.'

export function ProjectWindow({
  conversation,
  thread,
  talkOnly = false,
  centered = false,
  meta = 'Payments API · 3 repositories',
  className,
  style,
}: {
  /** What the conversation shows under your ask; by default, the lead's plan. */
  conversation?: ReactNode
  /** The whole conversation, in place of your ask, the reply and `conversation`. */
  thread?: ReactNode
  /** Only the conversation, as on a narrow window. */
  talkOnly?: boolean
  /** Only the conversation, in a column down the middle of a wide window. */
  centered?: boolean
  meta?: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className={`${s.window} ${talkOnly ? s.talkOnly : ''} ${centered ? s.centered : ''} ${className ?? ''}`} style={style}>
      {!talkOnly && <Tabs current="meridian" />}
      <TitleBar
        lights="none"
        end={
          <>
            {!talkOnly && <WorkStatus running={4} yours={2} />}
            <ChromeButton icon="plus" label="New task" />
          </>
        }
      >
        <RoomSwitch value={talkOnly || centered ? Room.Talk : Room.Both} onChange={none} text={{ key: () => '' }} />
      </TitleBar>
      <div className={s.rooms}>
        <div className={s.talk}>
          <ProjectHead title="Meridian" meta={meta} side={!centered} />
          <div className={s.thread}>
            {thread ?? (
              <>
                <You at="11:01">{ASK}</You>
                <Turn voice="Meridian’s coordinator" at="11:01">
                  <p className={s.said}>One task. It writes to money records, so your security review applies, and a second lab reviews.</p>
                </Turn>
                {conversation ?? <Launch />}
              </>
            )}
          </div>
          <div className={s.composer}>
            <Composer value="" onChange={none} onSubmit={none} placeholder="Tell Meridian what you want done" hint="⌘L" />
          </div>
        </div>
        {!talkOnly && !centered && (
          <div className={s.board}>
            <MeridianBoard />
          </div>
        )}
      </div>
    </div>
  )
}

/* ---- Meridian's board ---- */

export function MeridianBoard() {
  return (
    <Board label="Meridian’s work">
      <BoardColumn lane={BoardLane.Next} count={NEXT.length}>
        <BoardList>
          {NEXT.map((x, i) => (
            <NextRow key={x.task} {...x} place={i + 1} />
          ))}
        </BoardList>
      </BoardColumn>
      <BoardColumn lane={BoardLane.Running} count={BOARD_RUNNING.length}>
        {BOARD_RUNNING.map((x) => (
          <WorkCard key={x.task} {...x} />
        ))}
      </BoardColumn>
      <BoardColumn lane={BoardLane.Yours} count={CALLS.length}>
        <AcceptCard {...READY_TWO_REPOS} />
        {CALLS.slice(0, 2).map((x) => (
          <CallCard key={x.title} {...x} />
        ))}
      </BoardColumn>
      <BoardColumn lane={BoardLane.Settled} count={SETTLED.length}>
        <BoardList>
          {SETTLED.map((x) => (
            <SettledRow key={x.task} {...x} />
          ))}
        </BoardList>
      </BoardColumn>
    </Board>
  )
}

/* ---- the agents and every account on them ---- */

export const CLAUDE_ACCOUNTS: AccountEntry[] = [
  {
    id: 'c_main',
    name: 'Personal',
    place: { kind: 'usual' },
    state: { kind: 'ready', paid: 'plan' },
    who: 'you@hey.com',
    plan: 'Claude Max',
  },
  {
    id: 'c_work',
    name: 'Northwind',
    place: { kind: 'own' },
    state: { kind: 'out', back: '14:00' },
    who: 'dana@northwind.io',
    plan: 'Claude Team',
  },
]
export const CODEX_ACCOUNTS: AccountEntry[] = [
  {
    id: 'x_main',
    name: 'Personal',
    place: { kind: 'usual' },
    state: { kind: 'ready', paid: 'plan' },
    who: 'you@hey.com',
    plan: 'ChatGPT Pro',
  },
  {
    id: 'x_work',
    name: 'Northwind',
    place: { kind: 'own' },
    state: { kind: 'ready', paid: 'plan' },
    who: 'dana@northwind.io',
    plan: 'ChatGPT Team',
  },
  {
    id: 'x_client',
    name: 'Client',
    place: { kind: 'adopted', folder: '~/.codex-client', from: 'codex-profiles' },
    state: { kind: 'ready', paid: 'plan' },
    plan: 'ChatGPT Plus',
  },
]
export const OPENCODE_ACCOUNTS: AccountEntry[] = [
  { id: 'o_router', name: 'OpenRouter', place: { kind: 'usual' }, state: { kind: 'ready', paid: 'key' }, who: 'key ····9c1e' },
  { id: 'o_zai', name: 'Z.ai', place: { kind: 'own' }, state: { kind: 'ready', paid: 'plan' }, plan: 'GLM Coding Plan' },
]

export const AGENTS: RuntimeEntry[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    brand: Brand.ClaudeCode,
    version: '2.4.1',
    state: RuntimeState.Ready,
    account: 'Max · 2 accounts',
    detail: <Accounts agent="Claude Code" accounts={CLAUDE_ACCOUNTS} onAdd={none} />,
  },
  {
    id: 'codex',
    name: 'Codex',
    brand: Brand.Codex,
    version: '0.52.0',
    state: RuntimeState.Ready,
    account: 'Pro · 3 accounts',
    detail: <Accounts agent="Codex" accounts={CODEX_ACCOUNTS} onAdd={none} />,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    version: '1.0.4',
    state: RuntimeState.Ready,
    account: 'Any key, or a local model',
    detail: <Accounts agent="OpenCode" accounts={OPENCODE_ACCOUNTS} onAdd={none} />,
  },
]

/* ---- the code hosts and trackers, all six ---- */

const SERVICE = (id: string) => SERVICES.find((x) => x.id === id)!

export const ALL_SERVICES: ServiceOption[] = [
  SERVICE('github'),
  {
    id: 'gitlab',
    name: 'GitLab',
    brand: Brand.GitLab,
    what: 'Merge requests and issues',
    hostedUrl: 'https://gitlab.com',
    selfHosted: true,
    browserSignIn: false,
    tokenHelp: 'https://gitlab.com/-/user_settings/personal_access_tokens',
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    brand: Brand.Bitbucket,
    what: 'Pull requests',
    hostedUrl: 'https://bitbucket.org',
    selfHosted: true,
    browserSignIn: false,
    tokenHelp: 'https://bitbucket.org/account/settings/app-passwords/',
  },
  SERVICE('linear'),
  SERVICE('jira_cloud'),
  SERVICE('trello'),
]

export const ALL_CONNECTED: ServiceConnection[] = [
  { id: 'c1', service: 'github', account: 'you' },
  { id: 'c2', service: 'gitlab', account: 'you', instance: 'https://git.meridian.dev' },
  { id: 'c3', service: 'bitbucket', account: 'you' },
  { id: 'c4', service: 'linear', account: 'You' },
  { id: 'c5', service: 'jira_cloud', account: 'you@meridian.dev', instance: 'https://meridian.atlassian.net' },
  { id: 'c6', service: 'trello', account: 'You' },
]

export function ConnectionsList() {
  return (
    <Connections
      label="Code hosts and trackers"
      services={ALL_SERVICES}
      connections={ALL_CONNECTED}
      onSignIn={none}
      onCancelSignIn={none}
      onToken={none}
      onDisconnect={none}
    />
  )
}

/* ---- Settings: the Control Center, from the home's gear ---- */

const AGENT_TABS = [
  { id: 'claude-code', name: 'Claude Code', brand: Brand.ClaudeCode, line: 'Anthropic · 2.4.1' },
  { id: 'codex', name: 'Codex', brand: Brand.Codex, line: 'OpenAI · 0.159.3' },
  { id: 'opencode', name: 'OpenCode', brand: Brand.OpenCode, line: 'Any provider · 1.4.0' },
]
const ACCOUNTS_OF: Record<string, AccountEntry[]> = {
  'claude-code': CLAUDE_ACCOUNTS,
  codex: CODEX_ACCOUNTS,
  opencode: OPENCODE_ACCOUNTS,
}
const MODELS_OF: Record<string, { id: string; name: string }[]> = {
  'claude-code': [
    { id: 'opus-5', name: 'Opus 5' },
    { id: 'sonnet-5', name: 'Sonnet 5' },
    { id: 'haiku-5-5', name: 'Haiku 5.5' },
  ],
  codex: [
    { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
    { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex' },
    { id: 'gpt-5-mini', name: 'GPT-5 mini' },
  ],
  opencode: [
    { id: 'gemini-3-pro', name: 'Gemini 3 Pro' },
    { id: 'glm-4.6', name: 'GLM 4.6' },
    { id: 'kimi-k2', name: 'Kimi K2' },
  ],
}

const ICON = (
  <span className={s.iconPicture}>
    <img src={appIcon} alt="" />
  </span>
)

/** The panel's look, as the Control Center draws it, without being a popover: for a picture. */
export function SettingsPanel({ open = 'all', agent = 'codex' }: { open?: 'all' | 'agents'; agent?: string }) {
  const tab = AGENT_TABS.find((x) => x.id === agent) ?? AGENT_TABS[0]!
  return (
    <div className={`${s.panel} ${open === 'agents' ? s.panelWide : ''}`} role="presentation">
      {open === 'all' ? (
        <>
          <ControlGrid>
            <ControlModule title="Agents" aside="3 agents · 7 accounts" onClick={none}>
              <ControlAgents
                agents={[
                  { id: 'claude-code', name: 'Claude Code', brand: Brand.ClaudeCode, line: 'Northwind out until 14:00', tone: 'quiet' },
                  { id: 'codex', name: 'Codex', brand: Brand.Codex, line: '3 accounts' },
                  { id: 'opencode', name: 'OpenCode', brand: Brand.OpenCode, line: '2 accounts' },
                ]}
              />
            </ControlModule>
            <ControlModule title="Code hosts and trackers" span={2} aside="6 connected" onClick={none}>
              <ControlMarks
                marks={[
                  { id: 'github', name: 'GitHub', brand: Brand.GitHub },
                  { id: 'gitlab', name: 'GitLab', brand: Brand.GitLab },
                  { id: 'bitbucket', name: 'Bitbucket', brand: Brand.Bitbucket },
                  { id: 'linear', name: 'Linear', brand: Brand.Linear },
                  { id: 'jira', name: 'Jira', brand: Brand.Jira },
                  { id: 'trello', name: 'Trello', brand: Brand.Trello },
                ]}
              />
            </ControlModule>
            <ControlPicture title="App icon" name="Cobalt" picture={ICON} onClick={none} />
            <ControlToggle title="Keep awake" line="While work runs" on onChange={none} glyph={<Icon name="clock" size={16} />} />
            <ControlToggle title="Dictation" line="Off" on={false} onChange={none} glyph={<Icon name="mic" size={16} />} />
          </ControlGrid>
          <ControlFoot>
            <span>Althar 0.1.0</span>
          </ControlFoot>
        </>
      ) : (
        <ControlDetail title="Agents" aside="3 agents · 7 accounts" onBack={none}>
          <AgentTabs
            label="Agents"
            agents={AGENT_TABS}
            value={tab.id}
            onValueChange={none}
            aside={<ModelSwitches agent={tab.name} models={MODELS_OF[tab.id] ?? []} off={[]} onChange={none} />}
          >
            <Accounts agent={tab.name} accounts={ACCOUNTS_OF[tab.id] ?? []} onAdd={none} />
          </AgentTabs>
        </ControlDetail>
      )}
    </div>
  )
}

/** The home with Settings open over it, from the gear, as the app shows it. */
export function SettingsWindow({
  open = 'all',
  agent,
  className,
  style,
}: {
  open?: 'all' | 'agents'
  agent?: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className={`${s.over} ${className ?? ''}`} style={style}>
      <HomeWindow />
      <div className={`${s.overPanel} ${open === 'agents' ? s.overWide : ''}`}>
        <SettingsPanel open={open} {...(agent ? { agent } : {})} />
      </div>
    </div>
  )
}

/* ---- a usage limit, mid-task ---- */

export function Limit() {
  return (
    <RateLimit
      runtime="Claude Code"
      resets="14:00, in 2h 10m"
      options={[
        { model: CODEX, note: 'Codex · work · 38% of this week used' },
        { model: GEMINI_PRO, note: 'OpenCode · OpenRouter key' },
        { model: QWEN, note: 'OpenCode · this Mac, slower' },
        { model: SONNET, note: 'same limit, resets 14:00', busy: true },
      ]}
      affects={[
        { id: 'lead', label: 'the lead', model: OPUS },
        { id: 'sec', label: 'Security review', model: SONNET },
      ]}
      onSwap={none}
    />
  )
}

/** Task 431 on the board: its lead out of usage, then carried on by Codex. */
export function Handover({ after }: { after: boolean }) {
  return (
    <WorkCard
      task="431"
      kind="Delivery"
      title="Refunds rate-limit like charges"
      status={after ? TaskStatus.Running : TaskStatus.Paused}
      steps={['Triage', 'Implement', 'Review', 'Verify', 'Draft PR']}
      at={1}
      elapsed={after ? '32m' : '31m'}
      lead={after ? CODEX : OPUS}
      onStep={[SONNET, GEMINI_PRO]}
      {...(after ? {} : { note: 'Claude Code’s limit · back at 14:00' })}
    />
  )
}

/* ---- two labs' review of the lead's work ---- */

/** The usual review, simpler: two findings the lead fixed on the second round, and the one the reviewers disagree on, which is yours. */
const FINDINGS_ONE_YOURS = FINDINGS.map((f) =>
  f.id === 'f2'
    ? {
        ...f,
        state: FindingState.Yours,
        ask: 'Sonnet and Gemini disagree, and nothing on the task settles it. One budget, or a bucket for refunds?',
      }
    : { ...f, state: FindingState.Fixed, round: 2 },
)

export function TwoLabReview() {
  return (
    <Review
      n={3}
      of={6}
      reviewers={[{ model: SONNET }, { model: GEMINI_PRO }]}
      verdict={Verdict.Changes}
      took="4m 20s"
      thread={STEPS.review}
      instructions={{ path: '.althar/review.md', ...reviewDoc }}
      defaultFindings={FINDINGS_ONE_YOURS}
      defaultOpen
    />
  )
}

/** The docs task the coordinator hands out beside 432: small, Codex writes, Sonnet reads it over. */
export const DOCS_PLAN: LaunchStep[] = [
  { id: 'impl', label: 'Implement', agents: [CODEX], why: 'a docs change; Codex has room', fixed: 'the lead' },
  { id: 'review', label: 'Review', agents: [SONNET], why: 'a different lab from the lead', optional: true },
]

/* ---- a rule adds a step ---- */

export function RuleAdded() {
  return (
    <GraphChanged
      rev={2}
      summary="Security review added"
      settled
      defaultOpen
      nodes={[
        { id: 'impl', label: 'Implement', state: GraphNodeState.Done },
        { id: 'dry', label: 'Dry run on a copy', state: GraphNodeState.Done },
        { id: 'review', label: 'Review', state: GraphNodeState.Now },
        { id: 'sec', label: 'Security review', state: GraphNodeState.Added },
        { id: 'pr', label: 'Draft PR', state: GraphNodeState.Next },
      ]}
      ops={['Added Security review after Review: the change writes to money records.', 'Draft PR now waits on Security review.']}
      cause={{ by: AllowedBy.Rule, rule: 'a security review whenever money records change' }}
      project={PROJECT}
    />
  )
}

/* ---- task 432 over time, as its card tells it ---- */

export function Task432({ stage = STAGES.length - 1 }: { stage?: number }) {
  const now = STAGES[Math.min(stage, STAGES.length - 1)]!
  return (
    <TaskCard
      task={T432.task}
      title={T432.title}
      status={now.status}
      steps={T432.steps}
      at={now.step}
      started={now.started}
      lead={T432.lead}
      branch={T432.branch}
      from={T432.from}
      now={now.now}
    />
  )
}

/* ---- ready for you: two pull requests, checks passed ---- */

export function Ready() {
  return <AcceptCard {...READY_TWO_REPOS} />
}

/* ---- the island, round the notch, and what drops from it ---- */

export function IslandOpen({
  open = true,
  saying,
  waiting = EDGE_NEEDS.length,
  running = EDGE_WORK.length,
}: {
  open?: boolean
  saying?: { project: string; kind: string }
  waiting?: number
  running?: number
}) {
  return (
    <Island notch={NOTCH} waiting={waiting} running={running} open={open} onOpenChange={none} onOpenApp={none} saying={saying ?? null}>
      {/* Touched up: the ink sheet doesn't yet set the code chip's paper (a task is open for the app). */}
      <EdgeSheet
        tone="ink"
        style={{ '--n-4': 'rgba(255, 255, 255, 0.1)' } as CSSProperties}
        waiting={EDGE_NEEDS.length}
        working={EDGE_WORK.length}
        needs={EDGE_NEEDS.map((row) => edgeRowOf(row, none))}
        work={EDGE_WORK.map((row) => edgeRowOf(row, none))}
        onOpenApp={none}
      />
    </Island>
  )
}

/* ---- the project's rules ---- */

export function Rules() {
  return (
    <ProjectRules
      project="Meridian"
      always={ALWAYS_ASK}
      defaultAlwaysOn={ALWAYS_ON}
      never={NEVER}
      defaultNeverOn={NEVER_ON}
      learned="6 of 10 so far"
      onAddRule={none}
      onPermissionsChange={none}
      onAlwaysOnChange={none}
      onNeverOnChange={none}
      onAddNever={none}
      onReachChange={none}
    />
  )
}

export { TaskStatus }
