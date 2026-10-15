import { useState } from 'react'

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
  Panel,
  SettingList,
  SettingRow,
  SettingsNav,
  SettingSwitch,
  UpdateReady,
  UsageData,
} from '@althar/ui'

import altharFace from '../../../../resources/faces/althar-ai.svg'
import { SYSTEM_SOUND } from '../../../main/notify'
import { notesOf } from '../../../main/updates'
import { useServices } from '../../data/services'
import { agentLineOf, brandOf } from '../../shared/agents'
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
import { StartError } from '../start/StartView'
import type { StartModel } from '../start/useStart'
import { EXAMPLE, IslandPicture, MenuPicture, shownGlance } from './EdgePicture'
import { ModelsView } from './ModelsView'
import { QuickCards } from './QuickCards'
import { GROUPS, type Section, sectionText } from './sections'
import s from './Settings.module.css'
import { text } from './text'
import { useAgentsAtOnce } from './useAgentsAtOnce'
import { type AppIconModel, useAppIcon } from './useAppIcon'
import { useCoAuthor } from './useCoAuthor'
import { useEdgeGlance } from './useEdgeGlance'
import { type EdgePlaceModel, useEdgePlace } from './useEdgePlace'
import { usePostTeamReviews } from './usePostTeamReviews'

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
}

export function SettingsPage({ start, section, onSection }: SettingsPageProps) {
  const preferences = usePreferences()
  const sounds = useSounds()
  const connections = useConnections()
  // Here, and not in the agents' section, so a sign-in lasts from one section to another.
  const accounts = useAccountSignIn(start)
  // Here too, so a choice still being kept outlasts a look at another section; where Althar shows is asked again as its section opens.
  const looks: Looks = { appIcon: useAppIcon(), edge: useEdgePlace(section === 'appearance') }
  const agents = start.status?.agents ?? []
  // A section where something waits on the person has a dot: an account to sign in again.
  const yours: Partial<Record<Section, boolean>> = {
    agents: agents.some((agent) => agent.accounts.some((account) => account.signIn === 'signed_out')),
    'code-hosts': connections.list?.connections.some((connection) => connection.state === 'reauth_required') === true,
  }
  const open = sectionText[section]
  return (
    <div className={s.page}>
      <div className={s.columns}>
        <aside className={s.side}>
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
        </aside>
        <main className={s.main}>
          {/* Another section is a sheet of its own: nothing half done in one carries over to the next. */}
          <Panel key={section} title={open.title} lede={open.lede} headingLevel={1}>
            <div className={s.body}>
              <SectionBody section={section} start={start} accounts={accounts} connections={connections} looks={looks} />
            </div>
          </Panel>
        </main>
      </div>
    </div>
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
}: {
  section: Section
  start: StartModel
  accounts: AccountSignInModel
  connections: ConnectionsModel
  looks: Looks
}) {
  switch (section) {
    case 'agents':
      return <AgentsSection start={start} accounts={accounts} />
    case 'code-hosts':
      return <ConnectionsView model={connections} columns />
    case 'this-mac':
      return <ThisMacSection />
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
  }
}

/** The agents, one at a time by their tabs: each one's accounts, and the models its work may use; or downloading one that isn't here. */
function AgentsSection({ start, accounts }: { start: StartModel; accounts: AccountSignInModel }) {
  const [agentId, setAgentId] = useState<string | null>(null)
  const agents = start.status?.agents ?? []
  // The agent chosen, else the one signing in, else one that needs the person, else the first.
  const chosen =
    agents.find((agent) => agent.id === agentId) ??
    agents.find((agent) => agent.id === accounts.signingIn?.agentId) ??
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
      <AgentTabList label={text.agents} agents={agents.map(tabOf)} />
      <StartError model={start} />
      <AgentTabPanel agent={tabOf(chosen)} headingLevel={2} aside={<ModelsView key={chosen.id} agent={chosen} />}>
        {chosen.installed && chosen.download?.installing !== true ? (
          <AgentAccounts agent={chosen} start={start} signIn={accounts} />
        ) : (
          <AgentInstall
            name={chosen.name}
            text={{ missing: text.agentHere }}
            {...(brand === undefined ? {} : { brand })}
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
    </AgentTabs>
  )
}

/* ---- work on this computer --------------------------------------------------------- */

function ThisMacSection() {
  const { preferences, set, failed } = usePreferences()
  const atOnce = useAgentsAtOnce()
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
          note={text.loadNote}
          glyph={<Icon name="load" size={15} />}
          checked={preferences.showLoad}
          onChange={(on) => set('showLoad', on)}
        />
      </SettingList>
      <Failed when={failed || atOnce?.failed === true} />
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
            note={text.coAuthorNote}
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
            text={{ note: text.soundNote }}
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
  return (
    <SettingList>
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
 * and whether it sends anonymous usage data, which is off, and stays off
 * here, while DO_NOT_TRACK is set where it started.
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
      </SettingList>
      <Failed when={failed} />
    </>
  )
}
