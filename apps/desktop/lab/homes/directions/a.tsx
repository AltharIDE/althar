import { useCallback, useId, useState } from 'react'
import {
  Button,
  Caret,
  ChromeButton,
  Code,
  Dialog,
  Disclosure,
  DisclosureTrigger,
  Field,
  Fold,
  Menu,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  Spinner,
  TitleBar,
} from '@althar/ui'

import type { HomesHost } from '../../../src/homes'
import { useServices } from '../../../src/renderer/data/services'
import { opening, useLab } from '../state'
import { homesFor, isSaved, type LabHome, world } from '../world'
import {
  Compare,
  Glyph,
  homeOf,
  isOpen,
  lastOpened,
  OptionFields,
  Refusal,
  Target,
  useConnect,
  useHomes,
  useWindowHome,
  Working,
} from './parts'
import { SigilManage } from './manage/one'
import { CardsManage } from './manage/three'
import { OrbitManage } from './manage/two'
import { store, useShowHomes } from './store'
import type { DirectionParts } from './types'
import s from './a.module.css'

/*
 * A · Chip. The window's home is one chip at the end of its bar, beside
 * Offline and the meters, and only where there is a home to speak of: in a
 * home's window its name, in this computer's a glyph once a home is saved.
 * Its menu is the chooser. Connecting is one dialog: the host, a check, and
 * the home's identity with the line that compares it on the host. A dropped
 * connection shows in the chip itself, with Reconnect beside it: the window
 * stays as it was, readable, and nothing covers it. Manage homes is one of
 * three dialogs (manage/, keys 1–3).
 */

const ui = store({
  menu: opening.open === 'homes',
  dialog: (opening.open === 'manage' ? 'manage' : opening.open !== null && opening.open !== 'homes' ? 'connect' : null) as
    | 'connect'
    | 'manage'
    | null,
})

/** The lab's 1–3: the chip's Manage homes, opened over the window in front. */
export const showManage = () => ui.set({ menu: false, dialog: 'manage' })

/** The menu of homes: this computer, each saved home, and the ways to add and manage them. */
function HomesMenu({ windowId, trigger }: { windowId: string; trigger: React.ReactElement }) {
  const { menu } = ui.use()
  const homes = useHomes()
  const here = useWindowHome(windowId)
  const host = useServices().host.homes ?? homesFor(windowId)
  const remote = here.current.kind === 'ssh'
  // A window on a home since forgotten stays on it: the menu still names it, as this window's.
  const listed: ReadonlyArray<LabHome> =
    here.current.kind === 'ssh' && !isSaved(windowId) ? [{ ...here.current.home, opened: 0 }, ...homes] : homes
  const hint = (id: string) => (id === windowId ? 'This window' : isOpen(id) ? 'Open' : undefined)
  return (
    <Menu
      label="Homes"
      trigger={trigger}
      align="end"
      width={300}
      descriptions="under"
      open={menu}
      onOpenChange={(open) => ui.set({ menu: open })}
    >
      {remote && here.connection === 'disconnected' && (
        <>
          <MenuItem icon="reload" description={here.problem} onSelect={() => void host.reconnect()}>
            Reconnect
          </MenuItem>
          <MenuSeparator />
        </>
      )}
      <MenuGroup label="Homes">
        <MenuItem lead={<Glyph kind="local" />} hint={hint('local')} onSelect={() => void host.open('local')}>
          This computer
        </MenuItem>
        {listed.map((home) => (
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

/** At the bar's end: the home's name in its window; a glyph in this computer's once a home is saved; nothing before. */
function Chip() {
  const { w } = useLab()
  const here = useWindowHome(w)
  const homes = useHomes()
  const host = useServices().host.homes
  if (here.current.kind === 'local') {
    if (homes.length === 0) return null
    return <HomesMenu windowId={w} trigger={<ChromeButton icon="plug" label="Homes" kbd="⌘⇧H" compact />} />
  }
  const { home } = here.current
  const down = here.connection === 'disconnected'
  const connecting = here.connection === 'connecting'
  return (
    <span className={s.chipRow}>
      <HomesMenu
        windowId={w}
        trigger={
          <button
            type="button"
            className={s.chip}
            data-down={down || undefined}
            aria-label={`${home.name}, ${down ? 'disconnected' : connecting ? 'reconnecting' : 'over SSH'}. Homes`}
          >
            {connecting ? <Spinner size="small" /> : <Glyph kind={down ? 'down' : 'home'} size={13} />}
            <span className={s.name}>{home.name}</span>
            {down && <span className={s.state}>Disconnected</span>}
            {connecting && <span className={s.quiet}>Reconnecting…</span>}
          </button>
        }
      />
      {down && (
        <Button size="small" onClick={() => void host?.reconnect()}>
          Reconnect
        </Button>
      )}
    </span>
  )
}

function Connect({ homes, onClose }: { homes: HomesHost; onClose: () => void }) {
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
  const checked = form.phase === 'checked' || (form.phase === 'connecting' && form.checked !== null)
  return (
    <Dialog
      title="Connect a home"
      width={480}
      holding={form.phase === 'checking' || form.phase === 'connecting'}
      onClose={onClose}
      onSubmit={() => (checked ? form.connect() : form.check())}
      actions={
        <>
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
        {!checked && (
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
        )}
        {checked && form.checked !== null && (
          <section className={s.check} aria-label="The home on this host">
            <span className={s.label}>Home on {form.checked.target}</span>
            <Compare checked={form.checked} />
            <p className={s.note}>
              On the host, <Code>althar-host status</Code> prints the same home. Connect only if it does.
            </p>
          </section>
        )}
        {checked && (
          <label className={s.field} htmlFor={`${id}-name`}>
            <span>Name</span>
            <Field id={`${id}-name`} value={form.name} maxLength={120} onChange={(event) => form.setName(event.currentTarget.value)} />
          </label>
        )}
      </div>
    </Dialog>
  )
}

export function Manage({
  homes,
  windowId,
  onClose,
  onConnect,
}: {
  homes: HomesHost
  windowId: string
  onClose: () => void
  onConnect: () => void
}) {
  const saved = useHomes()
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <Dialog
      title="Homes"
      width={520}
      onClose={onClose}
      actions={
        <>
          <Button icon="plus" onClick={onConnect}>
            Connect a home…
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <ul className={s.rows}>
        {saved.map((home) => (
          <li key={home.id} className={s.row}>
            <Glyph kind="home" size={16} className={s.rowGlyph} />
            <span className={s.rowWords}>
              <span className={s.rowName}>{home.name}</span>
              <Target home={home} />
            </span>
            <span className={s.rowWhen}>{home.id === windowId ? 'This window' : isOpen(home.id) ? 'Open' : lastOpened(home)}</span>
            <span className={s.rowActions}>
              <Button size="small" onClick={() => void homes.open(home.id).then(onClose)}>
                Open
              </Button>
              <Button
                size="small"
                variant="danger"
                onClick={() => void homes.forget(home.id).catch((error: Error) => setProblem(error.message))}
              >
                Forget
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {problem !== null && <Refusal problem={problem} />}
    </Dialog>
  )
}

const MANAGES = { '1': SigilManage, '2': OrbitManage, '3': CardsManage }

function Overlays({ windowId }: { windowId: string }) {
  const { dialog } = ui.use()
  const homes = useServices().host.homes ?? homesFor(windowId)
  const saved = useHomes()
  const here = useWindowHome(windowId)
  // ⌘⇧H: the chip's menu where there is a chip; the form where there isn't yet.
  const show = useCallback(() => {
    if (here.current.kind === 'local' && saved.length === 0) ui.set({ dialog: 'connect' })
    else ui.set({ menu: true })
  }, [here.current.kind, saved.length])
  useShowHomes(homes, show)
  const { m } = useLab()
  if (dialog === 'connect') return <Connect homes={homes} onClose={() => ui.set({ dialog: null })} />
  if (dialog === 'manage') {
    const Chosen = MANAGES[m]
    return (
      <Chosen homes={homes} windowId={windowId} onClose={() => ui.set({ dialog: null })} onConnect={() => ui.set({ dialog: 'connect' })} />
    )
  }
  return null
}

/** A home's window before it first connects: its name and host, and how it is going. */
function Opening({ windowId }: { windowId: string }) {
  const here = useWindowHome(windowId)
  const home = homeOf(windowId)
  if (home === undefined) return null
  const refused = here.connection === 'disconnected'
  return (
    <div className={s.opening}>
      <TitleBar end={<Chip />}>{null}</TitleBar>
      <main className={s.openingBody}>
        <Glyph kind={refused ? 'down' : 'home'} size={28} className={s.openingGlyph} />
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

function Empty() {
  const { w } = useLab()
  const home = homeOf(w)
  return (
    <main className={s.empty}>
      <Glyph kind="home" size={28} className={s.openingGlyph} />
      <h1 className={s.openingName}>No projects on {home?.name ?? 'this home'} yet</h1>
      <p className={s.emptyWords}>Add a project on the host and it shows here.</p>
    </main>
  )
}

export const a: DirectionParts = {
  Button: Chip,
  Overlays,
  Opening,
  Empty,
}
