import { useEffect } from 'react'
import { Button, ChromeButton, chord, keys, Menu, MenuGroup, MenuItem, MenuSeparator, Spinner, Icon } from '@althar/ui'

import type { HomeState, HomesHost, HomesOverview, RemoteHome } from '../../../homes'
import type { Host } from '../../data/services'
import { useServices } from '../../data/services'
import { ConnectHome } from './ConnectHome'
import { ManageHomes } from './ManageHomes'
import { homesUi, livenessOf, openedAgo, useHomesOverview, useHomeState, useHomesUi } from './useHomes'
import s from './Homes.module.css'

/*
 * The window's home is one chip at the end of its bar, and only where there
 * is a home to speak of: in a home's window, its name; in this computer's, a
 * plug once a home is saved. Its menu is the chooser: this computer and each
 * home, Connect a home…, Manage homes…. A dropped connection shows in the
 * chip itself, with Reconnect beside it: the window stays as it was,
 * readable, and nothing covers it.
 */

const SHORTCUT = chord(keys.mod, keys.shift, 'H')

/** The menu of homes, from the chip. */
function HomesMenu({
  homes,
  here,
  overview,
  trigger,
}: {
  homes: HomesHost
  here: HomeState
  overview: HomesOverview | null
  trigger: React.ReactElement
}) {
  const { menu } = useHomesUi()
  const saved = overview?.homes ?? []
  const remote = here.current.kind !== 'local' ? here.current.home : null
  // A window on a home since forgotten stays on it: the menu still names it, as this window's.
  const listed: ReadonlyArray<RemoteHome> = remote !== null && !saved.some((home) => home.id === remote.id) ? [remote, ...saved] : saved
  const hint = (home: RemoteHome | 'local') => {
    if (home === 'local') return here.current.kind === 'local' ? 'This window' : overview?.windows.local !== undefined ? 'Open' : undefined
    if (remote !== null && remote.homeId === home.homeId) return 'This window'
    const live = livenessOf(overview, home)
    return live === 'rest' ? openedAgo(overview?.opened[home.id]) : live === 'down' ? 'Disconnected' : 'Open'
  }
  return (
    <Menu
      label="Homes"
      trigger={trigger}
      align="end"
      width={300}
      descriptions="under"
      open={menu}
      onOpenChange={(open) => homesUi.set({ menu: open })}
    >
      {remote !== null && here.connection === 'disconnected' && (
        <>
          <MenuItem
            icon="reload"
            {...(here.problem === undefined ? {} : { description: here.problem })}
            onSelect={() => void homes.reconnect()}
          >
            Reconnect
          </MenuItem>
          <MenuSeparator />
        </>
      )}
      <MenuGroup label="Homes">
        <MenuItem lead={<Icon name="computer" />} hint={hint('local')} onSelect={() => void homes.open('local')}>
          This computer
        </MenuItem>
        {listed.map((home) => (
          <MenuItem
            key={home.id}
            lead={<Icon name="home" />}
            hint={hint(home)}
            description={<span className={s.target}>{home.ssh?.target ?? home.https?.origin ?? ''}</span>}
            onSelect={() => void homes.open(home.id)}
          >
            {home.name}
          </MenuItem>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuItem icon="plus" onSelect={() => homesUi.set({ dialog: 'connect' })}>
        Connect a home…
      </MenuItem>
      {saved.length > 0 && (
        <MenuItem icon="gear" onSelect={() => homesUi.set({ dialog: 'manage' })}>
          Manage homes…
        </MenuItem>
      )}
    </Menu>
  )
}

/** At the bar's end: the home's name in its window; a plug in this computer's once a home is saved; nothing before. */
export function HomeButton() {
  const { host } = useServices()
  return host.homes === undefined ? null : <Chip homes={host.homes} />
}

export function Chip({ homes }: { homes: HomesHost }) {
  const here = useHomeState(homes)
  const overview = useHomesOverview(homes)
  const drawn = here !== null && (here.current.kind !== 'local' || (overview?.homes.length ?? 0) > 0)
  useEffect(() => {
    if (!drawn) return
    homesUi.set({ chips: homesUi.get().chips + 1 })
    return () => homesUi.set({ chips: homesUi.get().chips - 1, menu: false })
  }, [drawn])
  if (here === null || !drawn) return null
  if (here.current.kind === 'local')
    return (
      <HomesMenu
        homes={homes}
        here={here}
        overview={overview}
        trigger={<ChromeButton icon="plug" label="Homes" kbd={SHORTCUT} compact />}
      />
    )
  const { home } = here.current
  const down = here.connection === 'disconnected'
  const connecting = here.connection === 'connecting'
  return (
    <span className={s.chipRow}>
      <HomesMenu
        homes={homes}
        here={here}
        overview={overview}
        trigger={
          <button
            type="button"
            className={s.chip}
            data-down={down || undefined}
            title={home.ssh?.target ?? home.https?.origin ?? ''}
            aria-label={`${home.name}, ${down ? 'disconnected' : connecting ? 'reconnecting' : home.https === undefined ? 'over SSH' : 'connected'}. Homes`}
          >
            {connecting ? <Spinner size="small" /> : <Icon name={down ? 'unlinked' : 'home'} size={13} />}
            <span className={s.chipName}>{home.name}</span>
            {down && <span className={s.chipDown}>Disconnected</span>}
            {connecting && <span className={s.chipQuiet}>Reconnecting…</span>}
          </button>
        }
      />
      {down && (
        <Button size="small" onClick={() => void homes.reconnect().catch(() => undefined)}>
          Reconnect
        </Button>
      )}
    </span>
  )
}

/**
 * What opens over the window for its homes: Connect a home, or Manage homes.
 * File › Homes… (⌘⇧H, Ctrl+Shift+H) opens the chip's menu where there is a
 * chip; Connect a home where there isn't one yet.
 */
export function HomeConnections({ host }: { host: Host; ready?: boolean }) {
  const { dialog } = useHomesUi()
  const here = useHomeState(host.homes)
  const overview = useHomesOverview(host.homes)
  useEffect(() => {
    const show = () => {
      const { chips } = homesUi.get()
      if (chips > 0) homesUi.set({ menu: true, dialog: null })
      else homesUi.set({ menu: false, dialog: (overview?.homes.length ?? 0) > 0 ? 'manage' : 'connect' })
    }
    const off = host.homes?.onOpen(show)
    window.addEventListener('althar:show-homes', show)
    return () => {
      off?.()
      window.removeEventListener('althar:show-homes', show)
    }
  }, [host.homes, overview])
  if (host.homes === undefined) return null
  const close = () => homesUi.set({ dialog: null })
  if (dialog === 'connect') return <ConnectHome homes={host.homes} onClose={close} />
  if (dialog === 'manage')
    return (
      <ManageHomes
        homes={host.homes}
        overview={overview}
        here={here}
        onClose={close}
        onConnect={() => homesUi.set({ dialog: 'connect' })}
      />
    )
  return null
}
