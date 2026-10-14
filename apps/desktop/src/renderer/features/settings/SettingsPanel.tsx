import { useEffect, useRef, useState } from 'react'

import { type AgentStatus, type ConnectionList, MOST_AT_ONCE } from '@althar/contracts'
import {
  type AgentGlance,
  AgentsAtOnce,
  type AgentTab,
  AgentInstall,
  AgentTabList,
  AgentTabPanel,
  AgentTabs,
  AppVersion,
  Choices,
  CoAuthor,
  type CoAuthorCommit,
  CoAuthorFace,
  ControlAgents,
  ControlCenter,
  ControlDetail,
  ControlFoot,
  ControlGrid,
  ControlLine,
  ControlLink,
  ControlMarks,
  ControlModule,
  ControlPicture,
  ControlSheet,
  ControlToggle,
  DockPreview,
  EdgeHere,
  EdgeMini,
  EdgePlaces,
  EdgeSpot,
  Icon,
  IconButton,
  KeepAwake,
  type MarkGlance,
  NotificationSettings,
  NotificationSound,
  type NotifyChoices,
  OpenFilesIn,
  SettingList,
  SettingSwitch,
  Switch,
  UpdateReady,
} from '@althar/ui'

import altharFace from '../../../../resources/faces/althar-ai.svg'
import { agentLineOf, brandOf } from '../../shared/agents'
import { appIcons } from '../../shared/appIcons'
import { SYSTEM_SOUND } from '../../../main/notify'
import { notesOf } from '../../../main/updates'
import { device, platform } from '../../shared/device'
import { choosing, edgePlaces, edgeWords } from '../../shared/edge'
import { useEditorList, useEditorPictures } from '../../shared/OpenIn'
import { useSounds } from '../../shared/useSounds'
import { type UpdateModel, useUpdate } from '../../shared/useUpdate'
import { type EdgeGlance, EXAMPLE, IslandPicture, MenuPicture, shownGlance } from './EdgePicture'
import { type PreferencesModel, usePreferences } from '../../shared/usePreferences'
import { productBrand, productName } from '../../shared/products'
import { clock } from '../../shared/time'
import { AgentAccounts } from '../accounts/AgentAccounts'
import { type AccountSignInModel, useAccountSignIn } from '../accounts/useAccountSignIn'
import { ConnectFlow, connectHead } from '../connections/ConnectFlow'
import { type Connecting, ConnectionsView, text as connectionsText } from '../connections/ConnectionsView'
import { type ConnectModel, useConnect } from '../connections/useConnect'
import { type ConnectionsModel, useConnections } from '../connections/useConnections'
import { StartError } from '../start/StartView'
import { ModelsView } from './ModelsView'
import type { StartModel } from '../start/useStart'
import s from './Settings.module.css'
import { type AppIconModel, useAppIcon } from './useAppIcon'
import { type EdgePlaceModel, useEdgePlace } from './useEdgePlace'
import { type CoAuthorModel, useCoAuthor } from './useCoAuthor'
import { type AgentsAtOnceModel, useAgentsAtOnce } from './useAgentsAtOnce'
import { type PostTeamReviewsModel, usePostTeamReviews } from './usePostTeamReviews'

/*
 * Settings, as a panel from the home's bar, over the home: the kit's Control
 * Center, each part as large as it matters. Round switches across the top,
 * for keeping the Mac awake while work runs and for notifications, each
 * opening out to the rest of its settings: on battery too, how many tasks
 * work at once on this Mac and why, and the editor files open in; and which
 * notifications, the Dock's count and a sound.
 * Under them the agents, large, each with a word on where it stands; the
 * code hosts and trackers, tall, by their marks, with what needs the person;
 * and, small, where Althar shows while you're in another app, on every
 * system, and the app's icon where there is a Dock. Althar as co-author is
 * the least of them: a quiet link in the foot, beside which Althar this is,
 * with its release notes, and a newer one ready to install. Any opens
 * out in place, as wide as it needs, and steps back to where it was.
 * Connecting a code host or tracker narrows the panel to a sign-in card, a
 * step at a time, and comes back to the list connected. It is calm: nothing
 * in it says what is running.
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
  edge: 'In other apps',
  edgeNote: 'Where Althar shows what needs you, while you work in another app.',
  edgeFailed: 'That couldn’t be kept. Try again.',
  coAuthor: 'Co-author',
  coAuthorTitle: 'Althar as co-author',
  coAuthorFailed: 'That couldn’t be kept. Try again.',
  /** Who the person is on the commit it is shown on, without a GitHub account connected. */
  you: 'you',
  /** A commit to show the co-author line on, as GitHub would. */
  commit: {
    subject: 'Retry the checkout call with backoff',
    body: 'Wraps the upstream call in a jittered retry, three tries at most,\nand only for 502, 503 and timeouts.',
    sha: '4e1c07a',
    when: 'committed 12 minutes ago',
  } satisfies CoAuthorCommit,
  version: (version: string) => `Althar ${version}`,
  backToList: 'Back to code hosts and trackers',
  awake: 'Keep awake',
  awakeOn: 'While work runs',
  off: 'Off',
  mac: device.This,
  notify: 'Notifications',
  silent: 'Silent',
  withSound: 'With sound',
  awakeTitle: `Keep ${device.this} awake while work runs`,
  awakeNote: `Work stops when ${device.the} sleeps. The display can still sleep.`,
  atOnceNote: (n: number, { count, memory, cores }: { count: number; memory: number; cores: number }) => {
    if (n === count) return `${n}: ${device.this} has ${memory} GB and ${cores} cores. More tasks than that wait their turn.`
    if (n === 1) return `1: one at a time. The calmest ${device.this} can be.`
    if (n < count) return `${n}: fewer than ${device.this} could carry.`
    if (n <= count + 2) return `${n}: a little more than ${device.this}’s ${memory} GB suggests. Tests may slow down.`
    return `${n}: well past what ${device.this}’s ${memory} GB suggests. Expect it to run hot.`
  },
  atOnceMark: ({ count }: { count: number }) => `${count} · ${device.this}`,
  postTeamTitle: 'Post reviews of my team’s pull requests without asking',
  postTeamNote: 'As soon as a review’s lead drafts one. A review of a pull request from outside the team always waits for you to post it.',
  loadTitle: `Show how hard ${device.this} works`,
  loadNote: 'CPU and memory in the bar, and how much of each Althar’s work uses.',
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

/** What the code hosts and trackers say under their marks: one that asks to be signed in again, else how many are connected. */
export const hostsLineOf = (list: ConnectionList): { readonly line: string; readonly tone?: 'yours' } | null => {
  const out = list.connections.filter((connection) => connection.state === 'reauth_required')
  const [first] = out
  if (first !== undefined)
    return { line: out.length === 1 ? text.signedOut(productName(first.product)) : text.signedOut(String(out.length)), tone: 'yours' }
  return list.connections.length === 0 ? null : { line: text.connected(list.connections.length) }
}

type Showing = 'all' | 'agents' | 'connections' | 'connect' | 'coauthor' | 'icon' | 'edge' | 'mac' | 'notify'

/** How wide the panel is for what is open in it: the agents, the code hosts, co-author and the edge need the room; a walk in is a card. 440 at rest. */
const WIDTHS: Partial<Record<Showing, number>> = { agents: 720, connections: 800, connect: 480, coauthor: 600, edge: 600 }

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
      edge={useEdgePlace(props.open)}
      coAuthor={useCoAuthor()}
      atOnce={useAgentsAtOnce()}
      postTeamReviews={usePostTeamReviews()}
      preferences={usePreferences()}
      editors={useEditorList()}
      pictures={useEditorPictures()}
      sounds={useSounds()}
      update={useUpdate()}
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
  atOnce,
  postTeamReviews = null,
  preferences: kept,
  editors,
  pictures,
  sounds,
  update,
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
  /** How many tasks work at once on this Mac, and why; null until the settings are read. */
  atOnce: AgentsAtOnceModel | null
  /** Whether a review of the team's pull request posts itself once drafted; null until the settings are read. */
  postTeamReviews?: PostTeamReviewsModel | null
  preferences: PreferencesModel
  editors: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** Each editor's icon by its id, as they come. */
  pictures: Readonly<Record<string, string>>
  sounds: { readonly list: ReadonlyArray<string>; readonly play: (sound: string) => void }
  /** A newer Althar ready to install; none where left out. */
  update?: UpdateModel
}) {
  const [showing, setShowing] = useState<Showing>('all')
  const [agentId, setAgentId] = useState<string | null>(null)
  // The walk in opened from the code hosts and trackers, and the one before it, so each starts afresh.
  const [connecting, setConnecting] = useState<Connecting | null>(null)
  const [walks, setWalks] = useState(0)
  const connect = (next: Connecting) => {
    setConnecting(next)
    setWalks((n) => n + 1)
    setShowing('connect')
  }
  const toList = () => {
    setShowing('connections')
    setConnecting(null)
  }
  const flow = useRef<ConnectModel | null>(null)
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
  const { spot } = edge
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

  const hosts = list === null ? null : hostsLineOf(list)
  // The person, on the commit co-author is shown on, as GitHub names them.
  const author = list?.connections.find((connection) => connection.product === 'github')?.account.login ?? text.you
  const face = <img src={altharFace} alt="" />
  const words = spot === null ? null : edgeWords(spot)

  return (
    <ControlCenter
      trigger={<IconButton icon="gear" label={text.title} kbd={text.kbd} size="small" />}
      open={open}
      onOpenChange={onOpenChange}
      width={WIDTHS[showing] ?? 440}
      // A sign-in finishing in the browser or Terminal, or a walk in to a code host, keeps it open when the person comes back to the window.
      holding={accounts.signingIn !== null || showing === 'connect'}
      onEscapeKeyDown={(event) => {
        // Escape steps back a step of a walk in, then out of an opened module, before it closes the panel.
        if (event.defaultPrevented || showing === 'all') return
        event.preventDefault()
        if (showing === 'connect') {
          if (flow.current?.back() !== true) toList()
          return
        }
        all()
      }}
      text={{ label: text.title }}
    >
      {showing === 'all' && (
        <>
          {/* Four columns, rows of 28px: a round switch is two rows, Agents and the code hosts six, a small square three. */}
          <ControlGrid row={28}>
            <ControlToggle
              title={text.awake}
              line={preferences.keepAwake ? text.awakeOn : text.off}
              on={preferences.keepAwake}
              onChange={(on) => set('keepAwake', on)}
              glyph={<Icon name="cup" size={16} />}
              onOpen={() => setShowing('mac')}
              place={{ column: [1, 3], row: [1, 3] }}
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
              place={{ column: [3, 5], row: [1, 3] }}
            />
            <ControlModule
              title={text.agents}
              {...(start.status === null ? {} : { aside: text.accounts(agents.reduce((n, agent) => n + agent.accounts.length, 0)) })}
              onClick={() => setShowing('agents')}
              place={{ column: [1, 3], row: [3, 9] }}
            >
              {start.status === null ? (
                <span className={s.waiting}>{text.connecting}</span>
              ) : (
                <ControlAgents agents={agents.map((agent) => agentGlanceOf(agent))} />
              )}
            </ControlModule>
            <ControlModule title={connectionsText.label} onClick={() => setShowing('connections')} place={{ column: [3, 4], row: [3, 9] }}>
              {list !== null && <ControlMarks marks={marksOf(list)} />}
              {hosts !== null && <ControlLine tone={hosts.tone}>{hosts.line}</ControlLine>}
            </ControlModule>
            {spot !== null && words !== null && (
              <ControlPicture
                title={text.edge}
                name={words.word}
                picture={<EdgeMini spot={spot} />}
                onClick={() => setShowing('edge')}
                // Above the icon where there is a Dock to show one in; the whole column where there isn't.
                place={{ column: [4, 5], row: icon === undefined ? [3, 9] : [3, 6] }}
              />
            )}
            {icon !== undefined && (
              <ControlPicture
                title={text.icon}
                name={icon.title}
                picture={<img src={icon.picture} alt="" />}
                onClick={() => setShowing('icon')}
                place={{ column: [4, 5], row: spot === null ? [3, 9] : [6, 9] }}
              />
            )}
          </ControlGrid>
          {failed}
          <ControlFoot>
            {start.status !== null && (
              <AppVersion version={start.status.appVersion} notes={notesOf(start.status.appVersion)} text={{ name: text.version }} />
            )}
            {update !== undefined && update.ready !== null && <UpdateReady {...update.ready} />}
            {coAuthor !== null && (
              <ControlLink
                title={text.coAuthor}
                picture={<CoAuthorFace picture={face} size={16} />}
                off={!coAuthor.on}
                onClick={() => setShowing('coauthor')}
              />
            )}
          </ControlFoot>
        </>
      )}
      {showing === 'agents' &&
        (chosen === undefined ? (
          <ControlDetail title={text.agents} onBack={all}>
            <StartError model={start} />
            <p className={s.quiet}>{text.connecting}</p>
          </ControlDetail>
        ) : (
          <AgentTabs value={chosen.id} onValueChange={setAgentId}>
            <ControlDetail
              title={text.agents}
              aside={counted}
              beside={<AgentTabList label={text.agents} agents={agents.map(tabOf)} />}
              onBack={all}
            >
              <StartError model={start} />
              <AgentTabPanel agent={tabOf(chosen)} aside={<ModelsView key={chosen.id} agent={chosen} />}>
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
              </AgentTabPanel>
            </ControlDetail>
          </AgentTabs>
        ))}
      {showing === 'connections' && (
        <ControlDetail
          title={connectionsText.label}
          {...(list === null || list.connections.length === 0 ? {} : { aside: text.connected(list.connections.length) })}
          onBack={all}
        >
          <ControlSheet>
            <ConnectionsView model={connections} columns onConnect={connect} />
          </ControlSheet>
        </ControlDetail>
      )}
      {showing === 'coauthor' && coAuthor !== null && (
        <ControlDetail
          title={text.coAuthorTitle}
          aside={<Switch checked={coAuthor.on} onChange={coAuthor.set} label={text.coAuthorTitle} />}
          onBack={all}
        >
          <ControlSheet className={s.coAuthor}>
            <CoAuthor
              on={coAuthor.on}
              onChange={coAuthor.set}
              trailer={coAuthor.line}
              author={author}
              commit={text.commit}
              picture={face}
            />
            {coAuthor.failed && (
              <p role="alert" className={s.failed}>
                {text.coAuthorFailed}
              </p>
            )}
          </ControlSheet>
        </ControlDetail>
      )}
      {showing === 'connect' && connecting !== null && (
        <Connect
          key={walks}
          connecting={connecting}
          onClose={toList}
          onModel={(model) => {
            flow.current = model
          }}
        />
      )}
      {showing === 'edge' && spot !== null && words !== null && (
        <ControlDetail title={text.edge} onBack={all}>
          <ControlSheet>
            {choosing(spot) && edge.place !== null ? (
              <>
                <p className={s.quiet}>{shownGlance(glance) === EXAMPLE ? text.examples : text.edgeNote}</p>
                <EdgePlaces
                  label={text.edge}
                  options={edgePlaces.map((one) => ({
                    value: one.value,
                    title: one.title,
                    note: one.note,
                    // Drawn small, so both fit beside each other.
                    picture:
                      one.value === 'island' ? (
                        <IslandPicture glance={shownGlance(glance)} height={260} />
                      ) : (
                        <MenuPicture glance={shownGlance(glance)} height={260} />
                      ),
                  }))}
                  value={edge.place}
                  onChange={edge.choose}
                />
              </>
            ) : (
              <>
                <p className={s.quiet}>{spot === EdgeSpot.MenuBar && shownGlance(glance) === EXAMPLE ? text.examples : text.edgeNote}</p>
                <EdgeHere
                  title={words.title}
                  note={words.note}
                  {...(words.why === undefined ? {} : { why: words.why })}
                  // A Mac's menu bar as it would be, the sheet open; elsewhere the system's edge, larger.
                  picture={spot === EdgeSpot.MenuBar ? <MenuPicture glance={shownGlance(glance)} /> : <EdgeMini spot={spot} scale={2.6} />}
                />
              </>
            )}
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
              {atOnce !== null && (
                <AgentsAtOnce
                  count={atOnce.atOnce.count}
                  own={atOnce.atOnce.own !== null}
                  machine={atOnce.atOnce.machine}
                  most={MOST_AT_ONCE}
                  onChange={atOnce.set}
                  text={{ note: text.atOnceNote, mark: text.atOnceMark }}
                />
              )}
              {postTeamReviews !== null && (
                <SettingSwitch
                  title={text.postTeamTitle}
                  note={text.postTeamNote}
                  glyph={<Icon name="pr" size={15} />}
                  checked={postTeamReviews.on}
                  onChange={postTeamReviews.set}
                />
              )}
              <SettingSwitch
                title={text.loadTitle}
                note={text.loadNote}
                glyph={<Icon name="load" size={15} />}
                checked={preferences.showLoad}
                onChange={(on) => set('showLoad', on)}
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
            {(atOnce?.failed === true || postTeamReviews?.failed === true) && (
              <p role="alert" className={s.failed}>
                {text.preferenceFailed}
              </p>
            )}
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

/** A walk in to a code host or tracker, opened out in the panel narrowed to a card: the service's own sub-page. */
function Connect({
  connecting,
  onClose,
  onModel,
}: {
  connecting: Connecting
  onClose: () => void
  /** The walk as it stands, for Escape to step it back. */
  onModel: (model: ConnectModel) => void
}) {
  const model = useConnect({ ...connecting, onClose })
  useEffect(() => onModel(model))
  const head = connectHead(model)
  return (
    <ControlDetail
      title={head.title}
      {...(head.aside === undefined ? {} : { aside: head.aside })}
      onBack={onClose}
      text={{ back: text.backToList }}
    >
      <ControlSheet>
        <ConnectFlow model={model} />
      </ControlSheet>
    </ControlDetail>
  )
}
