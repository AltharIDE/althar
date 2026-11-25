import { type ReactNode, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Brand,
  Button,
  Choices,
  Dialog,
  Icon,
  LinkButton,
  NeedLine,
  ProjectInk,
  ProjectTabs,
  type ProjectTab,
  type RuntimeEntry,
  RuntimeState,
  Segmented,
  Snippet,
  Spinner,
  TaskStatus,
  TitleBar,
  type WindowControls,
} from '@althar/ui'
import {
  Home,
  type HomeNeed,
  type HomeRun,
  HomeWelcome,
  NewProject,
  type NewProjectFolder,
  type NewProjectFound,
  Welcome,
  type WelcomeProps,
  welcomeText,
} from '@althar/ui/screens'

import c from '../../src/renderer/features/homes/Connect.module.css'
import { DISTROS, IN_UBUNTU, IN_UBUNTU_ASKING, IN_UBUNTU_UNREADY, ON_WINDOWS, P, tab } from './data'
import {
  CarriedOver,
  DistroAgents,
  DistroChoices,
  HomeChip,
  HomesMenu,
  ManageHomesDialog,
  type ManagedHome,
  type MenuHome,
  NoWsl,
  Offer,
  PlugChip,
  type Scenario,
  setupActions,
  type Stage,
  WSL_ICON,
  WslBoard,
  WslSteps,
} from './parts'
import l from './lab.module.css'

/*
 * Each touchpoint, in each direction, on the app's own screens: the first run
 * (Welcome), Connect a home, Manage homes and the homes chip's menu, a home's
 * first window (HomeWelcome), its Home, and New project. Where a screen has no
 * place yet for what WSL adds, the lab puts it there (`Into`), as a slot the
 * screen would grow.
 */

export type Direction = 'a' | 'b' | 'c'
export type Touchpoint = '1' | '2' | '3' | '4' | '5' | '6'

const noop = () => {}
const WINDOWS: WindowControls = { look: 'windows', start: [], end: ['minimize', 'maximize', 'close'] }

// ── The window ─────────────────────────────────────────────────────────────

/** A window of Althar's on Windows: its tabs and the homes chip at the end, or the bare bar the first run has. */
function Window({
  tabs = [],
  current = null,
  end,
  bare = false,
  children,
}: {
  tabs?: readonly ProjectTab[]
  current?: string | null
  end?: ReactNode
  bare?: boolean
  children: ReactNode
}) {
  return (
    <div className={l.window}>
      {bare ? (
        <TitleBar lights="drawn" controls={WINDOWS}>
          <span />
        </TitleBar>
      ) : (
        <ProjectTabs
          tabs={tabs}
          current={current}
          onSelect={noop}
          onClose={noop}
          onNewProject={noop}
          lights="drawn"
          controls={WINDOWS}
          end={<span className={l.end}>{end}</span>}
        />
      )}
      <div className={l.screen}>{children}</div>
    </div>
  )
}

/** Puts what the lab adds into a screen that has no slot for it yet: at the start or end of what `selector` finds, or after it. */
function Into({ selector, where = 'start', children }: { selector: string; where?: 'start' | 'end' | 'after'; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const target = document.querySelector(selector)
    if (target === null) return
    const element = document.createElement('div')
    element.className = l.into!
    if (where === 'start') target.prepend(element)
    else if (where === 'end') target.append(element)
    else target.after(element)
    // oxlint-disable-next-line react/set-state-in-effect -- the host is made in another component's DOM, once it's drawn.
    setHost(element)
    return () => element.remove()
  }, [selector, where])
  return host === null ? null : createPortal(children, host)
}

const ref = (project: (typeof P)[keyof typeof P]) => ({ seed: project.seed, ink: project.ink, name: project.name })

/** The kit's Home: what waits on you, what's under way, and the projects. */
function HomeOf({
  projects,
  running = [],
  needs = [],
}: {
  projects: readonly (typeof P)[keyof typeof P][]
  running?: readonly HomeRun[]
  needs?: readonly HomeNeed[]
}) {
  return (
    <Home
      // Held here only while Ubuntu is down: what they wait for, in its project's row.
      text={{ projects: { held: (n) => `${n} waiting for Ubuntu` } }}
      needs={needs}
      waiting={needs.length}
      running={running}
      since={[]}
      looked="2 h ago"
      projects={projects.map((project) => ({ id: project.id, project: ref(project), yours: 0, note: 'Last task yesterday' }))}
      onNewProject={noop}
      onOpenProject={noop}
    />
  )
}

const MERIDIAN_RUNS: readonly HomeRun[] = [
  { id: 'r1', project: ref(P.meridian), title: 'Settle the ledger export’s rounding' },
  { id: 'r2', project: ref(P.meridian), title: 'Retry webhooks that time out' },
]
/** The same two, held while Ubuntu is down: still in their row, not moving. */
const MERIDIAN_HELD: readonly HomeRun[] = MERIDIAN_RUNS.map((run) => ({ ...run, status: TaskStatus.Paused }))

// ── The first run ──────────────────────────────────────────────────────────

/** The kit's first run, on its agents' step, on a PC: its words, its agents, and what the lab puts in it. */
function FirstRun({
  runtimes,
  agents,
  foot,
  error,
  hideAgents = false,
  into,
}: {
  runtimes: readonly RuntimeEntry[]
  agents?: Partial<typeof welcomeText.agents>
  foot?: ReactNode
  error?: WelcomeProps['error']
  /** The step's own list makes way for the lab's. */
  hideAgents?: boolean
  into?: ReactNode
}) {
  return (
    <Window bare>
      <div className={l.welcome} data-hide-agents={hideAgents || undefined}>
        <Welcome
          toured
          step="agents"
          still
          runtimes={runtimes}
          repositories={[]}
          picked={[]}
          onPick={noop}
          onAdd={noop}
          name=""
          onNameChange={noop}
          onCreate={noop}
          onOpen={noop}
          onSignIn={noop}
          onInstall={noop}
          onHelp={noop}
          onRecheck={noop}
          // The step's main button says what it does here, whether or not an agent is ready yet.
          text={{ agents: { ...welcomeText.agents, ...agents, ...(agents?.go === undefined ? {} : { without: agents.go }) } }}
          {...(foot === undefined ? {} : { foot })}
          {...(error === undefined ? {} : { error })}
        />
        {into !== undefined && (
          <Into
            selector={hideAgents ? "[class*='Welcome-module__body']" : "[class*='Welcome-module__agents']"}
            where={hideAgents ? 'end' : 'start'}
          >
            {into}
          </Into>
        )}
      </div>
    </Window>
  )
}

/** Where you work, on a PC with WSL: each side, with what it has. */
const SIDES = (crowded: boolean) => [
  ...DISTROS.filter((one) => crowded || one.name === 'Ubuntu').map((one) => ({
    value: one.name,
    title: one.name,
    note:
      one.wsl === 1
        ? 'WSL 1: Althar converts it to WSL 2 first'
        : `${one.agents.length === 0 ? 'No agents' : `${one.agents.join(' and ')} signed in`} · ${one.repositories === 1 ? '1 repository' : `${one.repositories} repositories`}`,
  })),
  { value: 'Windows', title: 'Windows', note: 'No agents · 1 repository' },
]

function WhereYouWork({ crowded = false }: { crowded?: boolean }) {
  const [side, setSide] = useState('Ubuntu')
  const distro = DISTROS.find((one) => one.name === side)
  const runtimes =
    side === 'Windows' ? ON_WINDOWS : side === 'Ubuntu' ? IN_UBUNTU : distro?.agents.length === 0 ? [] : IN_UBUNTU.slice(0, 1)
  return (
    <FirstRun
      runtimes={[]}
      hideAgents
      agents={{
        title: 'Where you work',
        line: 'Your code and agents live in one place on this PC. Althar works there, and the others stay homes you can open.',
        go: 'Continue',
      }}
      into={
        <div className={l.where}>
          <Choices label="Where you work" value={side} onChange={setSide} options={SIDES(crowded)} />
          {runtimes.length > 0 ? (
            <DistroAgents runtimes={runtimes} distro={side === 'Windows' ? 'Windows' : side} />
          ) : (
            <p className={l.quiet}>No agents in {side} yet. Althar offers to install them once it’s set up there.</p>
          )}
        </div>
      }
    />
  )
}

function FirstRunScene({ d }: { d: Direction }) {
  if (d === 'a')
    return (
      <FirstRun
        runtimes={ON_WINDOWS}
        into={
          <Offer
            icon={WSL_ICON}
            kicker="Found in WSL"
            what="Your agents are in Ubuntu"
            actions={<Button variant="signal">Set up Ubuntu as a home</Button>}
          >
            Claude Code and Codex are signed in there, beside 6 repositories. As a home, Ubuntu opens in a window of its own here, and its
            projects and agents stay where they are.
          </Offer>
        }
      />
    )
  if (d === 'b')
    return (
      <FirstRun
        runtimes={IN_UBUNTU.map((one) => (one.state === RuntimeState.Ready ? { ...one, detail: 'In Ubuntu' } : one))}
        agents={{ line: 'Althar runs the agents you already use, on Windows or in WSL, on your own plans.' }}
        foot={<span className={l.quiet}>Althar puts althar-host in Ubuntu to run them there.</span>}
      />
    )
  return <WhereYouWork />
}

// ── Choosing a distro ──────────────────────────────────────────────────────

/** Connect a home on a PC: WSL comes first, beside a pairing code and SSH. */
function ConnectWsl({ none = false }: { none?: boolean }) {
  const [distro, setDistro] = useState('Ubuntu')
  const chosen = DISTROS.find((one) => one.name === distro)
  return (
    <Dialog
      title="Connect a home"
      width={660}
      className={c.dialog}
      onClose={noop}
      actions={
        none ? (
          <>
            <Button>Cancel</Button>
            <Button variant="signal">Check again</Button>
          </>
        ) : (
          <>
            <Button>Cancel</Button>
            <Button variant="signal">{chosen?.wsl === 1 ? 'Convert and set it up' : 'Set it up'}</Button>
          </>
        )
      }
    >
      <WslBoard
        stage="draft"
        distro={none ? 'A Linux distro' : distro}
        where={none ? 'Not on this PC yet' : `WSL ${chosen?.wsl ?? 2} on this PC`}
      />
      <div className={c.body}>
        <div className={c.form}>
          <Segmented
            label="Connection method"
            value="wsl"
            onChange={noop}
            className={c.method}
            options={[
              { value: 'wsl', label: 'WSL' },
              { value: 'pair', label: 'Pairing code' },
              { value: 'ssh', label: 'SSH' },
            ]}
          />
          {none ? <NoWsl /> : <DistroChoices value={distro} onChange={setDistro} />}
        </div>
      </div>
    </Dialog>
  )
}

const UBUNTU_FOUND: NewProjectFound = {
  like: 'Meridian',
  first: [
    { id: 'meridian', name: 'meridian', where: 'Ubuntu · ~/code/meridian' },
    { id: 'meridian-docs', name: 'meridian-docs', where: 'Ubuntu · ~/code/meridian-docs' },
  ],
  more: [
    { id: 'atlas', name: 'atlas', where: 'Ubuntu · ~/code/atlas', in: 'Atlas' },
    { id: 'ledger', name: 'ledger', where: 'C:\\Users\\ana\\code\\ledger', in: 'Ledger' },
    { id: 'dotfiles', name: 'dotfiles', where: 'Ubuntu · ~/dotfiles' },
  ],
}

/** The kit's New project, in a window of the PC's. */
function NewProjectScene({
  folders,
  found = { like: null, first: [], more: [] },
  footNote,
  into,
  intoAfter = "[class*='NewProject-module__folders']",
}: {
  folders: readonly NewProjectFolder[]
  found?: NewProjectFound
  footNote?: ReactNode
  into?: ReactNode
  intoAfter?: string
}) {
  return (
    <>
      <NewProject
        seed="prj_new_meridian"
        name={folders.length > 0 && folders[0]!.name === 'ledger' ? 'Ledger' : 'Meridian'}
        onNameChange={noop}
        ink={ProjectInk.Rose}
        onInkChange={noop}
        taken={{ [ProjectInk.Clay]: 'Meridian', [ProjectInk.Moss]: 'Ledger', [ProjectInk.Indigo]: 'Atlas' }}
        folders={folders}
        onRemove={noop}
        onChoose={noop}
        found={found}
        onAdd={noop}
        onCreate={noop}
        onCancel={noop}
        {...(footNote === undefined ? {} : { footNote })}
      />
      {into !== undefined && (
        <Into selector={intoAfter} where="after">
          {into}
        </Into>
      )}
    </>
  )
}

const NEW_TAB: ProjectTab = {
  id: 'new',
  seed: 'prj_new_meridian',
  name: 'New project',
  ink: ProjectInk.Rose,
  running: false,
  yours: 0,
  fixed: true,
}

function DistroScene({ d, x }: { d: Direction; x: string }) {
  if (d === 'a')
    return (
      <Window tabs={[tab(P.ledger)]} end={<PlugChip />}>
        <HomeOf projects={[P.ledger]} />
        <ConnectWsl none={x === 'none'} />
      </Window>
    )
  if (d === 'b')
    return (
      <Window tabs={[tab(P.meridian), tab(P.atlas), tab(P.ledger), NEW_TAB]} current="new" end={<PlugChip />}>
        <NewProjectScene
          folders={[]}
          found={UBUNTU_FOUND}
          intoAfter="[class*='NewProject-module__more']"
          into={
            <p className={l.findNote}>
              <Icon name={WSL_ICON} size={12} />
              Debian isn’t running. <LinkButton>Look there too</LinkButton>
            </p>
          }
        />
      </Window>
    )
  return <WhereYouWork crowded />
}

// ── Setting it up ──────────────────────────────────────────────────────────

const stageOf = (scenario: Scenario): Stage =>
  scenario === 'done' || scenario === 'agents' ? 'connected' : scenario === 'wsl1' || scenario === 'nostart' ? 'refused' : 'checking'
const distroOf = (scenario: Scenario) => (scenario === 'wsl1' ? 'Ubuntu-20.04' : 'Ubuntu')

function SetupScene({ d, x }: { d: Direction; x: Scenario }) {
  const distro = distroOf(x)
  if (d === 'a')
    return (
      <Window tabs={[tab(P.ledger)]} end={<PlugChip />}>
        <HomeOf projects={[P.ledger]} />
        <Dialog title="Connect a home" width={660} tall className={c.dialog} onClose={noop} actions={setupActions(x, `Open ${distro}`)}>
          <WslBoard stage={stageOf(x)} distro={distro} where={x === 'wsl1' ? 'WSL 1 on this PC' : 'WSL 2 on this PC'} />
          <div className={c.body}>
            <div className={c.form}>
              <WslSteps scenario={x} distro={distro} />
              {x === 'agents' && <DistroAgents runtimes={IN_UBUNTU_UNREADY} distro={distro} />}
              {(x === 'done' || x === 'agents') && <CarriedOver />}
            </div>
          </div>
        </Dialog>
      </Window>
    )
  if (d === 'b') {
    const strip = (words: ReactNode, action?: ReactNode, busy = false) => (
      <p className={l.strip}>
        {busy ? <Spinner size="small" /> : <Icon name={WSL_ICON} size={12} />}
        <span className={l.stripWords}>{words}</span>
        {action}
      </p>
    )
    const failed = (title: string, body: string, command: string) => ({
      step: 'agents' as const,
      said: (
        <span className={l.said}>
          <span>
            <strong>{title}</strong> {body}
          </span>
          <Snippet cmd={command} />
        </span>
      ),
    })
    if (x === 'running')
      return (
        <FirstRun
          runtimes={IN_UBUNTU_ASKING}
          into={strip('Getting Ubuntu ready for its agents · 41 of 96 MB', <LinkButton>Details</LinkButton>, true)}
        />
      )
    if (x === 'stopped')
      return (
        <FirstRun
          runtimes={IN_UBUNTU_ASKING}
          into={strip('Ubuntu stopped while Althar was getting it ready.', <Button size="small">Resume</Button>)}
        />
      )
    if (x === 'wsl1')
      return (
        <FirstRun
          runtimes={ON_WINDOWS}
          error={failed(
            'Ubuntu-20.04 runs on WSL 1,',
            'so Althar can’t run its Claude Code. Converting it to WSL 2 keeps its files and takes a few minutes.',
            'wsl --set-version Ubuntu-20.04 2',
          )}
        />
      )
    if (x === 'nostart')
      return (
        <FirstRun
          runtimes={ON_WINDOWS}
          error={failed(
            'Ubuntu wouldn’t start:',
            'Windows says Virtual Machine Platform is off. Turn it on as an administrator, restart Windows, then check again.',
            'wsl --install --no-distribution',
          )}
        />
      )
    return (
      <FirstRun
        runtimes={(x === 'agents' ? IN_UBUNTU_UNREADY : IN_UBUNTU).map((one) =>
          one.state === RuntimeState.Missing ? one : { ...one, detail: 'In Ubuntu' },
        )}
        agents={{ line: 'Althar runs the agents you already use, on Windows or in WSL, on your own plans.' }}
      />
    )
  }
  const go: Record<Scenario, string> = {
    running: 'Setting up…',
    done: 'Continue',
    agents: 'Continue',
    wsl1: 'Convert to WSL 2',
    nostart: 'Try again',
    stopped: 'Resume',
  }
  return (
    <FirstRun
      runtimes={[]}
      hideAgents
      agents={{
        title: `Setting up ${distro}`,
        line: `Althar puts althar-host in ${distro}, from this PC, and works from there.`,
        go: go[x],
      }}
      into={
        <div className={l.where}>
          <WslBoard stage={stageOf(x)} distro={distro} where={x === 'wsl1' ? 'WSL 1 on this PC' : 'WSL 2 on this PC'} />
          <WslSteps scenario={x} distro={distro} />
          {x === 'agents' && <DistroAgents runtimes={IN_UBUNTU_UNREADY} distro={distro} />}
        </div>
      }
    />
  )
}

// ── Beside This PC and the other homes ─────────────────────────────────────

const VPS: MenuHome = { key: 'vps', icon: 'home', name: 'vps', description: 'deploy@vps.example.com', hint: '2 h ago' }

const menuOf = (d: Direction, ubuntu: Partial<MenuHome> = {}): { homes: MenuHome[]; groups?: { label: string; keys: string[] }[] } => {
  if (d === 'a')
    return {
      homes: [
        { key: 'pc', icon: 'computer', name: 'This PC', hint: 'This window' },
        { key: 'ubuntu', icon: WSL_ICON, name: 'Ubuntu', description: 'WSL on this PC', hint: 'Open', ...ubuntu },
        VPS,
      ],
      groups: [
        { label: 'On this PC', keys: ['pc', 'ubuntu'] },
        { label: 'Elsewhere', keys: ['vps'] },
      ],
    }
  if (d === 'b')
    return { homes: [{ key: 'pc', icon: 'computer', name: 'This PC', description: 'Windows and Ubuntu', hint: 'This window' }, VPS] }
  return {
    homes: [
      { key: 'ubuntu', icon: WSL_ICON, name: 'Ubuntu', description: 'WSL on this PC', hint: 'This window', ...ubuntu },
      { key: 'windows', icon: 'computer', name: 'Windows', description: 'This PC', hint: '3 days ago' },
      VPS,
    ],
    groups: [
      { label: 'On this PC', keys: ['ubuntu', 'windows'] },
      { label: 'Elsewhere', keys: ['vps'] },
    ],
  }
}

const manageOf = (d: Direction): ManagedHome[] => {
  const ubuntuProjects = [
    { id: P.meridian.id, name: 'Meridian', ink: P.meridian.ink, doing: '2 running', running: true },
    { id: P.atlas.id, name: 'Atlas', ink: P.atlas.ink, doing: 'Nothing running' },
  ]
  const vps: ManagedHome = {
    key: 'vps',
    icon: 'home',
    name: 'vps',
    host: 'deploy@vps.example.com',
    status: { words: '2 h ago' },
    rest: true,
    projects: [{ id: P.tessera.id, name: 'Tessera', ink: P.tessera.ink }],
  }
  if (d === 'a')
    return [
      {
        key: 'pc',
        icon: 'computer',
        name: 'This PC',
        status: { words: 'This window', live: true },
        projects: [{ id: P.ledger.id, name: 'Ledger', ink: P.ledger.ink, doing: 'Nothing running' }],
      },
      {
        key: 'ubuntu',
        icon: WSL_ICON,
        name: 'Ubuntu',
        host: 'WSL 2 on this PC',
        status: { words: 'Open', live: true },
        projects: ubuntuProjects,
      },
      vps,
    ]
  if (d === 'b')
    return [
      {
        key: 'pc',
        icon: 'computer',
        name: 'This PC',
        host: 'Windows and Ubuntu',
        status: { words: 'This window', live: true },
        projects: [
          { ...ubuntuProjects[0]!, doing: 'Ubuntu · 2 running' },
          { ...ubuntuProjects[1]!, doing: 'Ubuntu' },
          { id: P.ledger.id, name: 'Ledger', ink: P.ledger.ink, doing: 'Windows' },
        ],
      },
      vps,
    ]
  return [
    {
      key: 'ubuntu',
      icon: WSL_ICON,
      name: 'Ubuntu',
      host: 'WSL 2 on this PC',
      status: { words: 'This window', live: true },
      projects: ubuntuProjects,
    },
    {
      key: 'windows',
      icon: 'computer',
      name: 'Windows',
      host: 'This PC',
      status: { words: '3 days ago' },
      rest: true,
      projects: [{ id: P.ledger.id, name: 'Ledger', ink: P.ledger.ink }],
    },
    vps,
  ]
}

const UBUNTU_TABS = [tab(P.meridian, true), tab(P.atlas)]
const ALL_TABS = [tab(P.meridian, true), tab(P.atlas), tab(P.ledger)]

/** Ubuntu's first window, as the kit's home welcome has a new home: what it is, what it has, and the ways in. */
function UbuntuWelcome() {
  return (
    <HomeWelcome
      name="Ubuntu"
      at="ana in Ubuntu · WSL 2 on this PC"
      machine={{ system: 'Ubuntu 24.04.1 LTS', cores: 16, memory: 16 * 1024 ** 3, disk: { free: 212e9, size: 1007e9 } }}
      git="2.43.0"
      needs={[
        { id: 'claude-code', name: 'Claude Code', brand: Brand.Anthropic, state: 'ready', note: '2.4.1' },
        { id: 'codex', name: 'Codex', brand: Brand.OpenAI, state: 'ready', note: '0.52.0' },
        { id: 'git', name: 'git', icon: 'branch', state: 'ready', note: '2.43.0' },
        { id: 'github', name: 'GitHub', brand: Brand.GitHub, state: 'ready', note: 'as ana, from This PC' },
      ]}
      repositories={[
        { id: 'repo_meridian', ink: ProjectInk.Clay },
        { id: 'repo_atlas', ink: ProjectInk.Indigo },
        { id: 'repo_docs', ink: ProjectInk.Moss },
      ]}
      found={['~/code/meridian', '~/code/atlas', '~/code/meridian-docs']}
      onDoor={noop}
      toured={false}
      onToured={noop}
      onCopy={noop}
      onGuide={noop}
      onSignIn={noop}
      text={{
        homeLine:
          'Tasks you start in this window run in Ubuntu, with its agents and its files. They keep going with the window closed, while this PC is awake.',
        readyLine: (name) => `Its agents are the ones signed in inside ${name}, as in a terminal there.`,
      }}
    />
  )
}

function BesideScene({ d, x }: { d: Direction; x: string }) {
  const menu = menuOf(d)
  if (x === 'welcome')
    return (
      <Window end={<HomeChip name="Ubuntu" />}>
        <UbuntuWelcome />
      </Window>
    )
  if (x === 'window') {
    if (d === 'b')
      return (
        <Window tabs={ALL_TABS} end={<PlugChip />}>
          <HomeOf projects={[P.meridian, P.atlas, P.ledger]} running={MERIDIAN_RUNS} />
        </Window>
      )
    return (
      <Window tabs={UBUNTU_TABS} end={<HomeChip name="Ubuntu" />}>
        <HomeOf projects={[P.meridian, P.atlas]} running={MERIDIAN_RUNS} />
      </Window>
    )
  }
  const ownTabs = d === 'a' ? [tab(P.ledger)] : d === 'b' ? ALL_TABS : UBUNTU_TABS
  const ownProjects = d === 'a' ? [P.ledger] : d === 'b' ? [P.meridian, P.atlas, P.ledger] : [P.meridian, P.atlas]
  const chip = d === 'c' ? <HomeChip name="Ubuntu" /> : <PlugChip />
  return (
    <Window
      tabs={ownTabs}
      end={x === 'menu' ? <HomesMenu homes={menu.homes} {...(menu.groups ? { groups: menu.groups } : {})} open trigger={chip} /> : chip}
    >
      <HomeOf projects={ownProjects} running={d === 'a' ? [] : MERIDIAN_RUNS} />
      {x === 'manage' && <ManageHomesDialog homes={manageOf(d)} onClose={noop} />}
    </Window>
  )
}

// ── Asleep, or stopped ─────────────────────────────────────────────────────

function SleepScene({ d, x }: { d: Direction; x: string }) {
  if (d === 'a') {
    if (x === 'asleep') {
      const menu = menuOf('a', { hint: 'Asleep' })
      return (
        <Window tabs={[tab(P.ledger)]} end={<HomesMenu homes={menu.homes} groups={menu.groups!} open trigger={<PlugChip />} />}>
          <HomeOf projects={[P.ledger]} />
        </Window>
      )
    }
    if (x === 'waking')
      return (
        <Window tabs={UBUNTU_TABS.map((one) => ({ ...one, running: false }))} end={<HomeChip name="Ubuntu" state="waking" />}>
          <HomeOf projects={[P.meridian, P.atlas]} />
        </Window>
      )
    return (
      <Window
        tabs={UBUNTU_TABS}
        end={
          <>
            <HomeChip name="Ubuntu" state="stopped" />
            <Button size="small">Start Ubuntu</Button>
          </>
        }
      >
        <HomeOf projects={[P.meridian, P.atlas]} running={MERIDIAN_HELD} />
      </Window>
    )
  }
  if (d === 'b') {
    if (x === 'stopped')
      return (
        <Window tabs={ALL_TABS} end={<PlugChip />}>
          <HomeOf
            projects={[P.meridian, P.atlas, P.ledger]}
            running={MERIDIAN_HELD}
            needs={[
              {
                key: 'stopped',
                project: ref(P.meridian),
                line: (
                  <NeedLine
                    kind="Ubuntu stopped"
                    project={ref(P.meridian)}
                    title="2 tasks were working in Ubuntu when it stopped"
                    brief="They pick up where they were once it starts. Meridian and Atlas wait for it; Ledger works on."
                    actions={<Button variant="signal">Start Ubuntu</Button>}
                  />
                ),
              },
            ]}
          />
        </Window>
      )
    return (
      <Window tabs={ALL_TABS.map((one) => ({ ...one, running: false }))} end={<PlugChip />}>
        <HomeOf projects={[P.meridian, P.atlas, P.ledger]} />
      </Window>
    )
  }
  if (x === 'asleep')
    return (
      <Window tabs={UBUNTU_TABS.map((one) => ({ ...one, running: false }))} end={<HomeChip name="Ubuntu" state="waking" />}>
        <HomeOf projects={[P.meridian, P.atlas]} />
      </Window>
    )
  return (
    <Window tabs={UBUNTU_TABS} end={<HomeChip name="Ubuntu" state="starting" />}>
      <HomeOf projects={[P.meridian, P.atlas]} running={MERIDIAN_HELD} />
    </Window>
  )
}

// ── A project from the other side ──────────────────────────────────────────

const GITHUB = { name: 'GitHub', brand: Brand.GitHub }
const meridianAt = (where: string): NewProjectFolder => ({ id: 'meridian', name: 'meridian', where, host: GITHUB, remote: 'ana/meridian' })
const ledgerAt = (where: string): NewProjectFolder => ({ id: 'ledger', name: 'ledger', where, host: GITHUB, remote: 'ana/ledger' })

function ProjectScene({ d, x }: { d: Direction; x: string }) {
  if (x === 'wsl') {
    if (d === 'a')
      return (
        <Window tabs={[tab(P.ledger), NEW_TAB]} current="new" end={<PlugChip />}>
          <NewProjectScene
            folders={[meridianAt('\\\\wsl.localhost\\Ubuntu\\home\\ana\\code\\meridian')]}
            into={
              <Offer
                icon={WSL_ICON}
                kicker="Where it runs"
                what="meridian is in Ubuntu"
                actions={
                  <>
                    <Button size="small">Keep it on This PC</Button>
                    <Button size="small" variant="signal">
                      Make it in Ubuntu
                    </Button>
                  </>
                }
              >
                Made in Ubuntu’s home, Ubuntu’s agents work on it and git runs at full speed. From This PC, every file goes across WSL’s
                share.
              </Offer>
            }
          />
        </Window>
      )
    if (d === 'b')
      return (
        <Window tabs={[tab(P.ledger), NEW_TAB]} current="new" end={<PlugChip />}>
          <NewProjectScene folders={[meridianAt('Ubuntu · ~/code/meridian')]} footNote="Its tasks run in Ubuntu, with Ubuntu’s agents." />
        </Window>
      )
    return (
      <Window tabs={[...UBUNTU_TABS, NEW_TAB]} current="new" end={<HomeChip name="Ubuntu" />}>
        <NewProjectScene folders={[meridianAt('~/code/meridian')]} />
      </Window>
    )
  }
  if (d === 'b')
    return (
      <Window tabs={[tab(P.atlas), NEW_TAB]} current="new" end={<PlugChip />}>
        <NewProjectScene
          folders={[meridianAt('Ubuntu · ~/code/meridian'), ledgerAt('C:\\Users\\ana\\code\\ledger')]}
          into={
            <Offer
              icon="problem"
              kicker="Where it runs"
              quiet={false}
              what="A project’s folders are all in one place"
              actions={
                <>
                  <Button size="small">Remove ledger</Button>
                  <Button size="small" variant="signal">
                    Copy ledger into Ubuntu
                  </Button>
                </>
              }
            >
              meridian is in Ubuntu and ledger on Windows. A project’s tasks run in one place, with that side’s agents.
            </Offer>
          }
        />
      </Window>
    )
  return (
    <Window tabs={[...UBUNTU_TABS, NEW_TAB]} current="new" end={<HomeChip name="Ubuntu" />}>
      <NewProjectScene
        folders={[ledgerAt('/mnt/c/Users/ana/code/ledger')]}
        into={
          d === 'a' ? (
            <Offer
              icon="computer"
              kicker="Where it runs"
              what="ledger is on Windows’ disk"
              actions={
                <>
                  <Button size="small">Use it there</Button>
                  <Button size="small" variant="signal">
                    Copy into Ubuntu
                  </Button>
                </>
              }
            >
              From Ubuntu, git and builds there run several times slower. A copy in Ubuntu keeps its branches, remote and uncommitted
              changes; the folder on Windows stays as it is.
            </Offer>
          ) : (
            <Offer
              icon="computer"
              kicker="Where it runs"
              quiet={false}
              what="Althar copies ledger into ~/code/ledger"
              actions={
                <>
                  <LinkButton>Use it on Windows’ disk</LinkButton>
                  <Button size="small" variant="signal">
                    Copy it
                  </Button>
                </>
              }
            >
              Branches, remote and uncommitted changes come too. The folder on Windows stays as it is.
            </Offer>
          )
        }
      />
    </Window>
  )
}

// ── All of them ────────────────────────────────────────────────────────────

export function Scene({ d, t, x }: { d: Direction; t: Touchpoint; x: string }) {
  switch (t) {
    case '1':
      return <FirstRunScene d={d} />
    case '2':
      return <DistroScene d={d} x={x} />
    case '3':
      return <SetupScene d={d} x={x as Scenario} />
    case '4':
      return <BesideScene d={d} x={x} />
    case '5':
      return <SleepScene d={d} x={x} />
    default:
      return <ProjectScene d={d} x={x} />
  }
}
