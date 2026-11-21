import { useId, type ReactNode } from 'react'
import { PAIRING_CODE_MAX_LENGTH } from '@althar/contracts'
import {
  Caret,
  Code,
  CopyButton,
  Disclosure,
  DisclosureTrigger,
  Field,
  Fold,
  Icon,
  LiveDot,
  Problem,
  ProjectInk,
  ProjectMark,
  Segmented,
  Spinner,
} from '@althar/ui'

import { device } from '../../shared/device'
import { OptionFields } from './ConnectHome'
import { HOST_README } from './SetUp'
import type { Flow } from './useFlow'
import s from './Connect.module.css'

/*
 * Connect a home's drawing: this computer and the home being made, joined by a line drawn as the connection stands
 * (drafted, being reached, found, connecting, connected, or broken where it failed), the home's card filling in as it's
 * typed and found; the two ways a server becomes a home; and the fields it asks for.
 */

export type View = 'intro' | 'setup' | 'form'
export type Route = 'ssh' | 'pair'

const SAMPLE = [
  { id: 'prj_meridian', ink: ProjectInk.Clay },
  { id: 'prj_ledger', ink: ProjectInk.Moss },
  { id: 'prj_atlas', ink: ProjectInk.Indigo },
]

export function Board({ flow, view, stage, how }: { flow: Flow; view: View; stage: string; how: string }) {
  return (
    <div className={s.board} data-stage={stage}>
      <div className={s.card} data-here="">
        <span className={s.glyph}>
          <Icon name="computer" size={15} />
        </span>
        <span className={s.words}>
          <span className={s.name}>{device.This}</span>
          <span className={s.where}>Can sleep</span>
        </span>
      </div>
      <Wire stage={stage} how={how} />
      <HomeCard flow={flow} view={view} />
    </div>
  )
}

/** The line between the two: how the connection stands, with how it's made over it. */
function Wire({ stage, how }: { stage: string; how: string }) {
  const broken = stage === 'refused'
  return (
    <div className={s.wire} aria-hidden="true">
      <span className={s.how}>{how}</span>
      <svg className={s.line} viewBox="0 0 100 12" preserveAspectRatio="none">
        {broken ? (
          <>
            <line x1="0" y1="6" x2="40" y2="6" vectorEffect="non-scaling-stroke" />
            <line x1="60" y1="6" x2="100" y2="6" vectorEffect="non-scaling-stroke" />
          </>
        ) : (
          <line x1="0" y1="6" x2="100" y2="6" vectorEffect="non-scaling-stroke" />
        )}
        {(stage === 'connecting' || stage === 'intro') && (
          <line className={s.comet} x1="0" y1="6" x2="100" y2="6" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <span className={s.node}>
        {stage === 'checking' && <Spinner size="small" />}
        {broken && <Icon name="close" size={11} />}
        {stage === 'connected' && <Icon name="check" size={12} />}
      </span>
    </div>
  )
}

function HomeCard({ flow, view }: { flow: Flow; view: View }) {
  const intro = view === 'intro'
  const found = flow.found !== null && view === 'form'
  const name = view === 'form' ? flow.name.trim() : 'Your server'
  const where = view === 'setup' ? 'Not set up yet' : view === 'form' ? flow.where : ''
  return (
    <div className={s.card} data-home="" data-found={found || intro || undefined}>
      <div className={s.head}>
        <span className={s.glyph}>
          <Icon name="home" size={15} />
        </span>
        <span className={s.words}>
          <span className={s.name} data-empty={name === '' || undefined} title={name}>
            {name === '' ? 'New home' : name}
          </span>
          {!intro && (
            <span className={s.where} data-empty={where === '' || view === 'setup' || undefined} title={where}>
              {where === '' ? (flow.method === 'ssh' ? 'user@host' : 'From its pairing code') : where}
            </span>
          )}
        </span>
        {flow.stage === 'connected' && view === 'form' && (
          <span className={s.live}>
            <LiveDot />
            Open
          </span>
        )}
      </div>
      {intro && (
        <span className={s.shelf}>
          {SAMPLE.map((one) => (
            <ProjectMark key={one.id} seed={one.id} ink={one.ink} size={26} running />
          ))}
        </span>
      )}
      <div className={s.reveal} data-on={found || undefined}>
        <div className={s.revealInner}>
          {flow.found !== null && (
            <div className={s.identity}>
              <Chunked homeId={flow.found.homeId} className={s.homeId} />
              <CopyButton value={flow.found.homeId} ghost className={s.copyId} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** The two ways a server becomes a home: Althar sets it up over SSH, or it's set up there and pairs with a code. */
export function Routes({
  route,
  onRoute,
  installs = true,
}: {
  route: Route
  onRoute: (next: Route) => void
  /** Althar can install it over SSH here; where it can't (the Flatpak), the server is set up by hand and reached over SSH. */
  installs?: boolean
}) {
  return (
    <div className={s.setup}>
      <div className={s.routes} role="radiogroup" aria-label="How to set it up">
        <RouteCard
          on={route === 'ssh'}
          onPick={() => onRoute('ssh')}
          icon="terminal"
          title="Over SSH"
          line={installs ? 'Althar installs it for you.' : 'Set up there, reached with ssh.'}
          {...(installs ? { tag: 'Easiest' } : {})}
        />
        <RouteCard
          on={route === 'pair'}
          onPick={() => onRoute('pair')}
          icon="globe"
          title="With a pairing code"
          line="Set up there, it prints one."
        />
      </div>
      {route === 'ssh' && installs ? (
        <div className={s.detail} key="ssh">
          <p className={s.copy}>
            Any Linux server you can reach with <Code>ssh</Code> from {device.this}: a VPS, a machine at home, a spare box. Althar installs{' '}
            <Code>althar-host</Code>, starts it so it survives restarts, and connects. Nothing to copy.
          </p>
        </div>
      ) : route === 'ssh' ? (
        <div className={s.detail} key="ssh">
          <p className={s.copy}>
            Any Linux server where althar-host runs that you can reach with <Code>ssh</Code> from {device.this}. Althar from Flathub can’t
            install it there, as it doesn’t see your SSH keys.
          </p>
          <p className={s.aside}>
            Not running there yet?{' '}
            <a className={s.link} href={HOST_README} target="_blank" rel="noreferrer">
              Set it up by hand
              <Icon name="external" size={10} />
            </a>
          </p>
        </div>
      ) : (
        <div className={s.detail} key="pair">
          <div className={s.term}>
            <span className={s.prompt} aria-hidden="true">
              $
            </span>
            <code className={s.command}>althar-host pair</code>
            <CopyButton value="althar-host pair" tone="onDark" className={s.termCopy} />
          </div>
          <p className={s.copy}>
            On a server where althar-host runs and listens over HTTPS, such as on Tailscale. It prints a code to paste here.
          </p>
          <p className={s.aside}>
            Not running there yet?{' '}
            <a className={s.link} href={HOST_README} target="_blank" rel="noreferrer">
              Set it up by hand
              <Icon name="external" size={10} />
            </a>
          </p>
        </div>
      )}
    </div>
  )
}

function RouteCard({
  on,
  onPick,
  icon,
  title,
  line,
  tag,
}: {
  on: boolean
  onPick: () => void
  icon: 'terminal' | 'globe'
  title: string
  line: string
  tag?: string
}) {
  return (
    <button type="button" role="radio" aria-checked={on} className={s.route} onClick={onPick}>
      <span className={s.glyph}>
        <Icon name={icon} size={14} />
      </span>
      <span className={s.words}>
        <span className={s.routeTitle}>
          {title}
          {tag !== undefined && <span className={s.tag}>{tag}</span>}
        </span>
        <span className={s.routeLine}>{line}</span>
      </span>
    </button>
  )
}

export function MethodSwitch({ flow, onChange }: { flow: Flow; onChange: (next: Flow['method']) => void }) {
  return (
    <Segmented
      label="Connection method"
      value={flow.method}
      onChange={onChange}
      className={s.method}
      options={[
        { value: 'pair', label: 'Pairing code', disabled: flow.busy },
        { value: 'ssh', label: 'SSH', disabled: flow.busy },
      ]}
    />
  )
}

function Labelled({ label, htmlFor, children, under }: { label: string; htmlFor: string; children: ReactNode; under?: ReactNode }) {
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {under}
    </div>
  )
}

export function HostField({
  flow,
  focus,
  help,
  problem,
  readOnly = false,
}: {
  flow: Flow
  focus: boolean
  help?: ReactNode
  /** Where the form's own check has none: a setup that couldn't start. */
  problem?: string | null
  readOnly?: boolean
}) {
  const id = useId()
  const said = flow.problem ?? problem ?? null
  return (
    <Labelled
      label="SSH host"
      htmlFor={id}
      under={
        said !== null ? (
          <Problem size="small" id={`${id}-under`}>
            {said}
          </Problem>
        ) : help !== undefined ? (
          <p className={s.help} id={`${id}-under`}>
            {help}
          </p>
        ) : null
      }
    >
      <Field
        id={id}
        value={flow.ssh.target}
        invalid={said !== null}
        aria-describedby={said !== null || help !== undefined ? `${id}-under` : undefined}
        readOnly={readOnly || flow.stage === 'connecting'}
        placeholder="user@host, or a Host from your SSH config"
        spellCheck={false}
        autoComplete="off"
        maxLength={4096}
        className={s.mono}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog is opened to type a host; its first field takes the keys.
        autoFocus={focus}
        onChange={(event) => flow.ssh.setTarget(event.currentTarget.value)}
      />
    </Labelled>
  )
}

export function Options({ flow }: { flow: Flow }) {
  return (
    <Disclosure>
      <DisclosureTrigger>
        <button type="button" className={s.more}>
          Connection options <Caret />
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <OptionFields form={flow.ssh} />
      </Fold>
    </Disclosure>
  )
}

export function CodeField({ flow, focus, help }: { flow: Flow; focus: boolean; help: ReactNode }) {
  const id = useId()
  const problem = flow.method === 'pair' && flow.pair.info === null ? flow.pair.problem : null
  return (
    <Labelled
      label="Pairing code"
      htmlFor={id}
      under={
        problem !== null ? (
          <Problem size="small" id={`${id}-under`}>
            {problem}
          </Problem>
        ) : (
          <p className={s.help} id={`${id}-under`}>
            {help}
          </p>
        )
      }
    >
      <Field
        id={id}
        type="password"
        value={flow.pair.code}
        maxLength={PAIRING_CODE_MAX_LENGTH}
        disabled={flow.pair.pending}
        invalid={problem !== null}
        aria-describedby={`${id}-under`}
        autoComplete="off"
        spellCheck={false}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog is opened to paste a code; its first field takes the keys.
        autoFocus={focus}
        onChange={(event) => flow.pair.setCode(event.currentTarget.value)}
      />
    </Labelled>
  )
}

export function NameField({ flow }: { flow: Flow }) {
  const id = useId()
  return (
    <Labelled label="Name" htmlFor={id}>
      <Field
        id={id}
        value={flow.name}
        maxLength={120}
        disabled={flow.stage === 'connecting' || flow.stage === 'connected'}
        autoComplete="off"
        placeholder="My server"
        onChange={(event) => flow.setName(event.currentTarget.value)}
      />
    </Labelled>
  )
}

/** A problem with what was found or connecting to it, where no field has it. */
export function LaterProblem({ flow }: { flow: Flow }) {
  if (flow.method === 'pair' && flow.pair.info !== null && flow.pair.problem !== null)
    return <Problem size="small">{flow.pair.problem}</Problem>
  return null
}

/** An identity in groups of four, for comparing by eye with what the host prints. */
export function Chunked({ homeId, className }: { homeId: string; className?: string }) {
  const [kind, rest = ''] = homeId.split('_')
  const groups = rest.match(/.{1,4}/g) ?? []
  return (
    <code className={className} aria-label={homeId} title={homeId}>
      <span aria-hidden="true">
        <span className={s.kind}>{kind}_</span>
        {groups.map((group, at) => (
          <span key={at} className={s.group}>
            {group}
          </span>
        ))}
      </span>
    </code>
  )
}
