// Scrappy: every app setting, grouped by what it is about, each drawn by the app's own components; and finding one by name.
import { Fragment, type ReactNode, useState } from 'react'

import { MOST_AT_ONCE } from '../../../../contracts/src/index'
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
  ControlGrid,
  ControlToggle,
  DockPreview,
  EdgeHere,
  EdgeMini,
  EdgePlaces,
  EdgeSpot,
  Icon,
  type IconName,
  KeepAwake,
  LinkButton,
  NotificationSound,
  notificationSettingsText,
  OpenFilesIn,
  ProjectInk,
  ProjectMark,
  SettingList,
  SettingRow,
  SettingSwitch,
  UpdateReady,
} from '../../index'
import type { AgentStatus } from './deps'
import type { Models } from './models'

import altharFace from '../../../../../apps/desktop/resources/faces/althar-ai.svg'
import { SYSTEM_SOUND } from '../../../../../apps/desktop/src/main/notify'
import { notesOf } from '../../../../../apps/desktop/src/main/updates'
import { AgentAccounts } from '../../../../../apps/desktop/src/renderer/features/accounts/AgentAccounts'
import { ConnectionsView } from '../../../../../apps/desktop/src/renderer/features/connections/ConnectionsView'
import { EXAMPLE, IslandPicture, MenuPicture, shownGlance } from '../../../../../apps/desktop/src/renderer/features/settings/EdgePicture'
import { ModelsView } from '../../../../../apps/desktop/src/renderer/features/settings/ModelsView'
import s from '../../../../../apps/desktop/src/renderer/features/settings/Settings.module.css'
import { text } from '../../../../../apps/desktop/src/renderer/features/settings/SettingsPanel'
import { StartError } from '../../../../../apps/desktop/src/renderer/features/start/StartView'
import { agentLineOf, brandOf } from '../../../../../apps/desktop/src/renderer/shared/agents'
import { appIcons } from '../../../../../apps/desktop/src/renderer/shared/appIcons'
import { device, platform } from '../../../../../apps/desktop/src/renderer/shared/device'
import { choosing, edgePlaces, edgeWords } from '../../../../../apps/desktop/src/renderer/shared/edge'

/* ——— The sections ——— */

export type SectionId = 'agents' | 'hosts' | 'mac' | 'reviews' | 'notify' | 'look' | 'editor' | 'about'

export interface Section {
  readonly id: SectionId
  readonly title: string
  /** As a tab, where there is little room. */
  readonly short: string
  readonly icon: IconName
  readonly lede: string
  /** Where it sits in a list of them: the accounts Althar works with, Althar's own ways, or about it. */
  readonly group: 'accounts' | 'althar' | 'about'
}

export const SECTIONS: ReadonlyArray<Section> = [
  {
    id: 'agents',
    title: 'Agents',
    short: 'Agents',
    icon: 'agents',
    group: 'accounts',
    lede: 'The agents on this Mac, the accounts each signs in with, and the model new work starts on.',
  },
  {
    id: 'hosts',
    title: 'Code hosts and trackers',
    short: 'Code hosts',
    icon: 'plug',
    group: 'accounts',
    lede: 'Where your code and issues are. Connected once, for every project.',
  },
  {
    id: 'mac',
    title: 'Work on this Mac',
    short: 'This Mac',
    icon: 'load',
    group: 'althar',
    lede: 'How much work this Mac takes on at once, and keeping it awake while it does.',
  },
  {
    id: 'reviews',
    title: 'Reviews and pull requests',
    short: 'Reviews',
    icon: 'pr',
    group: 'althar',
    lede: 'What Althar does with pull requests without asking you, and how it signs its work.',
  },
  { id: 'notify', title: 'Notifications', short: 'Notifications', icon: 'bell', group: 'althar', lede: text.notifyNote },
  {
    id: 'look',
    title: 'Appearance',
    short: 'Appearance',
    icon: 'image',
    group: 'althar',
    lede: 'The app’s icon, and where Althar shows while you work in another app.',
  },
  { id: 'editor', title: 'Editor', short: 'Editor', icon: 'file', group: 'althar', lede: 'Where a task’s files and folder open.' },
  {
    id: 'about',
    title: 'About Althar',
    short: 'About',
    icon: 'down',
    group: 'about',
    lede: 'Which Althar this is, and a newer one once it’s ready.',
  },
]

export const sectionOf = (id: SectionId): Section => SECTIONS.find((one) => one.id === id) ?? (SECTIONS[0] as Section)

/* ——— The quick switches: keep awake and notifications, one press each ——— */

const notifyingOf = (m: Models) => {
  const { preferences } = m.preferences
  return preferences.notifyCalls || preferences.notifyReady || preferences.notifyStopped
}

export const notifyAll = (m: Models, on: boolean) => {
  m.preferences.set('notifyCalls', on)
  m.preferences.set('notifyReady', on)
  m.preferences.set('notifyStopped', on)
}

const notifyLine = (m: Models) => {
  const { preferences } = m.preferences
  if (!notifyingOf(m)) return text.off
  if (preferences.sound === null) return text.silent
  return preferences.sound === SYSTEM_SOUND ? text.withSound : preferences.sound
}

/** The two round switches, side by side, or one over the other where it is narrow. Their names open their sections. */
export function QuickToggles({ m, onOpen, stacked = false }: { m: Models; onOpen?: (id: SectionId) => void; stacked?: boolean }) {
  const { preferences, set } = m.preferences
  const notifying = notifyingOf(m)
  return (
    <ControlGrid row={28} columns={stacked ? 2 : 4}>
      <ControlToggle
        title={text.awake}
        line={preferences.keepAwake ? text.awakeOn : text.off}
        on={preferences.keepAwake}
        onChange={(on) => set('keepAwake', on)}
        glyph={<Icon name="cup" size={16} />}
        {...(onOpen === undefined ? {} : { onOpen: () => onOpen('mac') })}
        place={{ column: [1, 3], row: [1, 3] }}
      />
      <ControlToggle
        title={text.notify}
        line={notifyLine(m)}
        on={notifying}
        onChange={(on) => notifyAll(m, on)}
        glyph={<Icon name="bell" size={16} />}
        {...(onOpen === undefined ? {} : { onOpen: () => onOpen('notify') })}
        place={stacked ? { column: [1, 3], row: [3, 5] } : { column: [3, 5], row: [1, 3] }}
      />
    </ControlGrid>
  )
}

/* ——— Each setting, as one row, so a section and a search draw the same ——— */

export type RowId = 'keepAwake' | 'atOnce' | 'load' | 'postTeam' | 'coAuthor' | 'calls' | 'ready' | 'stopped' | 'badge' | 'sound' | 'editor'

const NOTIFY = { calls: 'notifyCalls', ready: 'notifyReady', stopped: 'notifyStopped', badge: 'badge' } as const

const face = <img src={altharFace} alt="" />

export const ROWS: Readonly<Record<RowId, (m: Models) => ReactNode>> = {
  keepAwake: ({ preferences: { preferences, set } }) => (
    <KeepAwake
      key="keepAwake"
      on={preferences.keepAwake}
      onChange={(on) => set('keepAwake', on)}
      onBattery={preferences.awakeOnBattery}
      onBatteryChange={(on) => set('awakeOnBattery', on)}
      text={{ title: text.awakeTitle, note: text.awakeNote }}
    />
  ),
  atOnce: ({ atOnce }) =>
    atOnce !== null && (
      <AgentsAtOnce
        key="atOnce"
        count={atOnce.atOnce.count}
        own={atOnce.atOnce.own !== null}
        machine={atOnce.atOnce.machine}
        most={MOST_AT_ONCE}
        onChange={atOnce.set}
        text={{ note: text.atOnceNote, mark: text.atOnceMark }}
      />
    ),
  load: ({ preferences: { preferences, set } }) => (
    <SettingSwitch
      key="load"
      title={text.loadTitle}
      note={text.loadNote}
      glyph={<Icon name="load" size={15} />}
      checked={preferences.showLoad}
      onChange={(on) => set('showLoad', on)}
    />
  ),
  postTeam: ({ postTeamReviews }) =>
    postTeamReviews !== null && (
      <SettingSwitch
        key="postTeam"
        title={text.postTeamTitle}
        note={text.postTeamNote}
        glyph={<Icon name="pr" size={15} />}
        checked={postTeamReviews.on}
        onChange={postTeamReviews.set}
      />
    ),
  coAuthor: ({ coAuthor }) =>
    coAuthor !== null && (
      <SettingSwitch
        key="coAuthor"
        title={text.coAuthorTitle}
        note="A Co-authored-by line on the commits and pull requests Althar sends, so the code host shows its face beside yours."
        glyph={<Icon name="branch" size={15} />}
        checked={coAuthor.on}
        onChange={coAuthor.set}
      />
    ),
  calls: (m) => notifyRow(m, 'calls', notificationSettingsText.calls, notificationSettingsText.callsNote),
  ready: (m) => notifyRow(m, 'ready', notificationSettingsText.ready),
  stopped: (m) => notifyRow(m, 'stopped', notificationSettingsText.stopped),
  badge: (m) => device.count !== null && notifyRow(m, 'badge', text.badge),
  sound: ({ sounds, preferences: { preferences, set } }) =>
    (sounds.list.length > 0 || platform !== 'darwin') && (
      <NotificationSound
        key="sound"
        sounds={sounds.list}
        {...(platform === 'darwin' ? {} : { system: SYSTEM_SOUND })}
        value={preferences.sound}
        onChange={(sound) => set('sound', sound)}
        onPlay={sounds.play}
        text={{ note: text.soundNote }}
      />
    ),
  editor: ({ editors, pictures, preferences: { preferences, set } }) =>
    editors.length > 0 && (
      <OpenFilesIn
        key="editor"
        editors={editors.map((editor) => ({
          value: editor.id,
          label: editor.name,
          ...(pictures[editor.id] === undefined ? {} : { picture: <img src={pictures[editor.id]} alt="" /> }),
        }))}
        value={editors.find((editor) => editor.id === preferences.editor)?.id ?? editors[0]?.id ?? null}
        onChange={(editor) => set('editor', editor)}
      />
    ),
}

function notifyRow(m: Models, key: keyof typeof NOTIFY, title: string, note?: string) {
  const { preferences, set } = m.preferences
  return <SettingSwitch key={key} title={title} note={note} checked={preferences[NOTIFY[key]]} onChange={(on) => set(NOTIFY[key], on)} />
}

/** Flips a row that is on or off; nothing for one that isn't. */
export const FLIPS: Partial<Readonly<Record<RowId, (m: Models) => void>>> = {
  keepAwake: (m) => m.preferences.set('keepAwake', !m.preferences.preferences.keepAwake),
  load: (m) => m.preferences.set('showLoad', !m.preferences.preferences.showLoad),
  postTeam: (m) => m.postTeamReviews?.set(!m.postTeamReviews.on),
  coAuthor: (m) => m.coAuthor?.set(!m.coAuthor.on),
  calls: (m) => m.preferences.set('notifyCalls', !m.preferences.preferences.notifyCalls),
  ready: (m) => m.preferences.set('notifyReady', !m.preferences.preferences.notifyReady),
  stopped: (m) => m.preferences.set('notifyStopped', !m.preferences.preferences.notifyStopped),
  badge: (m) => m.preferences.set('badge', !m.preferences.preferences.badge),
}

/* ——— What each section holds ——— */

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

/** The agents, one at a time by their tabs: each one's accounts, and the model its new work starts on. */
export function AgentsBody({ m, agent: first = null, tabs }: { m: Models; agent?: string | null; tabs?: (list: ReactNode) => ReactNode }) {
  const [agentId, setAgentId] = useState<string | null>(first)
  const { start, accounts } = m
  const agents = start.status?.agents ?? []
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
  const list = <AgentTabList label={text.agents} agents={agents.map(tabOf)} />
  return (
    <AgentTabs value={chosen.id} onValueChange={setAgentId}>
      {tabs === undefined ? <div style={{ display: 'flex', marginBottom: 12 }}>{list}</div> : tabs(list)}
      <StartError model={start} />
      <AgentTabPanel agent={tabOf(chosen)} aside={<ModelsView key={chosen.id} agent={chosen} />}>
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

/** The code hosts and trackers, and connecting one, a step at a time, in their place. */
export function HostsBody({ m, columns = true }: { m: Models; columns?: boolean }) {
  return <ConnectionsView model={m.connections} columns={columns} />
}

const failed = (m: Models, also = false) =>
  (m.preferences.failed || also) && (
    <p role="alert" className={s.failed}>
      {text.preferenceFailed}
    </p>
  )

export function MacBody({ m }: { m: Models }) {
  return (
    <>
      <SettingList>
        {ROWS.keepAwake(m)}
        {ROWS.atOnce(m)}
        {ROWS.load(m)}
      </SettingList>
      {failed(m, m.atOnce?.failed === true)}
    </>
  )
}

export function ReviewsBody({ m, commit = true }: { m: Models; commit?: boolean }) {
  const author = m.connections.list?.connections.find((one) => one.product === 'github')?.account.login ?? text.you
  return (
    <>
      <SettingList>
        {ROWS.postTeam(m)}
        {ROWS.coAuthor(m)}
      </SettingList>
      {commit && m.coAuthor !== null && (
        <CoAuthor
          on={m.coAuthor.on}
          onChange={m.coAuthor.set}
          trailer={m.coAuthor.line}
          author={author}
          commit={text.commit}
          picture={face}
        />
      )}
      {failed(m, m.postTeamReviews?.failed === true || m.coAuthor?.failed === true)}
    </>
  )
}

export function NotifyBody({ m, note = false }: { m: Models; note?: boolean }) {
  return (
    <>
      {note && <p className={s.quiet}>{text.notifyNote}</p>}
      <SettingList>
        {ROWS.calls(m)}
        {ROWS.ready(m)}
        {ROWS.stopped(m)}
        {ROWS.badge(m)}
        {ROWS.sound(m)}
      </SettingList>
      {failed(m)}
    </>
  )
}

/** The app's icon, in a Dock; and where Althar shows while you are in another app. */
export function LookBody({ m, small = false }: { m: Models; small?: boolean }) {
  const icon = appIcons.find((one) => one.value === m.appIcon.icon)
  const { spot } = m.edge
  const words = spot === null ? null : edgeWords(spot)
  const glance = shownGlance(m.glance)
  return (
    <SettingList>
      <SettingRow
        title={text.icon}
        {...(icon === undefined ? {} : { note: icon.title })}
        glyph={<Icon name="image" size={15} />}
        under={
          <div style={{ display: 'grid', gap: 12 }}>
            {icon !== undefined && <DockPreview name={icon.title} picture={<img src={icon.picture} alt="" />} size={small ? 40 : 52} />}
            <Choices
              label={text.icon}
              layout="tiles"
              options={appIcons.map((one) => ({ value: one.value, title: one.title, picture: <img src={one.picture} alt="" /> }))}
              value={m.appIcon.icon}
              onChange={m.appIcon.choose}
            />
            {m.appIcon.failed && (
              <p role="alert" className={s.failed}>
                {text.iconFailed}
              </p>
            )}
          </div>
        }
      >
        {() => null}
      </SettingRow>
      {spot !== null && words !== null && (
        <SettingRow
          title={text.edge}
          note={glance === EXAMPLE ? text.examples : text.edgeNote}
          glyph={<Icon name="globe" size={15} />}
          under={
            choosing(spot) && m.edge.place !== null ? (
              <EdgePlaces
                label={text.edge}
                options={edgePlaces.map((one) => ({
                  value: one.value,
                  title: one.title,
                  note: one.note,
                  picture:
                    one.value === 'island' ? (
                      <IslandPicture glance={glance} height={small ? 200 : 260} />
                    ) : (
                      <MenuPicture glance={glance} height={small ? 200 : 260} />
                    ),
                }))}
                value={m.edge.place}
                onChange={m.edge.choose}
              />
            ) : (
              <EdgeHere
                title={words.title}
                note={words.note}
                {...(words.why === undefined ? {} : { why: words.why })}
                picture={spot === EdgeSpot.MenuBar ? <MenuPicture glance={glance} /> : <EdgeMini spot={spot} scale={2.6} />}
              />
            )
          }
        >
          {() => null}
        </SettingRow>
      )}
    </SettingList>
  )
}

export function EditorBody({ m }: { m: Models }) {
  return <SettingList>{ROWS.editor(m)}</SettingList>
}

export function AboutBody({ m }: { m: Models }) {
  const version = m.start.status?.appVersion
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, padding: '12px 0' }}>
      {version !== undefined && <AppVersion version={version} notes={notesOf(version)} text={{ name: text.version }} />}
      {m.update.ready !== null && <UpdateReady {...m.update.ready} />}
    </div>
  )
}

/** What a section holds, drawn for where it is: `wide` on a page or window, narrower in a panel. */
export function SectionBody({ id, m, wide = true }: { id: SectionId; m: Models; wide?: boolean }) {
  switch (id) {
    case 'agents':
      return <AgentsBody m={m} />
    case 'hosts':
      return <HostsBody m={m} columns={wide} />
    case 'mac':
      return <MacBody m={m} />
    case 'reviews':
      return <ReviewsBody m={m} />
    case 'notify':
      return <NotifyBody m={m} />
    case 'look':
      return <LookBody m={m} small={!wide} />
    case 'editor':
      return <EditorBody m={m} />
    case 'about':
      return <AboutBody m={m} />
  }
}

/* ——— Finding a setting by name ——— */

export interface Entry {
  readonly key: string
  readonly section: SectionId
  readonly title: string
  /** Other words it might be looked for by. */
  readonly words: ReadonlyArray<string>
  /** Drawn in place where it is small enough; otherwise it opens its section. */
  readonly row?: RowId
}

export const ENTRIES: ReadonlyArray<Entry> = [
  { key: 'agents', section: 'agents', title: 'Agents', words: ['agent', 'claude code', 'codex', 'opencode', 'install', 'download'] },
  {
    key: 'accounts',
    section: 'agents',
    title: 'Accounts and signing in',
    words: ['account', 'sign in', 'log in', 'login', 'usage', 'add account', 'second account', 'out until'],
  },
  {
    key: 'model',
    section: 'agents',
    title: 'The model new work starts on',
    words: ['model', 'effort', 'opus', 'sonnet', 'gpt', 'reasoning', 'default model'],
  },
  { key: 'claude', section: 'agents', title: 'Claude Code', words: ['anthropic', 'claude'] },
  { key: 'codex', section: 'agents', title: 'Codex', words: ['openai', 'chatgpt'] },
  { key: 'opencode', section: 'agents', title: 'OpenCode', words: ['download', 'install'] },
  { key: 'hosts', section: 'hosts', title: 'Code hosts and trackers', words: ['connect', 'token', 'issues', 'tracker', 'code host'] },
  { key: 'github', section: 'hosts', title: 'GitHub', words: ['connected as balazs', 'github enterprise'] },
  { key: 'gitlab', section: 'hosts', title: 'GitLab', words: [] },
  { key: 'bitbucket', section: 'hosts', title: 'Bitbucket', words: ['atlassian'] },
  { key: 'linear', section: 'hosts', title: 'Linear', words: ['connected as balazs'] },
  { key: 'jira', section: 'hosts', title: 'Jira', words: ['atlassian'] },
  { key: 'trello', section: 'hosts', title: 'Trello', words: [] },
  {
    key: 'keepAwake',
    section: 'mac',
    title: text.awakeTitle,
    words: ['sleep', 'awake', 'battery', 'power', 'caffeinate', 'lid'],
    row: 'keepAwake',
  },
  {
    key: 'atOnce',
    section: 'mac',
    title: 'Agents at once',
    words: ['cap', 'limit', 'parallel', 'concurrent', 'how many', 'cores', 'memory', 'queue'],
    row: 'atOnce',
  },
  { key: 'load', section: 'mac', title: text.loadTitle, words: ['cpu', 'memory', 'load', 'meter', 'activity'], row: 'load' },
  {
    key: 'postTeam',
    section: 'reviews',
    title: text.postTeamTitle,
    words: ['review', 'post', 'automatic', 'team', 'pr', 'draft'],
    row: 'postTeam',
  },
  {
    key: 'coAuthor',
    section: 'reviews',
    title: text.coAuthorTitle,
    words: ['co-author', 'coauthor', 'commit', 'trailer', 'credit', 'signature'],
    row: 'coAuthor',
  },
  {
    key: 'calls',
    section: 'notify',
    title: notificationSettingsText.calls,
    words: ['notification', 'permission', 'question', 'plan', 'alert'],
    row: 'calls',
  },
  {
    key: 'ready',
    section: 'notify',
    title: notificationSettingsText.ready,
    words: ['notification', 'done', 'finished', 'alert'],
    row: 'ready',
  },
  {
    key: 'stopped',
    section: 'notify',
    title: notificationSettingsText.stopped,
    words: ['notification', 'failed', 'error', 'alert'],
    row: 'stopped',
  },
  { key: 'badge', section: 'notify', title: text.badge, words: ['notification', 'badge', 'dock', 'count', 'number'], row: 'badge' },
  {
    key: 'sound',
    section: 'notify',
    title: 'Notification sound',
    words: ['sound', 'chime', 'silent', 'mute', 'glass', 'ping'],
    row: 'sound',
  },
  {
    key: 'icon',
    section: 'look',
    title: text.icon,
    words: ['dock', 'appearance', 'cobalt', 'lapis', 'paper', 'ink', 'keystone', 'monolith'],
  },
  { key: 'edge', section: 'look', title: text.edge, words: ['notch', 'island', 'menu bar', 'tray', 'edge', 'appearance'] },
  {
    key: 'editor',
    section: 'editor',
    title: 'Open files in',
    words: ['editor', 'ide', 'vs code', 'visual studio code', 'cursor', 'zed', 'xcode', 'finder'],
    row: 'editor',
  },
  {
    key: 'version',
    section: 'about',
    title: 'Althar 0.2.0',
    words: ['version', 'about', 'release notes', 'what’s new', 'update', 'restart', '0.2.1'],
  },
]

/** What a project keeps for itself: found here, said to be in its own settings. */
export const PROJECT_ENTRIES: ReadonlyArray<{ readonly title: string; readonly words: ReadonlyArray<string> }> = [
  { title: 'Resolve conflicts automatically', words: ['conflict', 'merge', 'rebase'] },
  { title: 'Move issues to In Progress when their task starts', words: ['issue', 'in progress', 'status', 'linear', 'jira'] },
  { title: 'Rules', words: ['permission', 'allow', 'deny', 'always ask', 'command', 'review'] },
  { title: 'Repositories', words: ['repository', 'repo', 'folder'] },
  { title: 'Name and colour', words: ['rename', 'name', 'colour', 'color'] },
  { title: 'Notes', words: ['notes', 'remember'] },
  { title: 'Remove from Althar', words: ['remove', 'delete'] },
]

const matches = (query: string, title: string, words: ReadonlyArray<string>, section = '') => {
  const hay = [title, ...words, section].join(' · ').toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part !== '')
    .every((part) => hay.includes(part))
}

/** The settings a query finds, best first: a title that starts with it, then one that has it, then other words. */
export const find = (query: string): ReadonlyArray<Entry> => {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  const score = (entry: Entry) =>
    entry.title.toLowerCase().startsWith(q) ? 0 : entry.title.toLowerCase().includes(q) ? 1 : entry.row === undefined ? 3 : 2
  return ENTRIES.filter((entry) => matches(q, entry.title, entry.words, sectionOf(entry.section).title)).toSorted(
    (a, b) => score(a) - score(b),
  )
}

export const findInProjects = (query: string) =>
  query.trim() === '' ? [] : PROJECT_ENTRIES.filter((entry) => matches(query.trim(), entry.title, entry.words))

/**
 * What a search found, under the sections it is in: a setting small enough to
 * change in place is its own row, live; a larger one, a way into its section.
 * What a project keeps for itself is said to be there.
 */
export function Found({
  query,
  m,
  onOpen,
  projects,
}: {
  query: string
  m: Models
  onOpen: (id: SectionId) => void
  projects: ReadonlyArray<{ readonly id: string; readonly name: string; readonly ink: ProjectInk }>
}) {
  const found = find(query)
  const inProjects = findInProjects(query)
  const sections = SECTIONS.filter((section) => found.some((entry) => entry.section === section.id))
  if (found.length === 0 && inProjects.length === 0) return <p className={s.quiet}>No setting matches “{query.trim()}”.</p>
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {sections.map((section) => {
        const here = found.filter((entry) => entry.section === section.id)
        const rows = here.flatMap((entry) => (entry.row === undefined ? [] : [entry.row]))
        const opens = here.filter((entry) => entry.row === undefined)
        return (
          <div key={section.id}>
            <SettingRow
              title={section.title}
              glyph={<Icon name={section.icon} size={15} />}
              note={opens.map((entry) => entry.title).join(' · ') || undefined}
            >
              {() => <LinkButton onClick={() => onOpen(section.id)}>Open {section.short}</LinkButton>}
            </SettingRow>
            {rows.length > 0 && <SettingList style={{ paddingLeft: 42 }}>{[...new Set(rows)].map((row) => ROWS[row](m))}</SettingList>}
          </div>
        )
      })}
      {inProjects.length > 0 && (
        <SettingRow
          title="In a project’s own settings"
          glyph={<Icon name="folder" size={15} />}
          note={
            <>
              {inProjects.map((entry) => entry.title).join(' · ')}. Each project keeps these for itself, in its Settings:{' '}
              {projects.map((one, i) => (
                <Fragment key={one.id}>
                  {i > 0 && ', '}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle' }}>
                    <ProjectMark seed={one.id} ink={one.ink} size={13} />
                    {one.name}
                  </span>
                </Fragment>
              ))}
              .
            </>
          }
        >
          {() => null}
        </SettingRow>
      )}
    </div>
  )
}

export const PROJECTS = [
  { id: 'p1', name: 'meridian', ink: ProjectInk.Teal },
  { id: 'p2', name: 'atlas', ink: ProjectInk.Ochre },
]
