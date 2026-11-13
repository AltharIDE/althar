import { useEffect, useState } from 'react'

import { type AgentStatus, MOST_AT_ONCE } from '@althar/contracts'
import {
  AgentInstall,
  AgentsAtOnce,
  BrowserPreferences,
  type AgentTab,
  AgentTabList,
  AgentTabPanel,
  AgentTabs,
  AppVersion,
  Choices,
  CoAuthor,
  CoAuthorFace,
  CrashReports,
  DictationSettings,
  DockPreview,
  EdgeHere,
  EdgeMini,
  EdgePlaces,
  EdgeSpot,
  Icon,
  KeepAwake,
  LinkButton,
  SettingGroup,
  NotificationSettings,
  NotificationSound,
  type NotifyChoices,
  OpenFilesIn,
  ReviewSeal,
  ReviewSealGlyph,
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
import type { AccentSource, Appearance } from '../../../main/appPreferences'
import { SYSTEM_SOUND } from '../../../main/notify'
import { notesOf } from '../../../main/updates'
import { useServices } from '../../data/services'
import { agentLineOf, brandOf, pinnedOf } from '../../shared/agents'
import { systemAccentState } from '../../shared/accent'
import { appIcons } from '../../shared/appIcons'
import { device, platform } from '../../shared/device'
import { choosing, edgePlaces, edgeWords } from '../../shared/edge'
import { useEditorPictures, useEditorsRead } from '../../shared/OpenIn'
import { type PreferencesModel, usePreferences } from '../../shared/usePreferences'
import { useSounds } from '../../shared/useSounds'
import { useUpdate } from '../../shared/useUpdate'
import { useDesktopChrome } from '../../shared/useWindowChrome'
import { AgentAccounts } from '../accounts/AgentAccounts'
import { type AccountSignInModel, useAccountSignIn } from '../accounts/useAccountSignIn'
import { ConnectionsView } from '../connections/ConnectionsView'
import { type ConnectionsModel, useConnections } from '../connections/useConnections'
import { AgentProblem, openGuide, StartError } from '../start/StartView'
import type { StartModel } from '../start/useStart'
import { EXAMPLE, IslandPicture, MenuPicture, shownGlance } from './EdgePicture'
import { ModelsView } from './ModelsView'
import { QuickCards } from './QuickCards'
import { ChangedBy } from './ChangedBy'
import { GROUPS, type Section, sectionText } from './sections'
import s from './Settings.module.css'
import { text } from './text'
import { useDictationSettings } from './useDictationSettings'
import { useAgentsAtOnce } from './useAgentsAtOnce'
import { useAutomationsPaused } from './useAutomationsPaused'
import { type AppIconModel, useAppIcon } from './useAppIcon'
import { useCoAuthor } from './useCoAuthor'
import { useReviewSeal } from './useReviewSeal'
import { useEdgeGlance } from './useEdgeGlance'
import { TasksSection } from './TasksSection'
import { type EdgePlaceModel, useEdgePlace } from './useEdgePlace'
import { PresetsSection, presetsText } from './PresetsSection'
import { usePostTeamReviews } from './usePostTeamReviews'
import { type RunOutside, useRunOutside } from './useRunOutside'
import { useTaskFolders } from './useTaskFolders'
import { ServersSection, SkillsSection } from './ToolSections'

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
  /** Its account to sign in again, where one is meant: one whose sign-in ends soon. */
  account?: string
  /** An agent whose tab opens, nothing started: one that isn't installed, where its Install is. */
  agent?: string
}

export function SettingsPage({ start, section, onSection, onTask, signIn, account: meant, agent: shown }: SettingsPageProps) {
  const preferences = usePreferences()
  const sounds = useSounds()
  const connections = useConnections()
  // Here, and not in the agents' section, so a sign-in lasts from one section to another.
  const accounts = useAccountSignIn(start)
  // Here too, so a choice still being kept outlasts a look at another section; where Althar shows is asked again as its section opens.
  const looks: Looks = { appIcon: useAppIcon(), edge: useEdgePlace(section === 'appearance') }
  const agents = start.status?.agents ?? []
  // Asked to sign an agent in again: its tab opens with its signed-out account's sign-in started, which takes focus. Once.
  const [asked, setAsked] = useState(signIn ?? shown)
  if ((signIn ?? shown) !== undefined && (signIn ?? shown) !== asked) setAsked(signIn ?? shown)
  // Started once the agents are read again as the page opens: a read already under way would take a Terminal sign-in as done.
  const [openedAt] = useState(start.checkedAt)
  const wanted = start.checkedAt > openedAt ? agents.find((agent) => agent.id === signIn) : undefined
  useEffect(() => {
    if (wanted === undefined) return
    if (wanted.installed && wanted.problem === null) {
      // The account signed out, else one a provider within it refused (OpenCode Go), else its first.
      const account =
        wanted.accounts.find((one) => one.id === meant) ??
        wanted.accounts.find((one) => one.signIn === 'signed_out') ??
        wanted.accounts.find((one) => one.providers?.some((provider) => provider.refusedAt !== null) === true) ??
        wanted.accounts[0]
      if (account === undefined) accounts.add(wanted.id)
      else accounts.again(wanted.id, account.id)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- started once for the agent and account asked about, as it is read
  }, [wanted?.id, meant])
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
      <ChangedBy projectId={null} section={`althar/${section}`} />
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
    case 'mcp-servers':
      return <ServersSection start={start} />
    case 'skills':
      return <SkillsSection start={start} />
    case 'code-hosts':
      return <ConnectionsView model={connections} columns />
    case 'this-mac':
      return <ThisMacSection {...(onTask === undefined ? {} : { onTask })} />
    case 'tasks':
      return (
        <>
          <TasksSection />
          <SettingGroup title={presetsText.title} headingLevel={2}>
            <PresetsSection />
          </SettingGroup>
        </>
      )
    case 'pull-requests':
      return <ReviewsSection connections={connections} />
    case 'notifications':
      return <NotificationsSection />
    case 'appearance':
      return <AppearanceSection {...looks} />
    case 'editor-and-browser':
      return (
        <>
          <EditorSection />
          <SettingGroup title={text.pageBesideConversations} headingLevel={2}>
            <BrowserSection />
          </SettingGroup>
        </>
      )
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
    ...(agent.installed || agent.id === 'copilot-direct' ? {} : { away: true }),
  }
}

/** The agents, one at a time by their tabs: each one's accounts, and the models its work may use; or downloading one that isn't here. */
function AgentsSection({ start, accounts, asked }: { start: StartModel; accounts: AccountSignInModel; asked?: string }) {
  const [agentId, setAgentId] = useState<string | null>(null)
  // Looking for an agent again, after the person installed it themselves: the agents are read afresh, sign-ins too.
  const [checking, setChecking] = useState(false)
  const checkAgain = () => {
    setChecking(true)
    void start.recheck().finally(() => setChecking(false))
  }
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
        ) : chosen.id === 'copilot-direct' || (chosen.installed && chosen.download?.installing !== true) ? (
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
            onCheck={checkAgain}
            checking={checking}
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
      <SettingGroup title={text.dictation} headingLevel={2}>
        <DictationSection />
      </SettingGroup>
    </>
  )
}

/* ---- reviews and pull requests ---------------------------------------------------- */

const face = <img src={altharFace} alt="" />

function ReviewsSection({ connections }: { connections: ConnectionsModel }) {
  const postTeam = usePostTeamReviews()
  const runOutside = useRunOutside()
  const coAuthor = useCoAuthor()
  const seal = useReviewSeal()
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
        {runOutside !== null && (
          <SettingRow title={text.runOutsideTitle} note={text.runOutsideNote} glyph={<Icon name="lock" size={15} />}>
            {() => (
              <Segmented<RunOutside>
                label={text.runOutsideTitle}
                value={runOutside.to}
                onChange={runOutside.set}
                options={[
                  { value: 'ask', label: text.runOutsideAsk },
                  { value: 'safe', label: text.runOutsideSafe },
                  { value: 'full', label: text.runOutsideFull },
                ]}
              />
            )}
          </SettingRow>
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
      {seal !== null && (
        <>
          <SettingList>
            <SettingSwitch
              title={text.reviewSealTitle}
              note={text.reviewSealNote}
              mark={<ReviewSealGlyph facts={text.pullRequest.facts} />}
              checked={seal.on}
              onChange={seal.set}
            />
          </SettingList>
          <div className={s.coAuthor}>
            <ReviewSeal on={seal.on} style={seal.style} onStyle={seal.choose} sample={text.pullRequest} />
          </div>
        </>
      )}
      <Failed when={postTeam?.failed === true || runOutside?.failed === true || coAuthor?.failed === true || seal?.failed === true} />
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
  const { host } = useServices()
  const accent = systemAccentState(useDesktopChrome(host)?.accent)
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
        <SettingRow
          title={text.accent}
          {...(preferences.accent === 'system' && accent !== 'used'
            ? { note: accent === 'none' ? text.accentNone : text.accentIllegible }
            : {})}
          glyph={<Icon name="theme" size={15} />}
        >
          {() => (
            <Segmented<AccentSource>
              label={text.accent}
              value={preferences.accent}
              onChange={(source) => set('accent', source)}
              options={[
                { value: 'althar', label: text.accentAlthar },
                { value: 'system', label: text.accentSystem },
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
  const { editors, loading, looking, again } = useEditorsRead()
  const pictures = useEditorPictures()
  // Until they are read, none isn't known: nothing yet, not an empty state that gives way.
  if (loading) return null
  return (
    <>
      <OpenFilesIn
        onLookAgain={again}
        looking={looking}
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

/* ---- dictation -------------------------------------------------------------------- */

/** Which microphone dictation hears, whether the system lets it, and the speech model on disk, with Remove. */
function DictationSection() {
  const dictation = useDictationSettings()
  if (dictation.kind === 'none') return <p className={s.quiet}>{text.noDictation}</p>
  if (dictation.kind === 'loading') return null
  if (dictation.kind === 'unreadable')
    return (
      <p className={s.quiet}>
        {text.dictationUnreadable} <LinkButton onClick={dictation.retry}>{text.tryAgain}</LinkButton>
      </p>
    )
  return (
    <>
      <DictationSettings
        microphones={dictation.microphones}
        microphone={dictation.microphone}
        onMicrophone={dictation.choose}
        permission={dictation.permission}
        {...(dictation.openSettings === undefined ? {} : { onOpenSettings: dictation.openSettings })}
        model={dictation.model}
        onRemove={dictation.remove}
        removing={dictation.removing}
        text={dictation.text}
      />
      <Failed when={dictation.failed}>{text.removeFailed}</Failed>
    </>
  )
}

/* ---- the browser ------------------------------------------------------------------ */

/**
 * The pages beside conversations (ADR-100): where a thread's links open, how
 * long pages keep cookies, and clearing what every page kept, at once.
 */
function BrowserSection() {
  const { preferences, set, failed } = usePreferences()
  const pages = useServices().host.pages
  const [clearing, setClearing] = useState<'no' | 'clearing' | 'cleared'>('no')
  return (
    <>
      <BrowserPreferences
        links={preferences.browserLinks}
        onLinks={(links) => set('browserLinks', links)}
        keep={preferences.browserCookies}
        onKeep={(keep) => set('browserCookies', keep)}
        onClear={() => {
          if (pages === undefined) return
          setClearing('clearing')
          void pages.clearAll().then(
            () => setClearing('cleared'),
            () => setClearing('no'),
          )
        }}
        clearing={clearing === 'clearing'}
        cleared={clearing === 'cleared'}
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
