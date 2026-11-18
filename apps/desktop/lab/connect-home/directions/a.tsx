import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Button, Code, CopyButton, Dialog, Icon, LiveDot, ProjectInk, ProjectMark, Spinner } from '@althar/ui'

import type { Flow } from '../flow'
import { InstallDone, installActions, InstallSteps, type Scenario, useInstall } from './install'
import { Chunked, CodeField, HostField, LaterProblem, MethodSwitch, NameField, Options } from './parts'
import s from './a.module.css'

/*
 * A · The drawing. The Welcome's drawing board, in the dialog: this computer
 * and the home being made, joined by a line drawn as the connection stands:
 * drafted, being reached, found, connecting, connected, or broken where it
 * failed. The home's card fills in as it is typed and found. A first home
 * opens on the same drawing, with work running on the home, then sets the
 * home up: over SSH, where Althar installs it, or with one command run on
 * the server, which prints the pairing code to paste here.
 */

type View = 'intro' | 'setup' | 'form'
type Route = 'ssh' | 'line'

/** What the server runs to become a home: installs althar-host, starts it as a service, prints a pairing code. Assumed: there is no installer yet. */
const INSTALL = 'curl -fsSL https://althar.dev/home | sh'
const DOCS = 'https://althar.dev/docs/homes'

/**
 * One page of the dialog becoming another as a morph: the dialog takes its new height, the drawing and its cards move
 * with it, and what's under the drawing crosses over (a.module.css names each). At once where motion is reduced.
 */
const morph = (change: () => void) => {
  if (typeof document.startViewTransition !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return change()
  document.startViewTransition(() => flushSync(change))
}

const SAMPLE = [
  { id: 'prj_meridian', ink: ProjectInk.Clay },
  { id: 'prj_ledger', ink: ProjectInk.Moss },
  { id: 'prj_atlas', ink: ProjectInk.Indigo },
]

export function DrawingDirection({
  flow,
  first,
  scenario = 'ok',
  onClose,
}: {
  flow: Flow
  first: boolean
  scenario?: Scenario
  onClose: () => void
}) {
  // Reopened after Althar quit midway through setting a home up: it opens where that stopped.
  const reopened = scenario === 'resume'
  const [view, setView] = useState<View>(first && !reopened ? 'intro' : 'form')
  const [route, setRoute] = useState<Route>('ssh')
  // Came through setup over SSH: Althar installs it there, as a run of steps (install.tsx).
  const [installs, setInstalls] = useState(reopened)
  const install = useInstall(flow, scenario)
  useEffect(() => {
    if (!reopened) return
    flow.setMethod('ssh')
    flow.ssh.setTarget('deploy@vps.example.com')
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once, as it opens
  }, [])
  const installing = view === 'form' && installs && flow.method === 'ssh' && install.phase !== 'idle' && flow.found === null
  const stage = !installing
    ? view === 'form'
      ? flow.stage
      : view
    : install.phase === 'failed'
      ? 'refused'
      : install.phase === 'running' || install.phase === 'reconnecting' || install.phase === 'done'
        ? 'checking'
        : 'draft'
  const go = () => {
    if (view === 'intro') return morph(() => setView('setup'))
    if (view === 'setup')
      return morph(() => {
        flow.setMethod(route === 'ssh' ? 'ssh' : 'pair')
        setInstalls(route === 'ssh')
        setView('form')
      })
    if (installs && flow.method === 'ssh' && flow.found === null) {
      if (install.phase === 'idle') return flow.ssh.target.trim() === '' ? undefined : install.start()
      if (install.phase === 'failed' && install.problem?.retry) return install.retry()
      if (install.phase === 'trust') return install.trust()
      if (install.phase === 'stopped') return install.resume()
      return
    }
    flow.submit()
  }
  const run = installs && flow.method === 'ssh' && flow.found === null ? installActions(install) : null
  const back = () => morph(() => setView(first ? 'intro' : 'form'))
  const title = view === 'intro' ? 'Your first home' : view === 'setup' ? 'Set up a home' : 'Connect a home'
  return (
    <Dialog
      title={title}
      width={660}
      className={s.dialog}
      holding={flow.busy || install.busy}
      tall={installing}
      onClose={onClose}
      onBack={view === 'setup' ? back : undefined}
      onSubmit={go}
      actions={
        view === 'form' && installs && flow.method === 'ssh' && flow.found === null ? (
          <>
            {run?.secondary === 'Stop' ? <Button onClick={install.stop}>Stop</Button> : <Button onClick={onClose}>Cancel</Button>}
            {run !== null && run.other !== undefined && (
              <Button variant={run.primary === null ? 'signal' : undefined} onClick={run.other.act}>
                {run.other.label}
              </Button>
            )}
            {(run === null || run.primary !== null) && (
              <Button
                type="submit"
                variant="signal"
                busy={run?.busy === true || (install.phase === 'done' && flow.stage === 'checking')}
                disabled={run?.busy === true || (run === null && flow.ssh.target.trim() === '')}
              >
                {run === null ? (install.phase === 'done' ? 'Reading its identity…' : 'Set it up') : run.primary}
              </Button>
            )}
          </>
        ) : view === 'form' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            {flow.action}
          </>
        ) : (
          <>
            <Button onClick={onClose}>{view === 'intro' ? 'Not now' : 'Cancel'}</Button>
            <Button type="submit" variant="signal">
              {view === 'intro' ? 'Set one up' : route === 'ssh' ? 'Continue' : 'Paste its code'}
            </Button>
          </>
        )
      }
    >
      <div className={s.board} data-stage={stage}>
        <div className={s.card} data-here="">
          <span className={s.glyph}>
            <Icon name="computer" size={15} />
          </span>
          <span className={s.words}>
            <span className={s.name}>This computer</span>
            <span className={s.where}>Can sleep</span>
          </span>
        </div>
        <Wire
          stage={stage}
          how={view === 'intro' ? 'always on' : (view === 'setup' ? route === 'ssh' : flow.method === 'ssh') ? 'ssh' : 'https'}
        />
        <HomeCard flow={flow} view={view} />
      </div>
      <div className={s.body}>
        {view === 'intro' && (
          <div className={s.intro}>
            <h3 className={s.lede}>Work that keeps going while this computer sleeps</h3>
            <p className={s.copy}>
              A home is a computer that runs Althar for you, such as a server that stays on. Its tasks run there, and you open its projects
              from here, each in a window of its own.
            </p>
          </div>
        )}
        {view === 'setup' && <Setup route={route} onRoute={(next) => morph(() => setRoute(next))} />}
        {view === 'form' && (
          <div className={s.form} key="form">
            {!installing && install.phase !== 'done' && (
              <MethodSwitch flow={flow} className={s.method} onChange={(next) => morph(() => flow.setMethod(next))} />
            )}
            {flow.method === 'ssh' ? (
              <HostField
                flow={flow}
                readOnly={install.phase !== 'idle' && install.phase !== 'failed'}
                focus={!first}
                help={
                  installs && install.phase === 'idle' ? 'Althar installs and starts althar-host there, where it isn’t yet.' : undefined
                }
              />
            ) : (
              <CodeField
                flow={flow}
                focus={!first}
                help={
                  <>
                    On the home, <Code>althar-host pair</Code> prints one.{' '}
                    <button type="button" className={s.link} onClick={() => morph(() => setView('setup'))}>
                      Not set up yet?
                    </button>
                  </>
                }
              />
            )}
            {installs && flow.method === 'ssh' && install.phase !== 'idle' && flow.found === null && <InstallSteps install={install} />}
            {flow.method === 'ssh' && flow.found === null && flow.stage !== 'checking' && install.phase === 'idle' && (
              <Options flow={flow} />
            )}
            {flow.found !== null && (
              <>
                {installs && flow.method === 'ssh' && install.phase === 'done' ? (
                  // Althar made this home itself, over a key you trusted: there's no identity to compare.
                  <InstallDone install={install} />
                ) : (
                  <p className={s.note}>
                    {flow.method === 'ssh' ? (
                      <>
                        On the host, <Code>althar-host status</Code> prints the same identity. Connect only if it does.
                      </>
                    ) : (
                      'Tasks and conversations are available. Approvals need a trusted device.'
                    )}
                  </p>
                )}
                <NameField flow={flow} />
              </>
            )}
            <LaterProblem flow={flow} />
          </div>
        )}
      </div>
    </Dialog>
  )
}

/** The two ways a server becomes a home: Althar sets it up over SSH, or one command run on it does. */
function Setup({ route, onRoute }: { route: Route; onRoute: (next: Route) => void }) {
  return (
    <div className={s.setup}>
      <div className={s.routes} role="radiogroup" aria-label="How to set it up">
        <RouteCard
          on={route === 'ssh'}
          onPick={() => onRoute('ssh')}
          icon="terminal"
          title="Over SSH"
          line="Althar installs it for you."
          tag="Easiest"
        />
        <RouteCard
          on={route === 'line'}
          onPick={() => onRoute('line')}
          icon="globe"
          title="One command on the server"
          line="It prints a pairing code."
        />
      </div>
      {route === 'ssh' ? (
        <div className={s.detail} key="ssh">
          <p className={s.copy}>
            Any Linux server you can reach with <Code>ssh</Code> from this computer: a VPS, a machine at home, a spare box. Althar installs{' '}
            <Code>althar-host</Code>, starts it so it survives restarts, and connects. Nothing to copy.
          </p>
        </div>
      ) : (
        <div className={s.detail} key="line">
          <div className={s.term}>
            <span className={s.prompt} aria-hidden="true">
              $
            </span>
            <code className={s.command}>{INSTALL}</code>
            <CopyButton value={INSTALL} tone="onDark" className={s.termCopy} />
          </div>
          <ol className={s.ticks}>
            <li>Installs althar-host and starts it as a service</li>
            <li>Reaches it over Tailscale where it’s there, or the server’s own address</li>
            <li>Ends with a pairing code to paste here</li>
          </ol>
          <p className={s.aside}>
            Already set up? <Code>althar-host pair</Code> prints a new code.{' '}
            <a className={s.link} href={DOCS} target="_blank" rel="noreferrer">
              Other ways to install
              <Icon name="external" size={10} />
            </a>
          </p>
        </div>
      )}
      <p className={s.aside}>
        No server yet?{' '}
        <a className={s.link} href={`${DOCS}#servers`} target="_blank" rel="noreferrer">
          What to get
          <Icon name="external" size={10} />
        </a>
      </p>
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
          <span className={s.name} data-empty={name === '' || undefined}>
            {name === '' ? 'New home' : name}
          </span>
          {!intro && (
            <span className={s.where} data-empty={where === '' || view === 'setup' || undefined}>
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
