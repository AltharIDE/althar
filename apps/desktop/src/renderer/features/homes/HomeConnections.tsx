import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button, ChromeButton, chord, keys, Menu, MenuGroup, MenuItem, MenuSeparator, Spinner, Icon } from '@althar/ui'

import type { HomeState, HomesHost, HomesOverview, RemoteHome } from '../../../homes'
import type { Host } from '../../data/services'
import { useServices } from '../../data/services'
import { useWorkers } from '../../shared/useWorkers'
import { ConnectHome } from './ConnectHome'
import { ManageHomes } from './ManageHomes'
import { PhonesDialog } from '../phones/PhonesDialog'
import { SetupChip } from './SetUp'
import { homesUi, livenessOf, openedAgo, useHomeSetup, useHomesOverview, useHomeState, useHomesUi } from './useHomes'
import s from './Homes.module.css'

/*
 * The window's home is one chip at the end of its bar: in a home's window,
 * its name; in this computer's, a plug, including before the first connection.
 * Its menu, Computers, is every computer Althar works with: this computer and
 * each home to open, Connect a home…, Manage homes…; Add a worker… and Manage
 * workers…, in Settings › Computers, where the window can reach it; then Pair
 * a phone… for the window's home. A dropped connection shows in the
 * chip itself, with Reconnect beside it: the window stays as it was,
 * readable, and nothing covers it.
 */

const SHORTCUT = chord(keys.mod, keys.shift, 'H')

/** The menu's name, and the chip's in this computer's window. */
const MENU = 'Computers'

/** The home's workers, from the menu: adding one, and Settings › Computers, where they are. Where the window has none to reach, not offered. */
export interface MenuWorkers {
  readonly onAdd: () => void
  readonly onManage: () => void
  /** It has workers already, so there are some to manage. */
  readonly any: boolean
}

/** The menu of homes, from the chip. */
function HomesMenu({
  homes,
  here,
  overview,
  trigger,
  workers,
}: {
  homes: HomesHost
  here: HomeState
  overview: HomesOverview | null
  trigger: React.ReactElement
  workers?: MenuWorkers | undefined
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
      label={MENU}
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
            onSelect={() => void homes.reconnect().catch(() => undefined)}
          >
            Reconnect
          </MenuItem>
          <MenuSeparator />
        </>
      )}
      <MenuGroup label="Homes">
        <MenuItem lead={<Icon name="computer" />} hint={hint('local')} onSelect={() => void homes.open('local').catch(() => undefined)}>
          This computer
        </MenuItem>
        {listed.map((home) => (
          <MenuItem
            key={home.id}
            lead={<Icon name="home" />}
            hint={hint(home)}
            description={<span className={s.target}>{home.ssh?.target ?? home.https?.origin ?? ''}</span>}
            onSelect={() => void homes.open(home.id).catch(() => undefined)}
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
      {workers !== undefined && (
        <>
          <MenuSeparator />
          <MenuItem icon="plus" onSelect={workers.onAdd}>
            Add a worker…
          </MenuItem>
          {workers.any && (
            <MenuItem icon="worker" onSelect={workers.onManage}>
              Manage workers…
            </MenuItem>
          )}
        </>
      )}
      <MenuSeparator />
      <MenuItem icon="phone" onSelect={() => homesUi.set({ dialog: 'phones' })}>
        Pair a phone…
      </MenuItem>
    </Menu>
  )
}

/** At the bar's end: the home's name in its window; a plug in this computer's, including for its first connection. */
export function HomeButton() {
  const { host } = useServices()
  const navigate = useNavigate()
  const { menu } = useHomesUi()
  // Read while the menu is open, so Manage workers… is there where the home has some.
  const listed = useWorkers(menu)
  const computers = () => void navigate({ to: '/settings/$section', params: { section: 'computers' } })
  const workers: MenuWorkers = {
    onAdd: () => {
      homesUi.set({ addWorker: true })
      computers()
    },
    onManage: computers,
    any: (listed?.workers.length ?? 0) > 0,
  }
  return host.homes === undefined ? null : (
    <>
      <Chip homes={host.homes} workers={workers} />
      <PhonesFromMenu homes={host.homes} />
    </>
  )
}

/** Pair a phone…, opened from the menu: here, with the window's services, which the dialog reaches the home through. */
function PhonesFromMenu({ homes }: { homes: HomesHost }) {
  const here = useHomeState(homes)
  const { dialog } = useHomesUi()
  if (dialog !== 'phones' || here === null) return null
  return (
    <PhonesDialog
      home={here.current.kind === 'local' ? 'This Mac' : here.current.home.name}
      onClose={() => homesUi.set({ dialog: null })}
    />
  )
}

export function Chip({ homes, workers }: { homes: HomesHost; workers?: MenuWorkers | undefined }) {
  const here = useHomeState(homes)
  const overview = useHomesOverview(homes)
  const setup = useHomeSetup(homes)
  const { dialog } = useHomesUi()
  const drawn = here !== null
  useEffect(() => {
    if (!drawn) return
    homesUi.set({ chips: homesUi.get().chips + 1 })
    return () => homesUi.set({ chips: homesUi.get().chips - 1, menu: false })
  }, [drawn])
  if (here === null || !drawn) return null
  // A home being set up with its dialog closed: where it's got to, beside the chip, and a press brings it back.
  const setting =
    setup !== null && dialog !== 'connect' ? (
      <SetupChip setup={setup} onShow={() => homesUi.set({ dialog: 'connect', menu: false })} />
    ) : null
  if (here.current.kind === 'local')
    return (
      <span className={s.chipRow}>
        {setting}
        <HomesMenu
          homes={homes}
          here={here}
          overview={overview}
          workers={workers}
          trigger={<ChromeButton icon="plug" label={MENU} kbd={SHORTCUT} compact />}
        />
      </span>
    )
  const { home } = here.current
  const down = here.connection === 'disconnected'
  const connecting = here.connection === 'connecting'
  return (
    <span className={s.chipRow}>
      {setting}
      <HomesMenu
        homes={homes}
        here={here}
        overview={overview}
        workers={workers}
        trigger={
          <button
            type="button"
            className={s.chip}
            data-down={down || undefined}
            title={home.ssh?.target ?? home.https?.origin ?? ''}
            aria-label={`${home.name}, ${down ? 'disconnected' : connecting ? 'reconnecting' : home.https === undefined ? 'over SSH' : 'connected'}. ${MENU}`}
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
 * File › Computers… (⌘⇧H, Ctrl+Shift+H) opens the chip's menu where there is a
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
  if (dialog === 'connect')
    return <ConnectHome homes={host.homes} first={overview !== null && overview.homes.length === 0} onClose={close} />
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
