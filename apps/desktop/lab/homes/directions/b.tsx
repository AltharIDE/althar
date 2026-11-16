import { type ComponentType, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  Caret,
  Dialog,
  Disclosure,
  DisclosureTrigger,
  Field,
  Fold,
  Icon,
  Menu,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  type ProjectTabsProps,
  Spinner,
  TitleBar,
} from '@althar/ui'

import type { HomesHost } from '../../../src/homes'
import { useServices } from '../../../src/renderer/data/services'
import { opening, useLab } from '../state'
import { homesFor, hostOf, world } from '../world'
import { Manage } from './a'
import {
  Compare,
  Glyph,
  homeOf,
  isOpen,
  lastOpened,
  limitsLine,
  OptionFields,
  Refusal,
  Target,
  useConnect,
  useHomes,
  useWindowHome,
} from './parts'
import { store, useShowHomes } from './store'
import type { DirectionParts } from './types'
import s from './b.module.css'

/*
 * B · Home tab. The window's first tab is its home. In this computer's
 * window it stays Home; in a home's window it is that home, by its name and
 * a server's glyph, and nothing else in the bar says so. A chevron on that
 * tab is the switcher: every home, each in its own window. Connecting steps
 * through a dialog: the host, a check that says what it is doing, then the
 * home's identity as its host prints it, to compare there. A dropped
 * connection is a strip under the tabs, and Althar tries again by itself
 * (only the tunnel: a press made while it was down was refused, never sent
 * later). What SSH can't do is simply not offered: no + for a new project;
 * the switcher's note says why.
 */

const ui = store({
  menu: opening.open === 'homes',
  dialog: (opening.open === 'manage' ? 'manage' : opening.open !== null && opening.open !== 'homes' ? 'connect' : null) as
    | 'connect'
    | 'manage'
    | null,
})

function Switcher({ windowId }: { windowId: string }) {
  const { menu } = ui.use()
  const homes = useHomes()
  const here = useWindowHome(windowId)
  const host = useServices().host.homes ?? homesFor(windowId)
  const remote = here.current.kind === 'ssh'
  const hint = (id: string) => (id === windowId ? 'This window' : isOpen(id) ? 'Open' : undefined)
  return (
    <Menu
      label="Homes"
      align="start"
      width={300}
      descriptions="under"
      open={menu}
      onOpenChange={(open) => ui.set({ menu: open })}
      {...(remote ? { note: limitsLine() } : {})}
      trigger={
        <button type="button" className={s.chevron} aria-label="Homes">
          <Icon name="chevronD" size={11} />
        </button>
      }
    >
      <MenuGroup label="Homes">
        <MenuItem lead={<Glyph kind="local" />} hint={hint('local')} onSelect={() => void host.open('local')}>
          This computer
        </MenuItem>
        {homes.map((home) => (
          <MenuItem
            key={home.id}
            lead={<Glyph kind="home" />}
            hint={hint(home.id) ?? lastOpened(home)}
            description={<Target home={home} />}
            onSelect={() => void host.open(home.id)}
          >
            {home.name}
          </MenuItem>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuItem icon="plus" onSelect={() => ui.set({ dialog: 'connect' })}>
        Connect a home…
      </MenuItem>
      {homes.length > 0 && (
        <MenuItem icon="gear" onSelect={() => ui.set({ dialog: 'manage' })}>
          Manage homes…
        </MenuItem>
      )}
    </Menu>
  )
}

/** The tries Althar makes by itself after a drop, and how long it waits before each. */
const RETRIES = [3, 10, 30]

/** A dropped connection: a strip under the tabs, trying again by itself, then waiting for the person. */
function Strip({ windowId }: { windowId: string }) {
  const here = useWindowHome(windowId)
  const host = useServices().host.homes ?? homesFor(windowId)
  const [tries, setTries] = useState(0)
  const [left, setLeft] = useState<number | null>(null)
  const down = here.connection === 'disconnected'
  // Back: the count starts again for the next drop.
  useEffect(() => {
    if (here.connection === 'connected') setTries(0)
  }, [here.connection])
  useEffect(() => {
    if (!down || tries >= RETRIES.length) {
      setLeft(null)
      return
    }
    let seconds = RETRIES[tries] ?? 0
    setLeft(seconds)
    const timer = setInterval(() => {
      seconds -= 1
      setLeft(seconds)
      if (seconds <= 0) {
        clearInterval(timer)
        setTries((n) => n + 1)
        void host.reconnect()
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [down, tries, host])
  if (here.current.kind !== 'ssh' || here.connection === 'connected') return null
  const name = here.current.home.name
  const gaveUp = down && left === null
  return (
    <div className={s.strip} role="status" data-gave-up={gaveUp || undefined}>
      {here.connection === 'connecting' ? <Spinner size="small" /> : <Glyph kind="down" size={13} className={s.stripGlyph} />}
      <span className={s.stripWords}>
        {here.connection === 'connecting'
          ? `Reconnecting to ${name}…`
          : gaveUp
            ? `Couldn’t reconnect to ${name}. ${here.problem ?? ''}`
            : `Lost the connection to ${name}. Its work carries on there.`}
      </span>
      {down && left !== null && <span className={s.stripWhen}>Trying again in {left}s</span>}
      {down && (
        <Button
          size="small"
          onClick={() => {
            setTries(RETRIES.length)
            void host.reconnect()
          }}
        >
          {gaveUp ? 'Reconnect' : 'Reconnect now'}
        </Button>
      )}
    </div>
  )
}

/** The window's tabs, its first the home's: named and drawn for it in a home's window, with the switcher on it. */
function Tabs({ Real, ...props }: ProjectTabsProps & { Real: ComponentType<ProjectTabsProps> }) {
  const { w } = useLab()
  const here = useWindowHome(w)
  const homes = useHomes()
  const bar = useRef<HTMLElement>(null)
  const [slot, setSlot] = useState<{ tab: HTMLElement; select: HTMLElement } | null>(null)
  // Each render: the tab's button is the kit's, found once it's drawn; set only when it changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const tab = bar.current?.querySelector<HTMLElement>('nav > ul > li')
    const select = tab?.querySelector<HTMLElement>('button')
    if (tab != null && select != null && slot?.tab !== tab) setSlot({ tab, select })
  })
  // The home's tab grew with what the lab put in it: the projects' tabs start again from their first, measured afresh.
  useEffect(() => {
    const list = bar.current?.querySelectorAll<HTMLElement>('nav > ul')[1]
    if (list == null) return
    list.scrollLeft = 0
    list.dispatchEvent(new Event('scroll'))
  }, [slot])
  const remote = here.current.kind === 'ssh'
  const glyph = here.connection === 'connecting' ? null : here.connection === 'disconnected' ? 'down' : 'home'
  return (
    <>
      <Real
        {...props}
        ref={bar}
        className={[props.className, s.tabs, remote ? s.remote : ''].join(' ')}
        {...(remote
          ? {
              text: { ...props.text, home: here.current.home.name },
              // A new project isn't made over SSH: no +, rather than one that says no.
              onNewProject: undefined,
              onCloseHome: undefined,
            }
          : homes.length > 0
            ? { onCloseHome: undefined }
            : {})}
      />
      {slot !== null &&
        remote &&
        createPortal(
          glyph === null ? <Spinner size="small" className={s.tabGlyph} /> : <Glyph kind={glyph} size={14} className={s.tabGlyph} />,
          slot.select,
        )}
      {slot !== null && (remote || homes.length > 0) && createPortal(<Switcher windowId={w} />, slot.tab)}
      <Strip windowId={w} />
    </>
  )
}

/** What the check is doing, as it does it. Main would say each stage; here they follow the clock. */
const STAGES = (host: string) => [`Reaching ${host} over SSH`, 'Starting althar-host there', 'Reading its home']

function Stages({ host, done, failed }: { host: string; done: boolean; failed: boolean }) {
  const [at, setAt] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setAt((n) => Math.min(n + 1, 2)), 520)
    return () => clearInterval(timer)
  }, [])
  const stages = STAGES(host)
  return (
    <ol className={s.stages}>
      {stages.map((stage, i) => {
        const state = done || i < at ? 'done' : i === at ? (failed ? 'failed' : 'now') : 'later'
        return (
          <li key={stage} className={s.stage} data-state={state}>
            <span className={s.stageMark}>
              {state === 'done' ? (
                <Icon name="check" size={12} />
              ) : state === 'now' ? (
                <Spinner size="small" />
              ) : state === 'failed' ? (
                <Icon name="problem" size={12} />
              ) : (
                <i />
              )}
            </span>
            {stage}
          </li>
        )
      })}
    </ol>
  )
}

function Connect({ homes, onClose }: { homes: HomesHost; onClose: () => void }) {
  const id = useId()
  const start =
    opening.open === 'checked'
      ? { target: 'balazs@new-box', checked: true }
      : opening.open === 'refused'
        ? { target: 'balazs@down-box', refused: true }
        : undefined
  const form = useConnect(homes, onClose, start)
  const [page, setPage] = useState<'host' | 'home'>(start?.checked === true ? 'home' : 'host')
  // A refused check goes back to the host, the problem under it.
  useEffect(() => {
    if (form.phase === 'refused') setPage('host')
  }, [form.phase])
  const check = () => {
    setPage('home')
    form.check()
  }
  if (page === 'host')
    return (
      <Dialog
        title="Connect a home"
        description="A computer of yours running althar-host, that you reach with SSH."
        width={480}
        onClose={onClose}
        onSubmit={check}
        actions={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="signal" disabled={form.target.trim() === ''}>
              Check host
            </Button>
          </>
        }
      >
        <div className={s.form}>
          <label className={s.field} htmlFor={`${id}-host`}>
            <span>SSH host</span>
            <Field
              id={`${id}-host`}
              value={form.target}
              invalid={form.phase === 'refused'}
              placeholder="user@host, or a Host from your SSH config"
              spellCheck={false}
              autoComplete="off"
              autoFocus
              onChange={(event) => form.setTarget(event.currentTarget.value)}
            />
            {form.phase === 'refused' && form.problem !== null && <Refusal problem={form.problem} />}
          </label>
          <Disclosure>
            <DisclosureTrigger>
              <button type="button" className={s.more}>
                Connection options <Caret />
              </button>
            </DisclosureTrigger>
            <Fold bleed={false}>
              <OptionFields form={form} className={s.options} />
            </Fold>
          </Disclosure>
        </div>
      </Dialog>
    )
  const checked = form.checked
  return (
    <Dialog
      title={checked === null ? `Checking ${hostOf(form.target)}` : 'Is this your home?'}
      width={480}
      holding
      onClose={onClose}
      onBack={() => {
        form.cancel()
        setPage('host')
      }}
      onSubmit={form.connect}
      actions={
        checked === null ? (
          <Button
            onClick={() => {
              form.cancel()
              setPage('host')
            }}
          >
            Stop
          </Button>
        ) : (
          <>
            <Button onClick={() => setPage('host')}>Back</Button>
            <Button type="submit" variant="signal" busy={form.phase === 'connecting'} disabled={form.name.trim() === ''}>
              {form.phase === 'connecting' ? 'Connecting…' : 'Connect'}
            </Button>
          </>
        )
      }
    >
      {checked === null ? (
        <Stages host={hostOf(form.target)} done={false} failed={false} />
      ) : (
        <div className={s.form}>
          <p className={s.lead}>
            Run this on <Target home={{ ssh: { target: checked.target } }} className={s.inlineTarget} />. It should print the same home.
          </p>
          <Compare checked={checked} terminal />
          <label className={s.field} htmlFor={`${id}-name`}>
            <span>Name</span>
            <Field
              id={`${id}-name`}
              value={form.name}
              maxLength={120}
              autoFocus
              onChange={(event) => form.setName(event.currentTarget.value)}
            />
          </label>
        </div>
      )}
    </Dialog>
  )
}

function Overlays({ windowId }: { windowId: string }) {
  const { dialog } = ui.use()
  const homes = useServices().host.homes ?? homesFor(windowId)
  const saved = useHomes()
  const here = useWindowHome(windowId)
  const show = useCallback(() => {
    if (here.current.kind === 'local' && saved.length === 0) ui.set({ dialog: 'connect' })
    else ui.set({ menu: true })
  }, [here.current.kind, saved.length])
  useShowHomes(homes, show)
  if (dialog === 'connect') return <Connect homes={homes} onClose={() => ui.set({ dialog: null })} />
  if (dialog === 'manage')
    return (
      <Manage homes={homes} windowId={windowId} onClose={() => ui.set({ dialog: null })} onConnect={() => ui.set({ dialog: 'connect' })} />
    )
  return null
}

function Opening({ windowId }: { windowId: string }) {
  const here = useWindowHome(windowId)
  const home = homeOf(windowId)
  if (home === undefined) return null
  const refused = here.connection === 'disconnected'
  return (
    <div className={s.opening}>
      <TitleBar>
        <span className={s.fakeTab}>
          {refused ? <Glyph kind="down" size={14} /> : <Spinner size="small" />}
          {home.name}
        </span>
      </TitleBar>
      <main className={s.openingBody}>
        <h1 className={s.openingTitle}>Opening {home.name}</h1>
        <Target home={home} />
        <div className={s.openingSteps}>
          <OpeningStages key={refused ? 'refused' : 'going'} host={hostOf(home.ssh.target)} failed={refused} />
          {refused && (
            <>
              <Refusal problem={here.problem ?? 'The home didn’t answer.'} />
              <span className={s.openingActions}>
                <Button onClick={() => world.closeWindow(windowId)}>Close window</Button>
                <Button variant="signal" onClick={() => void homesFor(windowId).reconnect()}>
                  Try again
                </Button>
              </span>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function OpeningStages({ host, failed }: { host: string; failed: boolean }) {
  const [at, setAt] = useState(failed ? 0 : 0)
  useEffect(() => {
    if (failed) return
    const timer = setInterval(() => setAt((n) => Math.min(n + 1, 2)), 420)
    return () => clearInterval(timer)
  }, [failed])
  const stages = [`Reaching ${host} over SSH`, 'Checking it’s the home you saved', 'Reading its projects']
  return (
    <ol className={s.stages}>
      {stages.map((stage, i) => {
        const state = failed ? (i === 0 ? 'failed' : 'later') : i < at ? 'done' : i === at ? 'now' : 'later'
        return (
          <li key={stage} className={s.stage} data-state={state}>
            <span className={s.stageMark}>
              {state === 'done' ? (
                <Icon name="check" size={12} />
              ) : state === 'now' ? (
                <Spinner size="small" />
              ) : state === 'failed' ? (
                <Icon name="problem" size={12} />
              ) : (
                <i />
              )}
            </span>
            {stage}
          </li>
        )
      })}
    </ol>
  )
}

function Empty() {
  const { w } = useLab()
  const home = homeOf(w)
  return (
    <main className={s.empty}>
      <h1 className={s.openingTitle}>{home?.name ?? 'This home'} has no projects yet</h1>
      <p className={s.emptyWords}>New projects are added on the host for now. Each shows here as soon as it is.</p>
    </main>
  )
}

/** The bar's end has nothing of B's: the home is the first tab. */
const Nothing = () => null

export const b: DirectionParts = {
  Button: Nothing,
  Overlays,
  Opening,
  Tabs,
  Empty,
}
