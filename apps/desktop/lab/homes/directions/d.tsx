import { type CSSProperties, type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Caret, ChromeButton, Code, Disclosure, DisclosureTrigger, Field, Fold, Icon, Kbd, Spinner, TitleBar } from '@althar/ui'

import type { HomesHost } from '../../../src/homes'
import { lab, opening, useLab } from '../state'
import { againOf, homesFor, hostOf, world } from '../world'
import { a } from './a'
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
  Working,
} from './parts'
import { store, useShowHomes } from './store'
import type { DirectionParts } from './types'
import s from './d.module.css'

/*
 * D · Palette and tint. Homes are somewhere you go, by key: ⌘⇧H (or the
 * bar's Homes) opens a palette like ⌘K's, this computer and each saved home,
 * found as you type; type a host that isn't saved and the palette offers to
 * connect it, then checks it in place, the home's identity as its host
 * prints it, and its name. A home's window is told apart by colour, not
 * words: its bar takes the home's ink, so two windows side by side, or in
 * Mission Control, never pass for each other. A dropped connection greys the
 * whole window, still readable but not pressable, since nothing in it works
 * until it's back: one sheet says so, with Reconnect. What SSH can't do is
 * the palette's foot, in a home's window.
 */

/** The window whose palette is open, if one is: a window opened from it starts with its own closed. */
const ui = store({
  open: opening.open !== null && opening.open !== 'manage' ? lab.get().w : (null as string | null),
})

const INKS = ['teal', 'clay', 'indigo', 'moss', 'ochre', 'slate', 'olive'] as const
/** A home's ink, from its id: the same every time, on every computer. */
const inkOf = (id: string) => {
  let n = 0
  for (const char of id) n = (n * 31 + char.charCodeAt(0)) >>> 0
  return `var(--mark-${INKS[n % INKS.length]})`
}
const tint = (id: string) => ({ '--home-ink': inkOf(id) }) as CSSProperties

interface Row {
  readonly id: string
  readonly name: string
  readonly target?: string
  readonly hint: string
}

/** The palette: every home, found as you type; a host that isn't saved, connected from here. */
function Palette({ windowId, homes, onClose }: { windowId: string; homes: HomesHost; onClose: () => void }) {
  const saved = useHomes()
  const here = useWindowHome(windowId)
  const start =
    opening.open === 'checked'
      ? 'balazs@new-box'
      : opening.open === 'refused'
        ? 'balazs@down-box'
        : opening.open === 'connect'
          ? 'balazs@new-box'
          : ''
  const [query, setQuery] = useState(start)
  const [connecting, setConnecting] = useState<string | null>(opening.open === 'checked' || opening.open === 'refused' ? start : null)
  const [index, setIndex] = useState(0)
  const list = useId()
  const q = query.trim().toLowerCase()
  const hint = (id: string, opened?: string) => (id === windowId ? 'This window' : isOpen(id) ? 'Open' : (opened ?? ''))
  const all: ReadonlyArray<Row> = [
    { id: 'local', name: 'This computer', hint: hint('local') },
    ...saved.map((home) => ({ id: home.id, name: home.name, target: home.ssh.target, hint: hint(home.id, lastOpened(home)) })),
  ]
  const rows = all.filter((row) => q === '' || row.name.toLowerCase().includes(q) || (row.target?.toLowerCase().includes(q) ?? false))
  // A host typed that no saved home has: the palette's last row connects it.
  const offer = q !== '' && !saved.some((home) => home.ssh.target.toLowerCase() === q) ? query.trim() : null
  const count = rows.length + (offer === null ? 0 : 1)
  const at = Math.min(index, count - 1)
  const choose = (i: number) => {
    const row = rows[i]
    if (row !== undefined) {
      void homes.open(row.id)
      onClose()
    } else if (offer !== null) setConnecting(offer)
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIndex((at + 1) % count)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex((at - 1 + count) % count)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(at)
    }
  }
  return (
    <Sheet label="Homes" onClose={connecting === null ? onClose : () => setConnecting(null)}>
      {connecting !== null ? (
        <Check homes={homes} target={connecting} onBack={() => setConnecting(null)} onDone={onClose} />
      ) : (
        <>
          <div className={s.search}>
            <Glyph kind="home" size={16} />
            <input
              autoFocus
              value={query}
              placeholder="Go to a home, or type user@host to connect one"
              spellCheck={false}
              autoComplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls={list}
              aria-activedescendant={`${list}-${at}`}
              onChange={(event) => {
                setQuery(event.currentTarget.value)
                setIndex(0)
              }}
              onKeyDown={onKey}
            />
          </div>
          <ul className={s.results} id={list} role="listbox" aria-label="Homes">
            {rows.map((row, i) => (
              <li
                key={row.id}
                id={`${list}-${i}`}
                role="option"
                aria-selected={i === at}
                className={s.row}
                style={row.id === 'local' ? undefined : tint(row.id)}
                onPointerMove={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <span className={s.swatch} data-local={row.id === 'local' || undefined}>
                  <Glyph kind={row.id === 'local' ? 'local' : 'home'} size={14} />
                </span>
                <span className={s.rowName}>{row.name}</span>
                {row.target !== undefined && <span className={s.rowTarget}>{row.target}</span>}
                <span className={s.rowHint}>{row.hint}</span>
              </li>
            ))}
            {offer !== null && (
              <li
                id={`${list}-${rows.length}`}
                role="option"
                aria-selected={at === rows.length}
                className={s.row}
                onPointerMove={() => setIndex(rows.length)}
                onClick={() => choose(rows.length)}
              >
                <span className={s.swatch} data-plus="">
                  <Icon name="plus" size={13} />
                </span>
                <span className={s.rowName}>
                  Connect <span className={s.rowTargetInline}>{offer}</span>
                </span>
                <span className={s.rowHint}>Checks it first</span>
              </li>
            )}
          </ul>
          <footer className={s.foot}>
            <span>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move
            </span>
            <span>
              <Kbd>↵</Kbd> open
            </span>
            {here.current.kind === 'ssh' && <span className={s.footLimits}>{limitsLine()}</span>}
          </footer>
        </>
      )}
    </Sheet>
  )
}

/** Connecting, in the palette: the host checked, its home as the host prints it, then a name. */
function Check({ homes, target, onBack, onDone }: { homes: HomesHost; target: string; onBack: () => void; onDone: () => void }) {
  const id = useId()
  const form = useConnect(homes, onDone, { target, ...(opening.open === 'refused' ? { refused: true } : { checked: true }) })
  const checked = form.checked !== null && (form.phase === 'checked' || form.phase === 'connecting')
  const host = hostOf(form.target)
  return (
    <form
      className={s.check}
      onSubmit={(event) => {
        event.preventDefault()
        if (checked) form.connect()
        else if (form.phase !== 'checking') form.check()
      }}
    >
      <div className={s.checkHead}>
        <button type="button" className={s.back} aria-label="Back to the homes" onClick={onBack}>
          <Icon name="chevronL" size={14} />
        </button>
        <span className={s.checkTitle}>
          Connect <span className={s.rowTargetInline}>{form.target}</span>
        </span>
      </div>
      <div className={s.checkBody}>
        {form.phase === 'checking' && <Working>{`Reaching ${host} over SSH, reading its home…`}</Working>}
        {form.phase === 'refused' && form.problem !== null && <Refusal problem={form.problem} />}
        {checked && form.checked !== null && (
          <>
            <Compare checked={form.checked} terminal />
            <p className={s.note}>
              That’s what <Code>althar-host status</Code> prints on {host}. Run it there; connect only if it’s the same home.
            </p>
            <label className={s.field} htmlFor={`${id}-name`}>
              <span>Name</span>
              <Field
                id={`${id}-name`}
                autoFocus
                value={form.name}
                maxLength={120}
                onChange={(event) => form.setName(event.currentTarget.value)}
              />
            </label>
          </>
        )}
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
      <footer className={s.checkFoot}>
        <span className={s.footKeys}>
          <Kbd>esc</Kbd> back
        </span>
        {checked ? (
          <Button type="submit" variant="signal" busy={form.phase === 'connecting'} disabled={form.name.trim() === ''}>
            {form.phase === 'connecting' ? 'Connecting…' : `Connect ${form.name.trim() || 'home'}`}
          </Button>
        ) : (
          <Button type="submit" busy={form.phase === 'checking'} disabled={form.phase === 'checking'}>
            {form.phase === 'checking' ? 'Checking…' : 'Check again'}
          </Button>
        )}
      </footer>
    </form>
  )
}

/** The palette's sheet over the window, as ⌘K's: there at once, gone with Escape or a press outside. */
function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(
    <>
      <div className={s.scrim} onPointerDown={onClose} />
      <div ref={panel} className={['ch-root', s.sheet].join(' ')} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </>,
    document.body,
  )
}

/** At the bar's end: Homes in this computer's window; in a home's, its name in its ink. */
function Here() {
  const { w } = useLab()
  const here = useWindowHome(w)
  const show = () => ui.set({ open: w })
  if (here.current.kind === 'local') return <ChromeButton icon="plug" label="Homes" kbd="⌘⇧H" compact onClick={show} />
  return (
    <button type="button" className={s.here} onClick={show} aria-label={`${here.current.home.name}, over SSH. Homes`}>
      <Glyph kind="home" size={13} />
      <span className={s.hereName}>{here.current.home.name}</span>
    </button>
  )
}

/** A dropped connection: the window greys, readable, and one sheet says what to do. */
function Down({ windowId }: { windowId: string }) {
  const here = useWindowHome(windowId)
  if (here.current.kind !== 'ssh' || here.connection === 'connected') return null
  const reconnecting = here.connection === 'connecting'
  const { home } = here.current
  return (
    <div className={s.down} role="alertdialog" aria-label={`${home.name} is disconnected`}>
      {reconnecting ? <Spinner size="small" /> : <Glyph kind="down" size={16} className={s.downGlyph} />}
      <span className={s.downWords}>
        <span className={s.downTitle}>{reconnecting ? `Reconnecting to ${home.name}…` : `${home.name} is out of reach`}</span>
        <span className={s.downLine}>
          {reconnecting ? 'What you see is as it was.' : `Its work carries on there; this window waits. ${here.problem ?? ''}`}
        </span>
      </span>
      <span className={s.downActions}>
        <Button size="small" onClick={() => world.closeWindow(windowId)}>
          Close window
        </Button>
        <Button
          size="small"
          variant="signal"
          busy={reconnecting}
          disabled={reconnecting}
          onClick={() => void homesFor(windowId).reconnect()}
        >
          Reconnect
        </Button>
      </span>
    </div>
  )
}

function Around({ children }: { children: ReactNode }) {
  const { w } = useLab()
  const here = useWindowHome(w)
  const remote = here.current.kind === 'ssh'
  const inert = remote && here.connection !== 'connected' && againOf(w)
  return (
    <div className={s.around} data-remote={remote || undefined} style={remote ? tint(w) : undefined}>
      <div className={s.app} data-inert={inert || undefined} inert={inert}>
        {children}
      </div>
      {inert && <Down windowId={w} />}
    </div>
  )
}

function Overlays({ windowId }: { windowId: string }) {
  const { open } = ui.use()
  const homes = homesFor(windowId)
  const show = useCallback(() => ui.set({ open: windowId }), [windowId])
  useShowHomes(homes, show)
  if (open !== windowId) return null
  return <Palette windowId={windowId} homes={homes} onClose={() => ui.set({ open: null })} />
}

/** A home's window before it first connects: its bar already in the home's ink. */
function Opening({ windowId }: { windowId: string }) {
  const here = useWindowHome(windowId)
  const home = homeOf(windowId)
  if (home === undefined) return null
  const refused = here.connection === 'disconnected'
  return (
    <div className={s.opening} data-remote="" style={tint(windowId)}>
      <TitleBar end={<Here />}>{null}</TitleBar>
      <main className={s.openingBody}>
        <span className={s.openingSwatch}>
          <Glyph kind={refused ? 'down' : 'home'} size={22} />
        </span>
        <h1 className={s.openingName}>{home.name}</h1>
        <Target home={home} />
        <div className={s.openingState}>
          {refused ? (
            <>
              <Refusal problem={here.problem ?? 'The home didn’t answer.'} />
              <span className={s.openingActions}>
                <Button onClick={() => world.closeWindow(windowId)}>Close window</Button>
                <Button variant="signal" onClick={() => void homesFor(windowId).reconnect()}>
                  Try again
                </Button>
              </span>
            </>
          ) : (
            <Working>Connecting over SSH…</Working>
          )}
        </div>
      </main>
    </div>
  )
}

export const d: DirectionParts = {
  Button: Here,
  Overlays,
  Opening,
  Empty: a.Empty,
  Around,
}
