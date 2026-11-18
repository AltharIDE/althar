import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../app.css'

import {
  Button,
  Icon,
  KeepAwake,
  LinkButton,
  Logo,
  Segmented,
  SettingGroup,
  SettingSwitch,
  SettingList,
  SettingsLayout,
  SettingsNav,
  TaskFolders,
  type FolderWait,
  taskFoldersText,
  Switch,
  storageSize,
} from '@althar/ui'
import { type KeyboardEvent, StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { GROUPS, sectionText } from '../features/settings/sections'
import { text as settingsText } from '../features/settings/text'
import s from './AboutPrototype.module.css'

type Direction = 'a' | 'b' | 'c' | 'd'
type Theme = 'light' | 'dark'

const GB = 1024 ** 3
const PROFILE_BYTES = 7.2 * GB
const LOG_BYTES = 11 * 1024 ** 2
const DISK_BYTES = 994 * GB
const DISK_FREE = 212 * GB
const DISCORD = 'https://discord.gg/QA2g8MwKda'
const WEBSITE = 'https://althar.ai'
const CHANGELOG = 'https://althar.ai/changelog'

const DIRECTIONS = [
  {
    id: 'a',
    name: 'Chip',
    note: 'A small chip beside the version: always there, never loud; easy to stop seeing.',
  },
  {
    id: 'b',
    name: 'Edition',
    note: 'Althar Early access as the name, the version under it: reads like a release, not a warning.',
  },
  {
    id: 'c',
    name: 'Note',
    note: 'A band that says what early access means, with Discord and Report a problem in it: clearest, takes the most room.',
  },
  {
    id: 'd',
    name: 'Eyebrow',
    note: 'A small label over the name, in the label face: quiet and typographic; the least explicit.',
  },
] as const

const PLACES = [
  {
    id: 'profile',
    title: 'Profile',
    note: 'Projects, tasks and settings',
    path: '/Users/balazs/Library/Application Support/Althar',
  },
  {
    id: 'logs',
    title: 'Logs',
    note: 'What Althar writes as it runs',
    path: '/Users/balazs/Library/Logs/Althar',
  },
  {
    id: 'worktrees',
    title: 'Task folders',
    note: 'A copy of each project for every task',
    path: '/Users/balazs/Charrette',
  },
] as const

type PlaceId = (typeof PLACES)[number]['id']

const INITIAL_FOLDERS = [
  { id: 'billing', title: 'Billing retry', project: 'Orca', bytes: 9.8 * GB, done: 'Merged' },
  { id: 'search', title: 'Search across Althar', project: 'Althar', bytes: 7.4 * GB, done: null },
  { id: 'linux', title: 'Linux packages', project: 'Althar', bytes: 6.2 * GB, done: 'Merged' },
  { id: 'import', title: 'Import from other tools', project: 'Althar', bytes: 4.6 * GB, done: null },
  { id: 'docs', title: 'A scannable feature table', project: 'Website', bytes: 3 * GB, done: 'Closed' },
]

function initialDirection(): Direction {
  const given = new URLSearchParams(window.location.search).get('direction')
  return DIRECTIONS.some((direction) => direction.id === given) ? (given as Direction) : 'a'
}

function initialTheme(): Theme {
  return new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light'
}

export function AboutPrototype() {
  const [direction, setDirection] = useState<Direction>(initialDirection)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [usage, setUsage] = useState(true)
  const [crashes, setCrashes] = useState(true)
  const [removed, setRemoved] = useState<ReadonlyArray<string>>([])
  const [lastRemoved, setLastRemoved] = useState<ReadonlyArray<string> | null>(null)
  const [section, setSection] = useState<'about' | 'this-mac'>('about')
  const [flash, setFlash] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [measured, setMeasured] = useState(false)
  const [updateChecked, setUpdateChecked] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => root.current?.focus(), [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    const url = new URL(window.location.href)
    url.searchParams.set('direction', direction)
    url.searchParams.set('theme', theme)
    window.history.replaceState(null, '', url)
  }, [direction, theme])

  const folders = INITIAL_FOLDERS.filter((folder) => !removed.includes(folder.id))
  const taskBytes = folders.reduce((sum, folder) => sum + folder.bytes, 0)
  const totalBytes = PROFILE_BYTES + LOG_BYTES + taskBytes
  const current = DIRECTIONS.find((one) => one.id === direction) ?? DIRECTIONS[0]

  const show = (place: (typeof PLACES)[number]) => {
    setLastRemoved(null)
    setNotice(`Finder: ${place.path}`)
  }
  const measure = () => {
    setMeasured(true)
    setLastRemoved(null)
    setNotice('Storage measured again.')
  }
  const checkForUpdates = () => {
    setUpdateChecked(true)
    setLastRemoved(null)
    setNotice('Althar 0.9.0 is the latest version.')
    root.current?.focus()
  }
  const report = () => {
    setLastRemoved(null)
    setNotice('Report a problem opens over Settings.')
  }
  const remove = (id: string) => {
    const folder = INITIAL_FOLDERS.find((one) => one.id === id)
    if (folder === undefined) return
    setRemoved((was) => [...was, id])
    setLastRemoved([id])
    setNotice(`${storageSize(folder.bytes)} freed from ${folder.project}.`)
    root.current?.focus()
  }
  const removeMany = (ids: ReadonlyArray<string>) => {
    const gone = INITIAL_FOLDERS.filter((one) => ids.includes(one.id))
    if (gone.length === 0) return
    setRemoved((was) => [...was, ...ids])
    setLastRemoved(ids)
    setNotice(`${storageSize(gone.reduce((sum, one) => sum + one.bytes, 0))} freed.`)
    root.current?.focus()
  }
  const undo = () => {
    if (lastRemoved === null) return
    setRemoved((was) => was.filter((id) => !lastRemoved.includes(id)))
    setLastRemoved(null)
    setNotice(lastRemoved.length === 1 ? 'Task folder restored.' : 'Task folders restored.')
    root.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target
    if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
    const key = event.key.toLowerCase()
    if (DIRECTIONS.some((one) => one.id === key)) {
      event.preventDefault()
      setSection('about')
      setDirection(key as Direction)
    } else if (key === 't') {
      event.preventDefault()
      setTheme((was) => (was === 'light' ? 'dark' : 'light'))
    }
  }

  const shared = {
    taskBytes,
    totalBytes,
    folders,
    show,
    measure,
    measured,
    remove,
    removeMany,
    freeUpSpace: () => {
      setNotice(null)
      setSection('this-mac')
      setFlash((was) => was + 1)
    },
    updateChecked,
    onCheck: checkForUpdates,
    onReport: report,
    usage,
    setUsage,
    crashes,
    setCrashes,
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the prototype's direction keys stay inside its own page
    <section ref={root} className={s.prototype} aria-label="About Althar prototype" onKeyDown={onKeyDown} tabIndex={-1}>
      <SettingsLayout
        section={section === 'about' ? `about-${direction}` : section}
        title={sectionText[section].title}
        side={
          <SettingsNav
            label="Settings"
            groups={GROUPS.map((group) => group.map((id) => ({ id, ...sectionText[id] })))}
            value={section}
            onChange={(id) =>
              id === 'about' || id === 'this-mac' ? setSection(id) : setNotice('This prototype has About Althar and Work on this Mac.')
            }
          />
        }
      >
        {section === 'this-mac' && <ThisMac {...shared} flash={flash} />}
        {section === 'about' && <Tiles {...shared} early={direction} />}
      </SettingsLayout>

      {notice !== null && (
        <output className={s.notice}>
          <span>{notice}</span>
          {lastRemoved !== null && <LinkButton onClick={undo}>Undo</LinkButton>}
          <button type="button" className={s.dismiss} aria-label="Dismiss message" onClick={() => setNotice(null)}>
            <Icon name="close" size={12} />
          </button>
        </output>
      )}

      <footer className={s.switcher} aria-label="Prototype directions">
        <div className={s.directionNote}>
          <strong>
            {current.id.toUpperCase()} · {current.name}
          </strong>
          <span>{current.note}</span>
        </div>
        <div className={s.switcherControls}>
          <Segmented<Direction>
            label="Design direction"
            value={direction}
            onChange={setDirection}
            options={DIRECTIONS.map((one) => ({ value: one.id, label: `${one.id.toUpperCase()} ${one.name}`, kbd: one.id.toUpperCase() }))}
          />
          <Segmented<Theme>
            label="Appearance"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
          <span className={s.themeKey}>T theme</span>
        </div>
      </footer>
    </section>
  )
}

interface DirectionProps {
  taskBytes: number
  totalBytes: number
  folders: typeof INITIAL_FOLDERS
  show: (place: (typeof PLACES)[number]) => void
  measure: () => void
  measured: boolean
  remove: (id: string) => void
  removeMany: (ids: ReadonlyArray<string>) => void
  /** Takes the person to Work on this Mac's task folders. */
  freeUpSpace: () => void
  updateChecked: boolean
  onCheck: () => void
  onReport: () => void
  usage: boolean
  setUsage: (on: boolean) => void
  crashes: boolean
  setCrashes: (on: boolean) => void
}

function Measure({ measured, onMeasure }: { measured: boolean; onMeasure: () => void }) {
  return <LinkButton onClick={onMeasure}>{measured ? 'Measured just now' : 'Measure again'}</LinkButton>
}

function ShowButton({ place, onShow, compact = false }: { place: (typeof PLACES)[number]; onShow: () => void; compact?: boolean }) {
  return (
    <Button
      size="small"
      icon="folder"
      aria-label={`Show in Finder, ${place.title}`}
      title={compact ? `Show ${place.title} in Finder` : undefined}
      onClick={onShow}
    >
      {compact ? undefined : 'Show in Finder'}
    </Button>
  )
}

function place(id: PlaceId) {
  const found = PLACES.find((one) => one.id === id)
  if (found === undefined) throw new Error(`Unknown storage place: ${id}`)
  return found
}

function Tiles(props: DirectionProps & { early: Direction }) {
  const tiles = [
    { one: place('worktrees'), bytes: props.taskBytes, lead: true },
    { one: place('profile'), bytes: PROFILE_BYTES, lead: false },
    { one: place('logs'), bytes: LOG_BYTES, lead: false },
  ]
  const { early } = props
  const updates = props.updateChecked ? (
    <span className={s.upToDate}>
      <i className={s.okDot} />
      Up to date
    </span>
  ) : (
    <LinkButton onClick={props.onCheck}>Check for updates</LinkButton>
  )
  const discord = (
    <Button size="small" trailingIcon="external" onClick={() => window.open(DISCORD, '_blank')}>
      <span className={s.withMark}>
        <DiscordMark />
        Discord
      </span>
    </Button>
  )
  const reportButton = (
    <Button size="small" onClick={props.onReport}>
      Report a problem
    </Button>
  )
  return (
    <>
      <header className={s.appHeader}>
        <Logo size={36} />
        <span className={s.appWords}>
          {early === 'd' && <span className={s.eyebrow}>Early access</span>}
          {early === 'b' ? (
            <strong>
              Althar <span className={s.edition}>Early access</span>
            </strong>
          ) : (
            <span className={s.nameLine}>
              <strong>Althar 0.9.0</strong>
              {early === 'a' && <span className={s.eaChip}>Early access</span>}
            </span>
          )}
          <span className={s.appState}>
            {early === 'b' && <span className={s.versionSmall}>0.9.0</span>}
            {updates}
          </span>
        </span>
        <span className={s.appActions}>
          <Button size="small" trailingIcon="external" onClick={() => window.open(WEBSITE, '_blank')}>
            Website
          </Button>
          <Button size="small" trailingIcon="external" onClick={() => window.open(CHANGELOG, '_blank')}>
            What’s new
          </Button>
          {early !== 'c' && discord}
          {early !== 'c' && reportButton}
        </span>
      </header>
      {early === 'c' && (
        <div className={s.eaNote}>
          <span className={s.eaWords}>
            <strong>Early access</strong>
            <span>Althar changes every week, and some things will break. Tell us when they do.</span>
          </span>
          <span className={s.eaActions}>
            {discord}
            {reportButton}
          </span>
        </div>
      )}
      <SettingGroup title="Storage" action={<Measure measured={props.measured} onMeasure={props.measure} />}>
        <div className={s.tiles}>
          {tiles.map(({ one, bytes, lead }) => (
            <div key={one.id} className={lead ? s.tileLead : s.tile} title={one.path}>
              <span className={s.tileTitle}>{one.title}</span>
              <span className={s.tileSize}>
                {lead && <small>at least </small>}
                {storageSize(bytes)}
              </span>
              <span className={s.tileShare}>
                {bytes / props.totalBytes < 0.01 ? '<1%' : `${Math.round((bytes / props.totalBytes) * 100)}%`}
              </span>
              <span className={s.tileActions}>
                {lead && (
                  <Button size="small" trailingIcon="arrow" onClick={props.freeUpSpace}>
                    Free up space
                  </Button>
                )}
                <ShowButton compact place={one} onShow={() => props.show(one)} />
              </span>
            </div>
          ))}
        </div>
      </SettingGroup>
      <SettingGroup title="Help improve Althar" note="Anonymous. Never your code or any name.">
        <div className={s.privacyPair}>
          <PairSwitch title="Usage data" on={props.usage} onChange={props.setUsage} />
          <PairSwitch title="Crash reports" on={props.crashes} onChange={props.setCrashes} />
        </div>
      </SettingGroup>
    </>
  )
}

/** Discord's mark, from Simple Icons (CC0), in the text's colour. A real build adds it to the kit's brands. */
function DiscordMark() {
  return (
    <svg className={s.mark} viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
      />
    </svg>
  )
}

function PairSwitch({ title, on, onChange }: { title: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={s.pairSwitch}>
      <span>{title}</span>
      <Switch checked={on} onChange={onChange} label={title} />
    </label>
  )
}

const KIND: Record<string, 'merged' | 'done'> = { Merged: 'merged', Closed: 'done' }
const WHEN: Record<string, string> = { billing: '2 days ago', linux: 'yesterday', docs: '5 days ago' }

/**
 * Work on this Mac as Settings has it, from the kit's own rows, with the real
 * task folders row: where About Althar's Free up space goes, scrolled to and
 * lit for a moment so the person sees where they landed.
 */
function ThisMac(props: DirectionProps & { flash: number }) {
  const [wait, setWait] = useState<FolderWait>('smart')
  const [awake, setAwake] = useState(true)
  const [battery, setBattery] = useState(false)
  const [load, setLoad] = useState(true)
  const [login, setLogin] = useState(true)
  const [freed, setFreed] = useState<number | null>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (props.flash === 0) return
    const title = [...(list.current?.querySelectorAll('span') ?? [])].find((one) => one.textContent === taskFoldersText.title)
    const row = title?.parentElement?.parentElement
    if (row === undefined || row === null) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    row.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' })
    const lit = s.flash ?? ''
    row.classList.add(s.flashable ?? '', lit)
    const off = window.setTimeout(() => row.classList.remove(lit), 1100)
    return () => window.clearTimeout(off)
  }, [props.flash])

  const goes = props.folders
    .filter((one) => one.done !== null)
    .map((one) => ({
      id: one.id,
      title: one.title,
      kind: KIND[one.done ?? 'Merged'] ?? 'done',
      when: WHEN[one.id] ?? 'today',
      bytes: one.bytes,
    }))
  const gone = INITIAL_FOLDERS.reduce((sum, one) => sum + one.bytes, 0) - props.taskBytes

  return (
    <div ref={list}>
      <SettingList>
        <KeepAwake
          on={awake}
          onChange={setAwake}
          onBattery={battery}
          onBatteryChange={setBattery}
          text={{ title: settingsText.awakeTitle, note: settingsText.awakeNote }}
        />
        <SettingSwitch title={settingsText.loadTitle} glyph={<Icon name="load" size={15} />} checked={load} onChange={setLoad} />
        <SettingSwitch
          title={settingsText.atLoginTitle}
          note={settingsText.atLoginNote}
          glyph={<Icon name="automation" size={15} />}
          checked={login}
          onChange={setLogin}
        />
        <TaskFolders
          wait={wait}
          onWait={setWait}
          disk={{ total: DISK_BYTES, used: DISK_BYTES - DISK_FREE - gone }}
          goes={goes}
          held={[]}
          onCleanUp={() => {
            setFreed(goes.reduce((sum, one) => sum + one.bytes, 0))
            props.removeMany(goes.map((one) => one.id))
          }}
          onRemove={(id) => {
            setFreed(goes.find((one) => one.id === id)?.bytes ?? null)
            props.remove(id)
          }}
          freed={freed}
        />
      </SettingList>
    </div>
  )
}

const element = document.getElementById('root')
if (element === null) throw new Error('The page has no #root')
createRoot(element).render(
  <StrictMode>
    <AboutPrototype />
  </StrictMode>,
)
