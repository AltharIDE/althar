import { type ComponentType, type ReactNode, useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  Caret,
  Code,
  Disclosure,
  DisclosureTrigger,
  Field,
  Fold,
  Icon,
  Menu,
  MenuItem,
  type ProjectTabsProps,
  Spinner,
  TitleBar,
} from '@althar/ui'
import type { HomeProps } from '@althar/ui/screens'

import type { HomesHost } from '../../../src/homes'
import { useServices } from '../../../src/renderer/data/services'
import { opening, useLab } from '../state'
import { windowOf } from '../windows'
import { homesFor, hostOf } from '../world'
import {
  Compare,
  Glyph,
  homeOf,
  isOpen,
  lastOpened,
  LIMITS,
  OptionFields,
  Refusal,
  Target,
  useConnect,
  useHomes,
  useWindowHome,
  Working,
} from './parts'
import { store, useShowHomes } from './store'
import type { DirectionParts } from './types'
import s from './c.module.css'

/*
 * C · Homes on Home. Homes are places, so they live on the Home screen, at
 * its foot under what needs you and the projects: this computer and each
 * saved home, side by side, the window's own lifted as its tab is. Nothing is
 * added to the bar; a home's window names its home in its Home tab. Connecting
 * opens in place, in the shelf, with the room the width gives: the host on
 * the left, what the check found on the right, no dialog. A dropped
 * connection is a card at the window's foot, over the work but not in its
 * way; reconnecting is the person's press, as #982 has it. What SSH can't do
 * is said once, on the Home screen of a home's window, beside its homes.
 */

const shelf = store({
  connecting: opening.open !== null && opening.open !== 'homes',
})

/** The window's tabs: in a home's window, the Home tab is the home's, by its name and glyph. */
function Tabs({ Real, ...props }: ProjectTabsProps & { Real: ComponentType<ProjectTabsProps> }) {
  const { w } = useLab()
  const here = useWindowHome(w)
  const bar = useRef<HTMLElement>(null)
  const [select, setSelect] = useState<HTMLElement | null>(null)
  // Each render: the tab's button is the kit's, found once it's drawn; set only when it changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const found = bar.current?.querySelector<HTMLElement>('nav > ul > li > button')
    if (found != null && found !== select) setSelect(found)
  })
  if (here.current.kind === 'local') return <Real {...props} />
  const glyph = here.connection === 'disconnected' ? 'down' : 'home'
  return (
    <>
      <Real
        {...props}
        ref={bar}
        className={[props.className, s.remote].join(' ')}
        text={{ ...props.text, home: here.current.home.name }}
        onNewProject={undefined}
      />
      {select !== null &&
        createPortal(
          here.connection === 'connecting' ? (
            <Spinner size="small" className={s.tabGlyph} />
          ) : (
            <Glyph kind={glyph} size={14} className={s.tabGlyph} />
          ),
          select,
        )}
    </>
  )
}

function Card({ id, windowId, homes }: { id: string; windowId: string; homes: HomesHost }) {
  const home = id === 'local' ? undefined : homeOf(id)
  const here = id === windowId
  const state = useWindowHome(windowId)
  const name = home?.name ?? 'This computer'
  // The window's own home, while its connection is down: the drop is said here, where the home is.
  const down = here && home !== undefined && state.connection !== 'connected'
  const reconnecting = down && state.connection === 'connecting'
  const when = down
    ? reconnecting
      ? 'Reconnecting…'
      : 'Disconnected'
    : here
      ? 'This window'
      : isOpen(id)
        ? 'Open'
        : home === undefined
          ? ''
          : lastOpened(home)
  return (
    <li className={s.card} data-here={here || undefined} data-down={(down && !reconnecting) || undefined}>
      <button
        type="button"
        className={s.cardOpen}
        onClick={() => void homes.open(id)}
        aria-label={here ? `${name}, this window` : `Open ${name}`}
      >
        <Glyph kind={home === undefined ? 'local' : down && !reconnecting ? 'down' : 'home'} size={16} className={s.cardGlyph} />
        <span className={s.cardName}>{name}</span>
        <span className={s.cardWhen}>{down ? '' : when}</span>
        {home !== undefined && (down ? <span className={s.cardState}>{when}</span> : <Target home={home} className={s.cardHost} />)}
      </button>
      {down && (
        <Button
          size="small"
          variant="signal"
          className={s.cardReconnect}
          busy={reconnecting}
          disabled={reconnecting}
          onClick={() => void homes.reconnect()}
        >
          Reconnect
        </Button>
      )}
      {home !== undefined && !down && (
        <Menu
          label={`${name}’s menu`}
          align="end"
          width={200}
          trigger={
            <button type="button" className={s.cardMore} aria-label={`More for ${name}`}>
              <Icon name="more" size={14} />
            </button>
          }
        >
          <MenuItem icon="external" onSelect={() => void homes.open(id)}>
            {here ? 'Bring forward' : 'Open'}
          </MenuItem>
          <MenuItem icon="remove" tone="danger" onSelect={() => void homes.forget(id)}>
            Forget
          </MenuItem>
        </Menu>
      )}
    </li>
  )
}

/** Connecting, in the shelf's place: the host on the left, what the check found on the right. */
function ConnectHere({ homes, onClose }: { homes: HomesHost; onClose: () => void }) {
  const id = useId()
  const form = useConnect(
    homes,
    onClose,
    opening.open === 'checked'
      ? { target: 'balazs@new-box', checked: true }
      : opening.open === 'refused'
        ? { target: 'balazs@down-box', refused: true }
        : undefined,
  )
  const checked = form.checked !== null && (form.phase === 'checked' || form.phase === 'connecting')
  return (
    <form
      className={s.connect}
      onSubmit={(event) => {
        event.preventDefault()
        if (checked) form.connect()
        else form.check()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className={s.connectSide}>
        <h2 className={s.connectTitle}>Connect a home</h2>
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
      <div className={s.connectSide} data-found={checked || undefined}>
        <h2 className={s.connectTitle}>{checked ? `The home on ${hostOf(form.target)}` : 'What the check finds'}</h2>
        <div className={s.found}>
          {form.phase === 'idle' && (
            <p className={s.note}>Checking reads the host’s home over SSH, as your SSH config has it. Nothing on the host changes.</p>
          )}
          {form.phase === 'checking' && <Working>{`Checking ${hostOf(form.target)}…`}</Working>}
          {form.phase === 'refused' && form.problem !== null && <Refusal problem={form.problem} />}
          {checked && form.checked !== null && (
            <>
              <Compare checked={form.checked} />
              <p className={s.note}>
                On the host, <Code>althar-host status</Code> prints the same home. Connect only if it does.
              </p>
              <label className={s.field} htmlFor={`${id}-name`}>
                <span>Name</span>
                <Field id={`${id}-name`} value={form.name} maxLength={120} onChange={(event) => form.setName(event.currentTarget.value)} />
              </label>
            </>
          )}
        </div>
        <div className={s.connectActions}>
          <Button onClick={onClose}>Cancel</Button>
          {checked ? (
            <Button type="submit" variant="signal" busy={form.phase === 'connecting'} disabled={form.name.trim() === ''}>
              {form.phase === 'connecting' ? 'Connecting…' : 'Connect'}
            </Button>
          ) : (
            <Button type="submit" busy={form.phase === 'checking'} disabled={form.target.trim() === '' || form.phase === 'checking'}>
              {form.phase === 'checking' ? 'Checking…' : 'Check host'}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}

/** The homes at the Home screen's foot: this computer and each saved home, or connecting one, in place. */
function Shelf() {
  const { w } = useLab()
  const { connecting } = shelf.use()
  const saved = useHomes()
  const here = useWindowHome(w)
  const homes = useServices().host.homes ?? homesFor(w)
  // Before any home is saved, this computer's Home has only the way to connect one.
  if (here.current.kind === 'local' && saved.length === 0 && !connecting)
    return (
      <section className={s.shelf} data-bare="">
        <button type="button" className={s.bare} onClick={() => shelf.set({ connecting: true })}>
          <Glyph kind="home" size={14} />
          Connect a home on another computer
        </button>
      </section>
    )
  return (
    <section className={s.shelf} aria-label="Homes">
      {connecting ? (
        <ConnectHere homes={homes} onClose={() => shelf.set({ connecting: false })} />
      ) : (
        <>
          <header className={s.shelfHead}>
            <h2 className={s.shelfTitle}>Homes</h2>
            {here.current.kind === 'ssh' && (
              <p className={s.limits}>
                Over SSH, not yet:{' '}
                {LIMITS.slice(0, 5)
                  .map((one) => one.short.toLowerCase())
                  .join(', ')}
                .
              </p>
            )}
          </header>
          <ul className={s.cards}>
            <Card id="local" windowId={w} homes={homes} />
            {saved.map((home) => (
              <Card key={home.id} id={home.id} windowId={w} homes={homes} />
            ))}
            <li className={s.card}>
              <button type="button" className={s.cardOpen} onClick={() => shelf.set({ connecting: true })}>
                <Icon name="plus" size={14} className={s.cardGlyph} />
                <span className={s.cardName}>Connect a home</span>
              </button>
            </li>
          </ul>
        </>
      )}
    </section>
  )
}

function Home({ Real, ...props }: HomeProps & { Real: ComponentType<HomeProps> }) {
  return (
    <div className={s.home}>
      <Real {...props} className={[props.className, s.homeTop].join(' ')} />
      <Shelf />
    </div>
  )
}

/** A dropped connection: a card at the window's foot, until the person reconnects. */
function Dropped({ windowId }: { windowId: string }) {
  const here = useWindowHome(windowId)
  const homes = homesFor(windowId)
  if (here.current.kind !== 'ssh' || here.connection === 'connected') return null
  const reconnecting = here.connection === 'connecting'
  return (
    <div className={s.dropped} role="status">
      <Glyph kind={reconnecting ? 'home' : 'down'} size={16} className={s.droppedGlyph} />
      <span className={s.droppedWords}>
        <span className={s.droppedTitle}>
          {reconnecting ? `Reconnecting to ${here.current.home.name}…` : `Disconnected from ${here.current.home.name}`}
        </span>
        <span className={s.droppedLine}>{reconnecting ? 'Over SSH, as before.' : `Its work carries on there. ${here.problem ?? ''}`}</span>
      </span>
      <Button variant="signal" busy={reconnecting} disabled={reconnecting} onClick={() => void homes.reconnect()}>
        {reconnecting ? 'Reconnecting…' : 'Reconnect'}
      </Button>
    </div>
  )
}

function Around({ children }: { children: ReactNode }) {
  const { w } = useLab()
  return (
    <div className={s.around}>
      {children}
      <Dropped windowId={w} />
    </div>
  )
}

function Overlays({ windowId }: { windowId: string }) {
  const homes = useServices().host.homes ?? homesFor(windowId)
  // ⌘⇧H: Home, where the homes are, and the way to connect one where there is none yet.
  const saved = useHomes()
  const show = useCallback(() => {
    void windowOf(windowId).router.navigate({ to: '/' })
    if (saved.length === 0) shelf.set({ connecting: true })
  }, [windowId, saved.length])
  useShowHomes(homes, show)
  return null
}

function Opening({ windowId }: { windowId: string }) {
  const here = useWindowHome(windowId)
  const home = homeOf(windowId)
  if (home === undefined) return null
  const refused = here.connection === 'disconnected'
  return (
    <div className={s.opening}>
      <TitleBar>{null}</TitleBar>
      <main className={s.openingBody}>
        <Glyph kind={refused ? 'down' : 'home'} size={28} className={s.cardGlyph} />
        <h1 className={s.openingName}>{home.name}</h1>
        <Target home={home} />
        <div className={s.openingState}>
          {refused ? (
            <>
              <Refusal problem={here.problem ?? 'The home didn’t answer.'} />
              <Button variant="signal" onClick={() => void homesFor(windowId).reconnect()}>
                Try again
              </Button>
            </>
          ) : (
            <Working>Connecting over SSH…</Working>
          )}
        </div>
      </main>
      <Shelf />
    </div>
  )
}

function Empty() {
  const { w } = useLab()
  const home = homeOf(w)
  return (
    <div className={s.emptyWithShelf}>
      <main className={s.openingBody}>
        <h1 className={s.openingName}>{home?.name ?? 'This home'} has no projects yet</h1>
        <p className={s.note}>New projects are added on the host for now. Each shows here as soon as it is.</p>
      </main>
      <Shelf />
    </div>
  )
}

const Nothing = () => null

export const c: DirectionParts = {
  Button: Nothing,
  Overlays,
  Opening,
  Tabs,
  Home,
  Empty,
  Around,
}
