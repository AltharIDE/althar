import { useEffect, useState } from 'react'

import type { AgentStatus, ConnectionList } from '@althar/contracts'
import {
  type AgentGlance,
  type AgentTab,
  AgentInstall,
  AgentTabs,
  Choices,
  CoAuthor,
  ControlAgents,
  ControlCenter,
  ControlDetail,
  ControlFoot,
  ControlGrid,
  ControlMarks,
  ControlModule,
  ControlPicture,
  ControlSheet,
  ControlToggle,
  DockPreview,
  Icon,
  IconButton,
  KeepAwake,
  type MarkGlance,
  EdgePlaces,
  NotificationSettings,
  NotificationSound,
  type NotifyChoices,
  OpenFilesIn,
  SettingList,
} from '@althar/ui'

import { agentLineOf, brandOf } from '../../shared/agents'
import { appIcons } from '../../shared/appIcons'
import { SYSTEM_SOUND } from '../../../main/notify'
import { device, platform } from '../../shared/device'
import { edgePlaces } from '../../shared/edge'
import { useEditorList, useEditorPictures } from '../../shared/OpenIn'
import { useSounds } from '../../shared/useSounds'
import { type EdgeGlance, EXAMPLE, IslandPicture, MenuPicture, shownGlance } from './EdgePicture'
import { type PreferencesModel, usePreferences } from '../../shared/usePreferences'
import { productBrand } from '../../shared/products'
import { clock } from '../../shared/time'
import { AgentAccounts } from '../accounts/AgentAccounts'
import { type AccountSignInModel, useAccountSignIn } from '../accounts/useAccountSignIn'
import { ConnectionsView, text as connectionsText } from '../connections/ConnectionsView'
import { type ConnectionsModel, useConnections } from '../connections/useConnections'
import { StartError } from '../start/StartView'
import { ModelsView } from './ModelsView'
import type { StartModel } from '../start/useStart'
import s from './Settings.module.css'
import { type AppIconModel, useAppIcon } from './useAppIcon'
import { type EdgePlaceModel, useEdgePlace } from './useEdgePlace'
import { type CoAuthorModel, useCoAuthor } from './useCoAuthor'

/*
 * Settings, as a panel from the home's bar, over the home: the kit's Control
 * Center. Round switches first, for keeping the Mac awake while work runs
 * and for notifications, each opening out to the rest of its settings: on
 * battery too and the editor files open in, and which notifications, the
 * Dock's count and a sound. Each module says at a glance where something stands: the agents on
 * this Mac and a word on each, the code hosts and trackers, the app's icon,
 * and, on a Mac with a notch, where Althar shows while you're in another app.
 * Any opens out in place, the agents one at a time with their accounts, and
 * steps back. It is calm: nothing in it says what is running.
 */

export const text = {
  title: 'Settings',
  kbd: '⌘,',
  agents: 'Agents',
  counted: (agents: number, accounts: number) =>
    `${agents === 1 ? '1 agent' : `${agents} agents`} · ${accounts === 1 ? '1 account' : `${accounts} accounts`}`,
  accounts: (n: number) => (n === 1 ? '1 account' : `${n} accounts`),
  signedOut: (account: string) => `${account} signed out`,
  notHere: `Not on ${device.this}`,
  downloading: 'Downloading…',
  out: (account: string, back: string) => `${account} out until ${back}`,
  connecting: `Looking at the agents on ${device.this}…`,
  connected: (n: number) => `${n} connected`,
  icon: 'App icon',
  iconFailed: 'That icon couldn’t be kept. Try again.',
  edge: 'While you’re in another app',
  edgeNote: 'Where Althar shows what needs you, while you work in another app.',
  edgeFailed: 'That couldn’t be kept. Try again.',
  coAuthorFailed: 'That couldn’t be kept. Try again.',
  version: (version: string) => `Althar ${version}`,
  awake: 'Keep awake',
  awakeOn: 'While work runs',
  off: 'Off',
  mac: device.This,
  notify: 'Notifications',
  silent: 'Silent',
  withSound: 'With sound',
  awakeTitle: `Keep ${device.this} awake while work runs`,
  awakeNote: `Work stops when ${device.the} sleeps. The display can still sleep.`,
  badge: `Count them on ${device.count ?? 'the icon'}`,
  soundNote:
    platform === 'darwin'
      ? 'One of this Mac’s alert sounds, with each notification.'
      : 'The system’s own sound, with each notification, or none.',
  agentHere: (name: string) => `${name} isn’t on ${device.this}`,
  examples: 'With nothing under way yet, here is how a busy moment would look.',
  notifyNote: 'Only while Althar isn’t in front. Never for progress.',
  preferenceFailed: 'That couldn’t be kept. Try again.',
}

/** The notification switches as the kit shows them, from the preferences as kept. */
const notifyChoicesOf = (preferences: PreferencesModel['preferences']): NotifyChoices => ({
  calls: preferences.notifyCalls,
  ready: preferences.notifyReady,
  stopped: preferences.notifyStopped,
  badge: preferences.badge,
})

const NOTIFY_KEYS = { calls: 'notifyCalls', ready: 'notifyReady', stopped: 'notifyStopped', badge: 'badge' } as const

/** An agent at a glance: an account only the person can sign in again, one resting until its usage is back, or how many it has. */
export const agentGlanceOf = (agent: AgentStatus, now: Date = new Date()): AgentGlance => {
  const brand = brandOf(agent.id)
  const base = { id: agent.id, name: agent.name, ...(brand === undefined ? {} : { brand }) }
  if (agent.download?.installing === true) return { ...base, line: text.downloading, tone: 'quiet' }
  if (!agent.installed) return { ...base, line: text.notHere, tone: 'quiet' }
  const signedOut = agent.accounts.find((account) => account.signIn === 'signed_out')
  if (signedOut !== undefined) return { ...base, line: text.signedOut(signedOut.name), tone: 'yours' }
  const [resting] = agent.accounts.flatMap((account) => (account.outUntil === null ? [] : [{ name: account.name, back: account.outUntil }]))
  if (resting !== undefined) return { ...base, line: text.out(resting.name, clock(resting.back, now)), tone: 'quiet' }
  return { ...base, line: text.accounts(agent.accounts.length) }
}

/** An agent as a tab: a dot on one with an account signed out. */
const tabOf = (agent: AgentStatus): AgentTab => {
  const brand = brandOf(agent.id)
  const line = agentLineOf(agent)
  return {
    id: agent.id,
    name: agent.name,
    ...(brand === undefined ? {} : { brand }),
    ...(line === undefined ? {} : { line }),
    ...(agent.accounts.some((account) => account.signIn === 'signed_out') ? { yours: true } : {}),
  }
}

/** The code hosts and trackers by their marks, one for a service's Cloud and own servers both: faint where none is connected, a dot where one asks to be signed in again. */
export const marksOf = (list: ConnectionList): ReadonlyArray<MarkGlance> => {
  const marks = new Map<string, MarkGlance>()
  for (const product of list.products) {
    const brand = productBrand(product.product)
    const connections = list.connections.filter((connection) => connection.product === product.product)
    const was = marks.get(brand)
    const faint = (was?.faint ?? true) && connections.length === 0
    const yours = (was?.yours ?? false) || connections.some((connection) => connection.state === 'reauth_required')
    marks.set(brand, { id: brand, name: product.name, brand, ...(faint ? { faint } : {}), ...(yours ? { yours } : {}) })
  }
  return [...marks.values()]
}

type Showing = 'all' | 'agents' | 'connections' | 'icon' | 'edge' | 'mac' | 'notify'

export interface SettingsPanelProps {
  start: StartModel
  /** Driven by the home, which opens it by ⌘, as well. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What waits and runs now, as the home has it, for the pictures of the edge of the screen. */
  glance?: EdgeGlance
}

/** Settings from the home's bar, with what it shows read here. */
export function SettingsPanel(props: SettingsPanelProps) {
  return (
    <SettingsView
      {...props}
      accounts={useAccountSignIn(props.start)}
      connections={useConnections()}
      appIcon={useAppIcon()}
      edge={useEdgePlace()}
      coAuthor={useCoAuthor()}
      preferences={usePreferences()}
      editors={useEditorList()}
      pictures={useEditorPictures()}
      sounds={useSounds()}
    />
  )
}

export function SettingsView({
  start,
  accounts,
  connections,
  appIcon,
  edge,
  coAuthor,
  preferences: kept,
  editors,
  pictures,
  sounds,
  glance,
  open,
  onOpenChange,
}: SettingsPanelProps & {
  accounts: AccountSignInModel
  connections: ConnectionsModel
  appIcon: AppIconModel
  edge: EdgePlaceModel
  /** Null until the settings are read. */
  coAuthor: CoAuthorModel | null
  preferences: PreferencesModel
  editors: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** Each editor's icon by its id, as they come. */
  pictures: Readonly<Record<string, string>>
  sounds: { readonly list: ReadonlyArray<string>; readonly play: (sound: string) => void }
}) {
  const [showing, setShowing] = useState<Showing>('all')
  const [agentId, setAgentId] = useState<string | null>(null)
  const agents = start.status?.agents ?? []
  // The agent chosen, else the one signing in, else one that needs the person, else the first.
  const chosen =
    agents.find((agent) => agent.id === agentId) ??
    agents.find((agent) => agent.id === accounts.signingIn?.agentId) ??
    agents.find((agent) => agent.accounts.some((account) => account.signIn === 'signed_out')) ??
    agents[0]
  const counted = text.counted(
    agents.length,
    agents.reduce((n, agent) => n + agent.accounts.length, 0),
  )
  const icon = appIcons.find((one) => one.value === appIcon.icon)
  // Only on a Mac whose screen has a notch is there anywhere to choose.
  const place = edgePlaces.find((one) => one.value === edge.place)
  const list = connections.list
  const all = () => setShowing('all')
  const { preferences, set } = kept
  const notifying = preferences.notifyCalls || preferences.notifyReady || preferences.notifyStopped
  // The round switch turns every kind of notification on or off together.
  const notifyAll = (on: boolean) => {
    set('notifyCalls', on)
    set('notifyReady', on)
    set('notifyStopped', on)
  }
  const failed = kept.failed && (
    <p role="alert" className={s.failed}>
      {text.preferenceFailed}
    </p>
  )

  // It opens on all the modules, or on the agents while an account is signing in.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setShowing(accounts.signingIn === null ? 'all' : 'agents')
  }
  // This is where agents are signed in, so each is asked again as it opens.
  const { recheck } = start
  useEffect(() => {
    if (open) void recheck()
  }, [open, recheck])

  return (
    <ControlCenter
      trigger={<IconButton icon="gear" label={text.title} kbd={text.kbd} size="small" />}
      open={open}
      onOpenChange={onOpenChange}
      wide={showing === 'agents' || showing === 'connections' || showing === 'edge'}
      // A sign-in finishing in the browser or Terminal keeps it open when the person comes back to the window.
      holding={accounts.signingIn !== null || connections.signingIn !== null}
      onEscapeKeyDown={(event) => {
        // Escape steps back out of an opened module before it closes the panel.
        if (event.defaultPrevented || showing === 'all') return
        event.preventDefault()
        all()
      }}
      text={{ label: text.title }}
    >
      {showing === 'all' && (
        <>
          <ControlGrid>
            <ControlToggle
              title={text.awake}
              line={preferences.keepAwake ? text.awakeOn : text.off}
              on={preferences.keepAwake}
              onChange={(on) => set('keepAwake', on)}
              glyph={<Icon name="cup" size={16} />}
              onOpen={() => setShowing('mac')}
            />
            <ControlToggle
              title={text.notify}
              line={
                notifying
                  ? preferences.sound === null
                    ? text.silent
                    : preferences.sound === SYSTEM_SOUND
                      ? text.withSound
                      : preferences.sound
                  : text.off
              }
              on={notifying}
              onChange={notifyAll}
              glyph={<Icon name="bell" size={16} />}
              onOpen={() => setShowing('notify')}
            />
            <ControlModule title={text.agents} aside={start.status === null ? undefined : counted} onClick={() => setShowing('agents')}>
              {start.status === null ? (
                <span className={s.quiet}>{text.connecting}</span>
              ) : (
                <ControlAgents agents={agents.map((agent) => agentGlanceOf(agent))} />
              )}
            </ControlModule>
            <ControlModule
              title={connectionsText.label}
              span={icon === undefined ? 4 : 2}
              {...(list === null || list.connections.length === 0 ? {} : { aside: text.connected(list.connections.length) })}
              onClick={() => setShowing('connections')}
            >
              {list !== null && <ControlMarks marks={marksOf(list)} />}
            </ControlModule>
            {icon !== undefined && (
              <ControlPicture
                title={text.icon}
                name={icon.title}
                picture={<img src={icon.picture} alt="" />}
                onClick={() => setShowing('icon')}
              />
            )}
            {place !== undefined && (
              <ControlModule title={text.edge} aside={place.title} onClick={() => setShowing('edge')}>
                <span className={s.quiet}>{place.note}</span>
              </ControlModule>
            )}
          </ControlGrid>
          {failed}
          {start.status !== null && (
            <ControlFoot>
              <span>{text.version(start.status.appVersion)}</span>
            </ControlFoot>
          )}
        </>
      )}
      {showing === 'agents' && (
        <ControlDetail title={text.agents} {...(start.status === null ? {} : { aside: counted })} onBack={all}>
          <StartError model={start} />
          {chosen === undefined ? (
            <p className={s.quiet}>{text.connecting}</p>
          ) : (
            <AgentTabs
              label={text.agents}
              agents={agents.map(tabOf)}
              value={chosen.id}
              onValueChange={setAgentId}
              aside={<ModelsView key={chosen.id} agent={chosen} />}
            >
              {chosen.installed && chosen.download?.installing !== true ? (
                <AgentAccounts agent={chosen} start={start} signIn={accounts} />
              ) : (
                <AgentInstall
                  name={chosen.name}
                  text={{ missing: text.agentHere }}
                  {...(brandOf(chosen.id) === undefined ? {} : { brand: brandOf(chosen.id) })}
                  {...(chosen.download === null ? {} : { size: chosen.download.size })}
                  state={
                    chosen.download?.installing === true
                      ? { kind: 'installing' }
                      : start.installFailed[chosen.id] === undefined
                        ? { kind: 'idle' }
                        : { kind: 'failed', why: start.installFailed[chosen.id] ?? '' }
                  }
                  onInstall={() => void start.install(chosen.id)}
                />
              )}
            </AgentTabs>
          )}
        </ControlDetail>
      )}
      {showing === 'connections' && (
        <ControlDetail title={connectionsText.label} onBack={all}>
          <ControlSheet>
            <ConnectionsView model={connections} columns />
          </ControlSheet>
          {coAuthor !== null && (
            <ControlSheet>
              <CoAuthor on={coAuthor.on} onChange={coAuthor.set} trailer={coAuthor.line} />
              {coAuthor.failed && (
                <p role="alert" className={s.failed}>
                  {text.coAuthorFailed}
                </p>
              )}
            </ControlSheet>
          )}
        </ControlDetail>
      )}
      {showing === 'edge' && edge.place !== null && (
        <ControlDetail title={text.edge} onBack={all}>
          <ControlSheet>
            <p className={s.quiet}>{shownGlance(glance) === EXAMPLE ? text.examples : text.edgeNote}</p>
            <EdgePlaces
              label={text.edge}
              options={edgePlaces.map((one) => ({
                value: one.value,
                title: one.title,
                note: one.note,
                picture:
                  one.value === 'island' ? <IslandPicture glance={shownGlance(glance)} /> : <MenuPicture glance={shownGlance(glance)} />,
              }))}
              value={edge.place}
              onChange={edge.choose}
            />
            {edge.failed && (
              <p role="alert" className={s.failed}>
                {text.edgeFailed}
              </p>
            )}
          </ControlSheet>
        </ControlDetail>
      )}
      {showing === 'mac' && (
        <ControlDetail title={text.mac} onBack={all}>
          <ControlSheet>
            <SettingList>
              <KeepAwake
                on={preferences.keepAwake}
                onChange={(on) => set('keepAwake', on)}
                onBattery={preferences.awakeOnBattery}
                onBatteryChange={(on) => set('awakeOnBattery', on)}
                text={{ title: text.awakeTitle, note: text.awakeNote }}
              />
              {editors.length > 0 && (
                <OpenFilesIn
                  editors={editors.map((editor) => ({
                    value: editor.id,
                    label: editor.name,
                    ...(pictures[editor.id] === undefined ? {} : { picture: <img src={pictures[editor.id]} alt="" /> }),
                  }))}
                  value={editors.find((editor) => editor.id === preferences.editor)?.id ?? editors[0]?.id ?? null}
                  onChange={(editor) => set('editor', editor)}
                />
              )}
            </SettingList>
            {failed}
          </ControlSheet>
        </ControlDetail>
      )}
      {showing === 'notify' && (
        <ControlDetail title={text.notify} onBack={all}>
          <ControlSheet>
            <p className={s.quiet}>{text.notifyNote}</p>
            <SettingList>
              <NotificationSettings
                value={notifyChoicesOf(preferences)}
                onChange={(key, on) => set(NOTIFY_KEYS[key], on)}
                count={device.count !== null}
                text={{ badge: text.badge }}
              />
              {/* A Mac offers its alert sounds by name; Windows and Linux, their own sound or none. */}
              {(sounds.list.length > 0 || platform !== 'darwin') && (
                <NotificationSound
                  sounds={sounds.list}
                  {...(platform === 'darwin' ? {} : { system: SYSTEM_SOUND })}
                  value={preferences.sound}
                  onChange={(sound) => set('sound', sound)}
                  onPlay={sounds.play}
                  text={{ note: text.soundNote }}
                />
              )}
            </SettingList>
            {failed}
          </ControlSheet>
        </ControlDetail>
      )}
      {showing === 'icon' && (
        <ControlDetail title={text.icon} onBack={all}>
          <ControlSheet>
            {icon !== undefined && <DockPreview name={icon.title} picture={<img src={icon.picture} alt="" />} />}
            <Choices
              label={text.icon}
              layout="tiles"
              options={appIcons.map((one) => ({ value: one.value, title: one.title, picture: <img src={one.picture} alt="" /> }))}
              value={appIcon.icon}
              onChange={appIcon.choose}
            />
            {appIcon.failed && (
              <p role="alert" className={s.failed}>
                {text.iconFailed}
              </p>
            )}
          </ControlSheet>
        </ControlDetail>
      )}
    </ControlCenter>
  )
}
