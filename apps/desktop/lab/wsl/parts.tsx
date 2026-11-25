import type { ComponentProps, ReactNode } from 'react'
import {
  AskCard,
  AskFoot,
  Button,
  ChromeButton,
  Choices,
  Dialog,
  Icon,
  type IconName,
  LinkButton,
  LiveDot,
  Menu,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  Problem,
  ProjectMark,
  type ProjectInk,
  Runtimes,
  type RuntimeEntry,
  Snippet,
  Spinner,
  chord,
  keys,
} from '@althar/ui'

import c from '../../src/renderer/features/homes/Connect.module.css'
import h from '../../src/renderer/features/homes/Homes.module.css'
import m from '../../src/renderer/features/homes/ManageHomes.module.css'
import su from '../../src/renderer/features/homes/SetUp.module.css'
import { DISTROS, type Distro, distroLine } from './data'
import s from './parts.module.css'

/*
 * The WSL parts every direction is made of, drawn with the homes feature's own
 * styles (Connect a home's drawing, its setup steps, the chip, Manage homes)
 * and the kit's components: a distro's place beside This PC, choosing one,
 * setting Althar up in it over wsl.exe step by step with what stops it, and
 * how it then reads among the homes.
 */

/** A distro, drawn: a shell on this PC, apart from This PC's laptop and a server's rack. */
export const WSL_ICON: IconName = 'terminal'

// ── The drawing ────────────────────────────────────────────────────────────

export type Stage = 'draft' | 'checking' | 'found' | 'connected' | 'refused'

/** This PC and the distro, joined by wsl as the setup stands: Connect a home's own drawing. */
export function WslBoard({ stage, distro, where = 'WSL 2 on this PC' }: { stage: Stage; distro: string; where?: string }) {
  const broken = stage === 'refused'
  return (
    <div className={c.board} data-stage={stage}>
      <div className={c.card} data-here="">
        <span className={c.glyph}>
          <Icon name="computer" size={15} />
        </span>
        <span className={c.words}>
          <span className={c.name}>This PC</span>
          <span className={c.where}>Windows 11</span>
        </span>
      </div>
      <div className={c.wire} aria-hidden="true">
        <span className={c.how}>wsl</span>
        <svg className={c.line} viewBox="0 0 100 12" preserveAspectRatio="none">
          {broken ? (
            <>
              <line x1="0" y1="6" x2="40" y2="6" vectorEffect="non-scaling-stroke" />
              <line x1="60" y1="6" x2="100" y2="6" vectorEffect="non-scaling-stroke" />
            </>
          ) : (
            <line x1="0" y1="6" x2="100" y2="6" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        <span className={c.node}>
          {stage === 'checking' && <Spinner size="small" />}
          {broken && <Icon name="close" size={11} />}
          {stage === 'connected' && <Icon name="check" size={12} />}
        </span>
      </div>
      <div className={c.card} data-home="" data-found={stage === 'found' || stage === 'connected' || undefined}>
        <div className={c.head}>
          <span className={c.glyph}>
            <Icon name={WSL_ICON} size={15} />
          </span>
          <span className={c.words}>
            <span className={c.name}>{distro}</span>
            <span className={c.where}>{where}</span>
          </span>
          {stage === 'connected' && (
            <span className={c.live}>
              <LiveDot />
              Ready
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Choosing a distro ──────────────────────────────────────────────────────

/** The distros on this PC, each with what it has: the kit's own choice list. Docker Desktop's are left out. */
export function DistroChoices({
  value,
  onChange,
  distros = DISTROS,
  label = 'Distro',
}: {
  value: string
  onChange: (name: string) => void
  distros?: readonly Distro[]
  label?: string
}) {
  const chosen = distros.find((one) => one.name === value)
  return (
    <div className={s.stack}>
      <Choices
        label={label}
        value={value}
        onChange={onChange}
        options={distros.map((one) => ({
          value: one.name,
          title: one.default === true ? `${one.name} · Default` : one.name,
          note: distroLine(one),
        }))}
      />
      {chosen?.wsl === 1 && (
        <p className={s.aside}>
          Converting it to WSL 2 keeps its files and takes a few minutes. Althar does it with{' '}
          <code className={s.code}>wsl --set-version</code>.
        </p>
      )}
    </div>
  )
}

/** Where WSL isn't there yet: what it is for here, and how it gets here. */
export function NoWsl() {
  return (
    <div className={s.empty}>
      <span className={s.emptyGlyph}>
        <Icon name={WSL_ICON} size={16} />
      </span>
      <div className={s.emptyWords}>
        <p className={s.emptyTitle}>WSL isn’t on this PC</p>
        <p className={s.emptyLine}>
          Where your code and agents live in Linux on this PC, each distro can be a home here. Installing WSL needs an administrator and a
          restart of Windows.
        </p>
        <Snippet cmd="wsl --install" />
      </div>
    </div>
  )
}

// ── Setting it up ──────────────────────────────────────────────────────────

export type Scenario = 'running' | 'done' | 'agents' | 'wsl1' | 'nostart' | 'stopped'
export const SCENARIOS: readonly { key: Scenario; label: string }[] = [
  { key: 'running', label: 'Under way' },
  { key: 'done', label: 'Done' },
  { key: 'agents', label: 'Agents not ready there' },
  { key: 'wsl1', label: 'A WSL 1 distro' },
  { key: 'nostart', label: 'It won’t start' },
  { key: 'stopped', label: 'Stopped midway' },
]

type StepState = 'done' | 'now' | 'failed' | 'later'
interface Trouble {
  readonly title: string
  readonly body: ReactNode
  readonly command?: string
}

const troubleOf = (scenario: Scenario, distro: string): Trouble | null => {
  switch (scenario) {
    case 'wsl1':
      return {
        title: `${distro} runs on WSL 1.`,
        body: 'A home needs WSL 2. Converting keeps its files and takes a few minutes; Althar picks up from here after.',
        command: `wsl --set-version ${distro} 2`,
      }
    case 'nostart':
      return {
        title: `${distro} wouldn’t start.`,
        body: 'Windows says Virtual Machine Platform is off. Turn it on as an administrator and restart Windows; Althar picks up from here after.',
        command: 'wsl --install --no-distribution',
      }
    default:
      return null
  }
}

/** Where each scenario has got to: the step it's on, and whether it stopped there. */
const AT: Record<Scenario, { at: number; failed?: boolean; done?: boolean }> = {
  running: { at: 3 },
  done: { at: 6, done: true },
  agents: { at: 6, done: true },
  wsl1: { at: 0, failed: true },
  nostart: { at: 1, failed: true },
  stopped: { at: 3 },
}

/**
 * Setting Althar up in a distro over wsl.exe, as Connect a home's SSH setup reads: no SSH, no keys, no systemd, and
 * nothing to download, since the host comes from the app on this PC, at the app's own version.
 */
export function WslSteps({ scenario, distro, home = true }: { scenario: Scenario; distro: string; home?: boolean }) {
  const where = AT[scenario]
  const trouble = troubleOf(scenario, distro)
  const state = (index: number): StepState =>
    where.done === true || index < where.at
      ? 'done'
      : index > where.at
        ? 'later'
        : where.failed === true
          ? 'failed'
          : scenario === 'stopped'
            ? 'later'
            : 'now'
  const steps: readonly { label: string; detail: (state: StepState) => ReactNode }[] = [
    { label: 'Find WSL', detail: (st) => (st === 'done' ? `WSL 2.3.26 · ${distro} is WSL 2` : null) },
    { label: `Start ${distro}`, detail: (st) => (st === 'done' ? 'Running' : null) },
    { label: 'Look it over', detail: (st) => (st === 'done' ? 'Ubuntu 24.04.1 · x64 · 212 GB free · as ana' : null) },
    {
      label: 'Put althar-host there',
      detail: (st) =>
        st === 'now' ? (
          <>
            From this PC · 41 of 96 MB
            <span className={su.bar}>
              <span style={{ transform: 'scaleX(0.43)' }} />
            </span>
          </>
        ) : st === 'done' ? (
          '0.12.0, the same as Althar here, and updated with it'
        ) : null,
    },
    {
      label: home ? 'Make it a home' : 'Start it',
      detail: (st) => (st === 'done' ? 'Runs while there’s work or a window on it; Ubuntu sleeps when there’s neither' : null),
    },
    {
      label: 'Find its agents',
      // Where they aren't ready, their own rows say so under the steps.
      detail: (st) => (st === 'done' && scenario !== 'agents' ? 'Claude Code and Codex, signed in' : null),
    },
  ]
  return (
    <div className={su.install}>
      {scenario === 'stopped' && (
        <p className={su.resumeNote}>
          <Icon name="info" size={12} />
          {distro} stopped while Althar was setting it up. Nothing’s lost: Resume starts it and picks up where it got to.
        </p>
      )}
      <ol className={su.steps} aria-label={`Setting up ${distro}`}>
        {steps.map((step, index) => {
          const st = state(index)
          const said = step.detail(st)
          return (
            <li key={step.label} data-state={st}>
              <span className={su.tick}>
                {st === 'done' ? (
                  <Icon name="check" size={10} />
                ) : st === 'failed' ? (
                  <Icon name="close" size={10} />
                ) : st === 'now' ? (
                  <Spinner size="small" />
                ) : null}
              </span>
              <span className={su.stepWords}>
                <span className={su.stepLabel}>{step.label}</span>
                {said !== null && <span className={su.stepDetail}>{said}</span>}
                {st === 'failed' && trouble !== null && (
                  <span className={su.failed}>
                    <Problem as="span" size="small">
                      {trouble.title}
                    </Problem>
                    <span className={su.note}>{trouble.body}</span>
                    {trouble.command !== undefined && <Snippet cmd={trouble.command} />}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The footer's buttons, by where the setup stands. */
export const setupActions = (scenario: Scenario, open: string, onCancel: () => void = () => {}) => {
  switch (scenario) {
    case 'running':
      return (
        <>
          <Button onClick={onCancel}>Stop</Button>
          <Button variant="signal" busy disabled>
            Setting up…
          </Button>
        </>
      )
    case 'wsl1':
      return (
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="signal">Convert to WSL 2</Button>
        </>
      )
    case 'nostart':
      return (
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="signal">Try again</Button>
        </>
      )
    case 'stopped':
      return (
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="signal">Resume</Button>
        </>
      )
    default:
      return (
        <>
          <Button onClick={onCancel}>Close</Button>
          <Button variant="signal">{open}</Button>
        </>
      )
  }
}

/** Its agents, as they stand inside the distro: the kit's own rows, each with the one press that makes it ready there. */
export function DistroAgents({ runtimes, distro }: { runtimes: readonly RuntimeEntry[]; distro: string }) {
  return (
    <div className={s.agents}>
      <h3 className={s.section}>In {distro}</h3>
      <Runtimes
        label={`Agents in ${distro}`}
        runtimes={runtimes}
        onSignIn={() => {}}
        onInstall={() => {}}
        onHelp={() => {}}
        text={{
          missing: `Not installed in ${distro}`,
          signedOut: `Signed out in ${distro}`,
          downloadNote: (name, size) => `${name}’s latest release, into ${distro}, about ${size}.`,
        }}
      />
    </div>
  )
}

/** Carried over to a home on the same PC: the code hosts and trackers This PC is connected to, rather than again. */
export function CarriedOver() {
  return (
    <p className={su.doneNote}>
      <span className={su.doneTick}>
        <Icon name="check" size={10} />
      </span>
      GitHub and Linear come over from This PC, connected as they are.
    </p>
  )
}

// ── Among the homes ────────────────────────────────────────────────────────

export type ChipState = 'open' | 'waking' | 'stopped' | 'starting'

/** A home's chip at the end of the bar, as a home's window has it: its name, and how it stands. */
export function HomeChip({
  name,
  icon = WSL_ICON,
  state = 'open',
  ...rest
}: { name: string; icon?: IconName; state?: ChipState } & ComponentProps<'button'>) {
  // A menu's trigger: its ref and props go on the button, so the menu opens from it.
  return (
    <button type="button" className={h.chip} data-down={state === 'stopped' || undefined} aria-label={`${name}. Homes`} {...rest}>
      {state === 'waking' || state === 'starting' ? (
        <Spinner size="small" />
      ) : (
        <Icon name={state === 'stopped' ? 'unlinked' : icon} size={13} />
      )}
      <span className={h.chipName}>{name}</span>
      {state === 'waking' && <span className={h.chipQuiet}>Waking…</span>}
      {state === 'starting' && <span className={h.chipQuiet}>Starting again…</span>}
      {state === 'stopped' && <span className={h.chipDown}>Stopped</span>}
    </button>
  )
}

/** This computer's window: a plug, as the bar has it. */
export function PlugChip(props: Partial<ComponentProps<typeof ChromeButton>>) {
  return <ChromeButton icon="plug" label="Homes" kbd={chord(keys.mod, keys.shift, 'H')} compact {...props} />
}

export interface MenuHome {
  readonly key: string
  readonly icon: IconName
  readonly name: string
  readonly description?: ReactNode
  readonly hint?: string
}

/** The homes chip's menu: each home, then Connect a home…, Manage homes… and Pair a phone…, as the app has it. */
export function HomesMenu({
  homes,
  trigger,
  open,
  groups,
  top,
}: {
  homes: readonly MenuHome[]
  trigger: React.ReactElement
  open: boolean
  /** Homes on this PC apart from the others, under their own heading. */
  groups?: { label: string; keys: readonly string[] }[]
  /** Over the homes: a home's own action, such as starting it. */
  top?: ReactNode
}) {
  const item = (home: MenuHome) => (
    <MenuItem
      key={home.key}
      lead={<Icon name={home.icon} />}
      onSelect={() => {}}
      {...(home.hint === undefined ? {} : { hint: home.hint })}
      {...(home.description === undefined ? {} : { description: <span className={h.target}>{home.description}</span> })}
    >
      {home.name}
    </MenuItem>
  )
  return (
    <Menu label="Homes" trigger={trigger} align="end" width={300} descriptions="under" open={open} onOpenChange={() => {}}>
      {top}
      {groups === undefined ? (
        <MenuGroup label="Homes">{homes.map(item)}</MenuGroup>
      ) : (
        groups.map((group, index) => (
          <span key={group.label}>
            {index > 0 && <MenuSeparator />}
            <MenuGroup label={group.label}>{homes.filter((home) => group.keys.includes(home.key)).map(item)}</MenuGroup>
          </span>
        ))
      )}
      <MenuSeparator />
      <MenuItem icon="plus" onSelect={() => {}}>
        Connect a home…
      </MenuItem>
      <MenuItem icon="gear" onSelect={() => {}}>
        Manage homes…
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="phone" onSelect={() => {}}>
        Pair a phone…
      </MenuItem>
    </Menu>
  )
}

export interface ShelfProject {
  readonly id: string
  readonly name: string
  readonly ink: ProjectInk
  readonly doing?: string
  readonly running?: boolean
  readonly yours?: boolean
}
export interface ManagedHome {
  readonly key: string
  readonly icon: IconName
  readonly name: string
  readonly host?: string
  /** How it stands, in a word or two, with a live dot where it's open. */
  readonly status?: { readonly words: string; readonly live?: boolean; readonly down?: boolean }
  readonly projects: readonly ShelfProject[]
  /** Its projects as last read: quiet. */
  readonly rest?: boolean
}

/** Manage homes, by their projects, with the app's own rows. */
export function ManageHomesDialog({ homes, onClose }: { homes: readonly ManagedHome[]; onClose: () => void }) {
  return (
    <Dialog title="Homes" width={600} tall onClose={onClose} actions={<Button onClick={onClose}>Done</Button>}>
      <ul className={m.homes}>
        {homes.map((home) => (
          <li key={home.key} className={m.home}>
            <div className={m.head}>
              <span className={m.glyph} data-down={home.status?.down || undefined}>
                <Icon name={home.icon} size={15} />
              </span>
              <span className={m.words}>
                <span className={m.name}>{home.name}</span>
                {home.host !== undefined && <span className={m.host}>{home.host}</span>}
              </span>
              {home.status !== undefined && (
                <span className={m.status} data-down={home.status.down || undefined}>
                  {home.status.live === true && <LiveDot />}
                  {home.status.down === true && <span className={m.dropped} aria-hidden="true" />}
                  {home.status.words}
                </span>
              )}
            </div>
            <ul className={m.shelf} data-rest={home.rest || undefined}>
              {home.projects.map((project) => (
                <li key={project.id}>
                  <button type="button" className={m.project} title={project.name}>
                    <ProjectMark
                      seed={project.id}
                      ink={project.ink}
                      size={28}
                      running={project.running === true}
                      yours={project.yours === true}
                      quiet={home.rest === true}
                      className={m.mark}
                    />
                    <span className={m.projectName}>{project.name}</span>
                    {project.doing !== undefined && <span className={m.doing}>{project.doing}</span>}
                  </button>
                </li>
              ))}
              <li>
                <button type="button" className={`${m.project} ${m.adding}`}>
                  <span className={m.addMark} aria-hidden="true">
                    <Icon name="plus" size={14} />
                  </span>
                  <span className={m.projectName}>New project</span>
                </button>
              </li>
            </ul>
          </li>
        ))}
        <li className={m.home}>
          <button type="button" className={m.add}>
            <span className={m.glyph}>
              <Icon name="plus" size={15} />
            </span>
            Connect a home
          </button>
        </li>
      </ul>
    </Dialog>
  )
}

// ── Offers ─────────────────────────────────────────────────────────────────

/** An offer where something is better done another way: the kit's ask, quiet where nothing waits on it. */
export function Offer({
  icon,
  kicker,
  what,
  children,
  actions,
  quiet = true,
}: {
  icon: IconName
  kicker: ReactNode
  what: ReactNode
  children?: ReactNode
  actions: ReactNode
  quiet?: boolean
}) {
  return (
    <AskCard icon={icon} kicker={kicker} what={what} quiet={quiet} className={s.offer}>
      {children !== undefined && <p className={s.offerLine}>{children}</p>}
      <AskFoot>{actions}</AskFoot>
    </AskCard>
  )
}

/** Where a project's code lives, in a word: a distro, or Windows. */
export function Place({ where }: { where: string }) {
  return (
    <span className={s.place}>
      <Icon name={where === 'Windows' ? 'computer' : WSL_ICON} size={11} />
      {where}
    </span>
  )
}

export { LinkButton }
