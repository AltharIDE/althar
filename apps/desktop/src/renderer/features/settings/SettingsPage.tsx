import { useEffect, useState } from 'react'

import { type AgentStatus, MOST_AT_ONCE } from '@althar/contracts'
import {
  AgentInstall,
  AgentsAtOnce,
  type AgentTab,
  AgentTabList,
  AgentTabPanel,
  AgentTabs,
  AppVersion,
  Choices,
  CoAuthor,
  CoAuthorFace,
  CrashReports,
  DockPreview,
  EdgeHere,
  EdgeMini,
  EdgePlaces,
  EdgeSpot,
  Icon,
  KeepAwake,
  LinkButton,
  NotificationSettings,
  NotificationSound,
  type NotifyChoices,
  OpenFilesIn,
  Segmented,
  SettingList,
  SettingRow,
  SettingsLayout,
  SettingsNav,
  SettingSwitch,
  TaskFolders,
  UpdateReady,
  UsageData,
} from '@althar/ui'

import altharFace from '../../../../resources/faces/althar-ai.svg'
import type { Appearance } from '../../../main/appPreferences'
import { SYSTEM_SOUND } from '../../../main/notify'
import { notesOf } from '../../../main/updates'
import { useServices } from '../../data/services'
import { agentLineOf, brandOf, pinnedOf } from '../../shared/agents'
import { appIcons } from '../../shared/appIcons'
import { device, platform } from '../../shared/device'
import { choosing, edgePlaces, edgeWords } from '../../shared/edge'
import { useEditorList, useEditorPictures } from '../../shared/OpenIn'
import { type PreferencesModel, usePreferences } from '../../shared/usePreferences'
import { useSounds } from '../../shared/useSounds'
import { useUpdate } from '../../shared/useUpdate'
import { AgentAccounts } from '../accounts/AgentAccounts'
import { type AccountSignInModel, useAccountSignIn } from '../accounts/useAccountSignIn'
import { ConnectionsView } from '../connections/ConnectionsView'
import { type ConnectionsModel, useConnections } from '../connections/useConnections'
import { AgentProblem, openGuide, StartError } from '../start/StartView'
import type { StartModel } from '../start/useStart'
import { EXAMPLE, IslandPicture, MenuPicture, shownGlance } from './EdgePicture'
import { ModelsView } from './ModelsView'
import { QuickCards } from './QuickCards'
import { GROUPS, type Section, sectionText } from './sections'
import s from './Settings.module.css'
import { text } from './text'
import { useAgentsAtOnce } from './useAgentsAtOnce'
import { useAutomationsPaused } from './useAutomationsPaused'
import { type AppIconModel, useAppIcon } from './useAppIcon'
import { useCoAuthor } from './useCoAuthor'
import { useEdgeGlance } from './useEdgeGlance'
import { type EdgePlaceModel, useEdgePlace } from './useEdgePlace'
import { usePostTeamReviews } from './usePostTeamReviews'
import { useTaskFolders } from './useTaskFolders'

/*
 * Althar's settings, as a tab of the window beside the home's. Down the
 * side, the quick settings' cards, what is changed most often, then every
 * section by what it is about; beside them, the section open, on a sheet of
 * its own with a line on what it is for. The agents are signed in here: a
 * sign-in under way lasts while the tab does, from one section to another,
 * and is left, as Cancel leaves it, when the tab closes or another has the
 * window. Each change goes out at once; one that can't be kept is said
 * where it was made, and what was kept comes back. Nothing here says what
 * is running: settings are calm.
 */

export interface SettingsPageProps {
  start: StartModel
  /** The section open, as the tab's address says it. */
  section: Section
  onSection: (section: Section) => void
  /** Opens a task, by its thread: one whose folder shows under Work on this computer. */
  onTask?: (threadId: string) => void
  /**
   * An agent to sign in again, by its id, as a signed-out agent's error asks:
   * its tab opens, with its sign-in started, once while the page shows.
   */
  signIn?: string
}

export function SettingsPage({ start, section, onSection, onTask, signIn }: SettingsPageProps) {
  const preferences = usePreferences()
  const sounds = useSounds()
  const connections = useConnections()
  // Here, and not in the agents' section, so a sign-in lasts from one section to another.
  const accounts = useAccountSignIn(start)
  // Here too, so a choice still being kept outlasts a look at another section; where Althar shows is asked again as its section opens.
  const looks: Looks = { appIcon: useAppIcon(), edge: useEdgePlace(section === 'appearance') }
  const agents = start.status?.agents ?? []
  // Asked to sign an agent in again: its tab opens with its signed-out account's sign-in started, which takes focus. Once.
  const [asked, setAsked] = useState(signIn)
  if (signIn !== undefined && signIn !== asked) setAsked(signIn)
  // Started once the agents are read again as the page opens: a read already under way would take a Terminal sign-in as done.
  const [openedAt] = useState(start.checkedAt)
  const wanted = start.checkedAt > openedAt ? agents.find((agent) => agent.id === signIn) : undefined
  useEffect(() => {
    if (wanted === undefined) return
    if (wanted.installed && wanted.problem === null) {
      const account = wanted.accounts.find((one) => one.signIn === 'signed_out') ?? wanted.accounts[0]
      if (account === undefined) accounts.add(wanted.id)
      else accounts.again(wanted.id, account.id)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- started once for the agent asked about, as it is read
  }, [wanted?.id])
  // A section where something waits on the person has a dot: an account to sign in again.
  const yours: Partial<Record<Section, boolean>> = {
    agents: agents.some((agent) => agent.accounts.some((account) => account.signIn === 'signed_out')),
    'code-hosts': connections.list?.connections.some((connection) => connection.state === 'reauth_required') === true,
  }
  const open = sectionText[section]
  return (
    <SettingsLayout
      section={section}
      title={open.title}
      side={
        <>
          <QuickCards side preferences={preferences} sounds={sounds.list} onSection={onSection} />
          <Failed when={preferences.failed} />
          <SettingsNav
            label={text.settings}
            groups={GROUPS.map((group) =>
              group.map((id) => ({
                id,
                title: sectionText[id].title,
                icon: sectionText[id].icon,
                ...(yours[id] === true ? { yours: true } : {}),
              })),
            )}
            value={section}
            onChange={onSection}
          />
        </>
      }
    >
      <SectionBody
        section={section}
        start={start}
        accounts={accounts}
        connections={connections}
        looks={looks}
        {...(asked === undefined ? {} : { asked })}
        {...(onTask === undefined ? {} : { onTask })}
      />
    </SettingsLayout>
  )
}

/** How Althar looks: its icon, and where it shows in another app. */
interface Looks {
  readonly appIcon: AppIconModel
  readonly edge: EdgePlaceModel
}

function SectionBody({
  section,
  start,
  accounts,
  connections,
  looks,
  asked,
  onTask,
}: {
  section: Section
  start: StartModel
  accounts: AccountSignInModel
  connections: ConnectionsModel
  looks: Looks
  /** The agent the person was sent here to sign in again. */
  asked?: string
  onTask?: (threadId: string) => void
}) {
  switch (section) {
    case 'agents':
      return <AgentsSection start={start} accounts={accounts} {...(asked === undefined ? {} : { asked })} />
    case 'code-hosts':
      return <ConnectionsView model={connections} columns />
    case 'this-mac':
      return <ThisMacSection {...(onTask === undefined ? {} : { onTask })} />
    case 'reviews':
      return <ReviewsSection connections={connections} />
    case 'notifications':
      return <NotificationsSection />
    case 'appearance':
      return <AppearanceSection {...looks} />
    case 'editor':
      return <EditorSection />
    case 'about':
      return <AboutSection start={start} />
  }
}

/** What couldn't be kept, said where it was made. */
function Failed({ when, children = text.failed }: { when: boolean; children?: string }) {
  if (!when) return null
  return (
    <p role="alert" className={s.failed}>
      {children}
    </p>
  )
}

/* ---- the agents ------------------------------------------------------------------- */

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
    // Not on this computer: its tab quieter, after those that are.
    ...(agent.installed ? {} : { away: true }),
  }
}

/** The agents, one at a time by their tabs: each one's accounts, and the models its work may use; or downloading one that isn't here. */
function AgentsSection({ start, accounts, asked }: { start: StartModel; accounts: AccountSignInModel; asked?: string }) {
  const [agentId, setAgentId] = useState<string | null>(null)
  // Those on this computer first, then the others Althar runs, each in the registry's order.
  const all = start.status?.agents ?? []
  const agents = [...all.filter((agent) => agent.installed), ...all.filter((agent) => !agent.installed)]
  // The agent chosen, else the one signing in, else the one the person was sent here for, else one that needs them, else the first.
  const chosen =
    agents.find((agent) => agent.id === agentId) ??
    agents.find((agent) => agent.id === accounts.signingIn?.agentId) ??
    agents.find((agent) => agent.id === asked) ??
    agents.find((agent) => agent.accounts.some((account) => account.signIn === 'signed_out')) ??
    agents[0]
  if (chosen === undefined)
    return (
      <>
        <StartError model={start} />
        <p className={s.quiet}>{text.connecting}</p>
      </>
    )
  const brand = brandOf(chosen.id)
  return (
    <AgentTabs value={chosen.id} onValueChange={setAgentId} className={s.agents}>
      <AgentTabList label={text.agents} agents={agents.map(tabOf)} text={{ away: `not on ${device.this}` }} />
      <StartError model={start} />
      {/* What its work may use, beside its accounts, once it is on this computer and can say. */}
      <AgentTabPanel
        agent={tabOf(chosen)}
        headingLevel={2}
        {...(chosen.installed ? { aside: <ModelsView key={chosen.id} agent={chosen} /> } : {})}
      >
        {chosen.problem !== null ? (
          <AgentProblem why={chosen.problem} model={start} />
        ) : chosen.installed && chosen.download?.installing !== true ? (
          <AgentAccounts agent={chosen} start={start} signIn={accounts} />
        ) : (
          <AgentInstall
            name={chosen.name}
            text={{ missing: text.agentHere }}
            {...(brand === undefined ? {} : { brand })}
            {...(chosen.download === null ? {} : { size: chosen.download.size })}
            {...(pinnedOf(chosen) === undefined ? {} : { pinned: pinnedOf(chosen) })}
            state={
              chosen.download?.installing === true
                ? { kind: 'installing' }
                : start.installFailed[chosen.id] === undefined
                  ? { kind: 'idle' }
                  : { kind: 'failed', why: start.installFailed[chosen.id] ?? '' }
            }
            onInstall={() => void start.install(chosen.id)}
            {...(chosen.guide === null ? {} : { onHelp: () => openGuide(start, chosen.id) })}
          />
        )}
      </AgentTabPanel>
    </AgentTabs>
  )
}

/* ---- work on this computer --------------------------------------------------------- */

/** The system lets Althar open at login: a Mac, and Windows. */
const opensAtLogin = platform === 'darwin' || platform === 'win32'

function ThisMacSection({ onTask }: { onTask?: (threadId: string) => void }) {
  const { preferences, set, failed } = usePreferences()
  const atOnce = useAgentsAtOnce()
  const paused = useAutomationsPaused()
  const folders = useTaskFolders(onTask)
  return (
    <>
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
            text={{ note: text.atOnceNote, mark: text.atOnceMark, value: text.atOnceValue }}
          />
        )}
        <SettingSwitch
          title={text.loadTitle}
          glyph={<Icon name="load" size={15} />}
          checked={preferences.showLoad}
          onChange={(on) => set('showLoad', on)}
        />
        {opensAtLogin && (
          <SettingSwitch
            title={text.atLoginTitle}
            note={text.atLoginNote}
            glyph={<Icon name="automation" size={15} />}
            checked={preferences.openAtLogin}
            onChange={(on) => set('openAtLogin', on)}
          />
        )}
        {paused !== null && (
          <SettingSwitch
            title={text.pauseAllTitle}
            note={text.pauseAllNote}
            glyph={<Icon name="hold" size={15} />}
            checked={paused.on}
            onChange={paused.set}
          />
        )}
        {/* When finished tasks' folders go, and what of this computer's disk they take (ADR-056). */}
        {folders !== null && (
          <TaskFolders
            wait={folders.wait}
            onWait={folders.setWait}
            disk={folders.disk}
            goes={folders.goes}
            held={folders.held}
            onCleanUp={folders.cleanUp}
            onRemove={folders.remove}
            {...(folders.open === undefined ? {} : { onOpen: folders.open })}
            measuring={folders.measuring}
            freed={folders.freed}
            busy={folders.busy}
            {...(folders.error === null ? {} : { error: folders.error })}
          />
        )}
      </SettingList>
      <Failed when={failed || atOnce?.failed === true || paused?.failed === true} />
    </>
  )
}

/* ---- reviews and pull requests ---------------------------------------------------- */

const face = <img src={altharFace} alt="" />

function ReviewsSection({ connections }: { connections: ConnectionsModel }) {
  const postTeam = usePostTeamReviews()
  const coAuthor = useCoAuthor()
  // The person, on the commit co-author is shown on, as GitHub names them.
  const author = connections.list?.connections.find((connection) => connection.product === 'github')?.account.login ?? text.you
  return (
    <>
      <SettingList>
        {postTeam !== null && (
          <SettingSwitch
            title={text.postTeamTitle}
            note={text.postTeamNote}
            glyph={<Icon name="pr" size={15} />}
            checked={postTeam.on}
            onChange={postTeam.set}
          />
        )}
        {coAuthor !== null && (
          <SettingSwitch
            title={text.coAuthorTitle}
            glyph={<CoAuthorFace picture={face} size={30} />}
            checked={coAuthor.on}
            onChange={coAuthor.set}
          />
        )}
      </SettingList>
      {coAuthor !== null && (
        <div className={s.coAuthor}>
          <CoAuthor on={coAuthor.on} onChange={coAuthor.set} trailer={coAuthor.line} author={author} commit={text.commit} picture={face} />
        </div>
      )}
      <Failed when={postTeam?.failed === true || coAuthor?.failed === true} />
    </>
  )
}

/* ---- notifications ---------------------------------------------------------------- */

/** The notification switches as the kit shows them, from the preferences as kept. */
const notifyChoicesOf = (preferences: PreferencesModel['preferences']): NotifyChoices => ({
  calls: preferences.notifyCalls,
  ready: preferences.notifyReady,
  stopped: preferences.notifyStopped,
  badge: preferences.badge,
})

const NOTIFY_KEYS = { calls: 'notifyCalls', ready: 'notifyReady', stopped: 'notifyStopped', badge: 'badge' } as const

function NotificationsSection() {
  const { preferences, set, failed } = usePreferences()
  const sounds = useSounds()
  return (
    <>
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
            onChange={(sound) => {
              // The one chosen is the one Sound's card puts back, after it silences them.
              if (sound !== null) set('lastSound', sound)
              set('sound', sound)
            }}
            onPlay={sounds.play}
          />
        )}
      </SettingList>
      <Failed when={failed} />
    </>
  )
}

/* ---- appearance ------------------------------------------------------------------- */

/** Where Althar shows while the person is in another app, as the screen would look; and the app's icon, in a Dock, where there is one. */
function AppearanceSection({ appIcon, edge }: Looks) {
  const glance = shownGlance(useEdgeGlance())
  const icon = appIcons.find((one) => one.value === appIcon.icon)
  const { spot } = edge
  const words = spot === null ? null : edgeWords(spot)
  const { preferences, set, failed } = usePreferences()
  return (
    <>
      <SettingList>
        <SettingRow title={text.theme} glyph={<Icon name="theme" size={15} />}>
          {() => (
            <Segmented<Appearance>
              label={text.theme}
              value={preferences.appearance}
              onChange={(appearance) => set('appearance', appearance)}
              options={[
                { value: 'light', label: text.themeLight },
                { value: 'dark', label: text.themeDark },
                { value: 'system', label: text.themeSystem },
              ]}
            />
          )}
        </SettingRow>
        {spot !== null && words !== null && (
          <SettingRow
            title={text.edge}
            note={glance === EXAMPLE ? text.examples : text.edgeNote}
            glyph={<Icon name="globe" size={15} />}
            under={
              <div className={s.under}>
                {choosing(spot) && edge.place !== null ? (
                  <EdgePlaces
                    label={text.edge}
                    options={edgePlaces.map((one) => ({
                      value: one.value,
                      title: one.title,
                      note: one.note,
                      picture:
                        one.value === 'island' ? (
                          <IslandPicture glance={glance} height={260} />
                        ) : (
                          <MenuPicture glance={glance} height={260} />
                        ),
                    }))}
                    value={edge.place}
                    onChange={edge.choose}
                  />
                ) : (
                  <EdgeHere
                    title={words.title}
                    note={words.note}
                    {...(words.why === undefined ? {} : { why: words.why })}
                    // A Mac's menu bar as it would be, the sheet open; elsewhere the system's edge, larger.
                    picture={spot === EdgeSpot.MenuBar ? <MenuPicture glance={glance} /> : <EdgeMini spot={spot} scale={2.6} />}
                  />
                )}
                <Failed when={edge.failed} />
              </div>
            }
          >
            {() => null}
          </SettingRow>
        )}
        {icon !== undefined && (
          <SettingRow
            title={text.icon}
            note={icon.title}
            glyph={<Icon name="image" size={15} />}
            under={
              <div className={s.under}>
                <DockPreview name={icon.title} picture={<img src={icon.picture} alt="" />} />
                <Choices
                  label={text.icon}
                  layout="tiles"
                  options={appIcons.map((one) => ({ value: one.value, title: one.title, picture: <img src={one.picture} alt="" /> }))}
                  value={appIcon.icon}
                  onChange={appIcon.choose}
                />
                <Failed when={appIcon.failed}>{text.iconFailed}</Failed>
              </div>
            }
          >
            {() => null}
          </SettingRow>
        )}
      </SettingList>
      <Failed when={failed} />
    </>
  )
}

/* ---- the editor ------------------------------------------------------------------- */

function EditorSection() {
  const { preferences, set, failed } = usePreferences()
  const editors = useEditorList()
  const pictures = useEditorPictures()
  if (editors.length === 0) return <p className={s.quiet}>{text.noEditors}</p>
  return (
    <>
      <OpenFilesIn
        editors={editors.map((editor) => ({
          value: editor.id,
          label: editor.name,
          ...(pictures[editor.id] === undefined ? {} : { picture: <img src={pictures[editor.id]} alt="" /> }),
        }))}
        value={editors.find((editor) => editor.id === preferences.editor)?.id ?? editors[0]?.id ?? null}
        onChange={(editor) => set('editor', editor)}
      />
      <Failed when={failed} />
    </>
  )
}

/* ---- about ------------------------------------------------------------------------ */

/**
 * Which Althar this is, with its release's notes; a newer one, once it is
 * ready to install; Report a problem (DEV-61), where the app can report;
 * and whether it sends anonymous usage data, and crash reports (DEV-66),
 * each with a switch of its own, both off, and staying off here, while
 * DO_NOT_TRACK is set where it started.
 */
function AboutSection({ start }: { start: StartModel }) {
  const update = useUpdate()
  const { preferences, set, failed } = usePreferences()
  const { host } = useServices()
  const version = start.status?.appVersion
  return (
    <>
      <div className={s.about}>
        {version !== undefined && <AppVersion version={version} notes={notesOf(version)} text={{ name: text.version }} />}
        {update.ready !== null && <UpdateReady {...update.ready} />}
        {host.reportProblem !== undefined && (
          <LinkButton onClick={() => host.reportProblem?.({ kind: 'asked', from: 'settings' })}>{text.report}</LinkButton>
        )}
      </div>
      <SettingList>
        <UsageData on={preferences.usageData} onChange={(on) => set('usageData', on)} doNotTrack={host.doNotTrack === true} />
        <CrashReports on={preferences.crashReports} onChange={(on) => set('crashReports', on)} doNotTrack={host.doNotTrack === true} />
      </SettingList>
      <Failed when={failed} />
    </>
  )
}
