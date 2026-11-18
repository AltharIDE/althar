import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../app.css'

import {
  AppVersion,
  Button,
  CrashReports,
  Icon,
  LinkButton,
  Logo,
  Path,
  Segmented,
  SettingGroup,
  SettingList,
  SettingRow,
  SettingsLayout,
  SettingsNav,
  Switch,
  UsageData,
  storageSize,
} from '@althar/ui'
import { type KeyboardEvent, StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { GROUPS, sectionText } from '../features/settings/sections'
import s from './AboutPrototype.module.css'

type Direction = 'a' | 'b' | 'c' | 'd' | 'e' | 'f'
type Theme = 'light' | 'dark'

const GB = 1024 ** 3
const PROFILE_BYTES = 7.2 * GB
const LOG_BYTES = 11 * 1024 ** 2
const DISK_BYTES = 994 * GB
const DISK_FREE = 212 * GB
const RELEASE_NOTES = 'https://github.com/AltharIDE/althar/releases/tag/v0.9.0'

const DIRECTIONS = [
  {
    id: 'a',
    name: 'Proportion',
    note: 'The clearest sense of scale; the chart adds a little visual weight.',
  },
  {
    id: 'b',
    name: 'Reclaim',
    note: 'One aligned storage list; task folders lead, with Free up space one press away.',
  },
  {
    id: 'c',
    name: 'Quiet',
    note: 'The calmest, most compact screen; proportions take more hunting.',
  },
  {
    id: 'd',
    name: 'Disk',
    note: 'Sizes against the whole disk and what’s free; needs a disk read, and the bar is one more thing to read.',
  },
  {
    id: 'e',
    name: 'Finished',
    note: 'Frees space in one press, from finished tasks; Althar must know which tasks are done.',
  },
  {
    id: 'f',
    name: 'Tiles',
    note: 'A header with the version, sizes as three tiles; roomier, paths drop to tooltips.',
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
  return DIRECTIONS.some((direction) => direction.id === given) ? (given as Direction) : 'd'
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
  const [cleanupOpen, setCleanupOpen] = useState(false)
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
    cleanupOpen,
    setCleanupOpen,
    show,
    measure,
    measured,
    remove,
    removeMany,
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
        section={`about-${direction}`}
        title="About Althar"
        side={
          <SettingsNav
            label="Settings"
            groups={GROUPS.map((group) => group.map((id) => ({ id, ...sectionText[id] })))}
            value="about"
            onChange={() => setNotice('This prototype keeps About Althar open.')}
          />
        }
      >
        {direction === 'a' && <Proportion {...shared} />}
        {direction === 'b' && <Reclaim {...shared} />}
        {direction === 'c' && <Quiet {...shared} />}
        {direction === 'd' && <Disk {...shared} />}
        {direction === 'e' && <Finished {...shared} />}
        {direction === 'f' && <Tiles {...shared} />}
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
  cleanupOpen: boolean
  setCleanupOpen: (open: boolean) => void
  show: (place: (typeof PLACES)[number]) => void
  measure: () => void
  measured: boolean
  remove: (id: string) => void
  removeMany: (ids: ReadonlyArray<string>) => void
  updateChecked: boolean
  onCheck: () => void
  onReport: () => void
  usage: boolean
  setUsage: (on: boolean) => void
  crashes: boolean
  setCrashes: (on: boolean) => void
}

function Version({
  style,
  updateChecked,
  onCheck,
  onReport,
}: Pick<DirectionProps, 'updateChecked' | 'onCheck' | 'onReport'> & { style: 'line' | 'quiet' }) {
  return (
    <div className={style === 'quiet' ? s.quietVersion : s.lineVersion}>
      <AppVersion version="0.9.0" notes={RELEASE_NOTES} />
      {updateChecked ? <span className={s.updateState}>Up to date</span> : <LinkButton onClick={onCheck}>Check for updates</LinkButton>}
      <LinkButton onClick={onReport}>Report a problem</LinkButton>
    </div>
  )
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

function bytesFor(id: PlaceId, taskBytes: number) {
  if (id === 'profile') return PROFILE_BYTES
  if (id === 'logs') return LOG_BYTES
  return taskBytes
}

function place(id: PlaceId) {
  const found = PLACES.find((one) => one.id === id)
  if (found === undefined) throw new Error(`Unknown storage place: ${id}`)
  return found
}

function Proportion(props: DirectionProps) {
  const { taskBytes, totalBytes } = props
  return (
    <>
      <Version style="line" updateChecked={props.updateChecked} onCheck={props.onCheck} onReport={props.onReport} />
      <SettingGroup
        title="Storage"
        note={`At least ${storageSize(totalBytes)} on this computer`}
        action={<Measure measured={props.measured} onMeasure={props.measure} />}
      >
        <div className={s.proportionSummary}>
          <div className={s.storageBar} aria-hidden="true">
            <span className={s.taskSegment} style={{ width: `${(taskBytes / totalBytes) * 100}%` }} />
            <span className={s.profileSegment} style={{ width: `${(PROFILE_BYTES / totalBytes) * 100}%` }} />
            <span className={s.logSegment} style={{ width: `${Math.max((LOG_BYTES / totalBytes) * 100, 0.15)}%` }} />
          </div>
          <div className={s.proportionKey}>
            <span>
              <i className={s.taskKey} />
              Task folders {Math.round((taskBytes / totalBytes) * 100)}%
            </span>
            <span>
              <i className={s.profileKey} />
              Profile {Math.round((PROFILE_BYTES / totalBytes) * 100)}%
            </span>
            <Button size="small" trailingIcon="arrow" onClick={() => props.setCleanupOpen(!props.cleanupOpen)}>
              Free space
            </Button>
          </div>
        </div>
        {props.cleanupOpen && <Cleanup folders={props.folders} onRemove={props.remove} />}
        <SettingList>
          {PLACES.map((one) => (
            <SettingRow key={one.id} title={one.title} note={<Path path={one.path} className={s.path} />}>
              {() => (
                <>
                  <span className={s.size}>
                    {one.id === 'worktrees' ? `at least ${storageSize(taskBytes)}` : storageSize(bytesFor(one.id, taskBytes))}
                  </span>
                  <ShowButton place={one} onShow={() => props.show(one)} />
                </>
              )}
            </SettingRow>
          ))}
        </SettingList>
      </SettingGroup>
      <Privacy {...props} compact />
    </>
  )
}

function Reclaim(props: DirectionProps) {
  const share = props.totalBytes === 0 ? 0 : Math.round((props.taskBytes / props.totalBytes) * 100)
  const tasks = place('worktrees')
  return (
    <>
      <Version style="line" updateChecked={props.updateChecked} onCheck={props.onCheck} onReport={props.onReport} />
      <SettingGroup
        title="Storage"
        note={`At least ${storageSize(props.totalBytes)} on this computer`}
        action={<Measure measured={props.measured} onMeasure={props.measure} />}
      >
        <SettingList>
          <SettingRow
            title={tasks.title}
            className={s.reclaimRow}
            note={
              <span className={s.reclaimNote}>
                <span>{share}% of Althar’s storage</span>
                <Path path={tasks.path} className={s.path} />
                <span className={s.reclaimAction}>
                  <Button size="small" onClick={() => props.setCleanupOpen(!props.cleanupOpen)}>
                    {props.cleanupOpen ? 'Done' : 'Free up space…'}
                  </Button>
                </span>
              </span>
            }
            under={props.cleanupOpen ? <Cleanup folders={props.folders} onRemove={props.remove} crowded /> : undefined}
          >
            {() => (
              <>
                <span className={s.size}>at least {storageSize(props.taskBytes)}</span>
                <ShowButton compact place={tasks} onShow={() => props.show(tasks)} />
              </>
            )}
          </SettingRow>
          {(['profile', 'logs'] as const).map((id) => {
            const one = place(id)
            return (
              <SettingRow key={id} title={one.title} note={<Path path={one.path} className={s.path} />}>
                {() => (
                  <>
                    <span className={s.size}>{storageSize(bytesFor(id, props.taskBytes))}</span>
                    <ShowButton compact place={one} onShow={() => props.show(one)} />
                  </>
                )}
              </SettingRow>
            )
          })}
        </SettingList>
      </SettingGroup>
      <Privacy {...props} compact />
    </>
  )
}

function Quiet(props: DirectionProps) {
  return (
    <>
      <SettingGroup
        title="Storage"
        note={`At least ${storageSize(props.totalBytes)}`}
        action={<Measure measured={props.measured} onMeasure={props.measure} />}
      >
        <SettingList>
          {PLACES.map((one) => (
            <SettingRow
              key={one.id}
              title={one.title}
              className={one.id === 'worktrees' ? s.quietRow : undefined}
              note={<Path path={one.path} className={s.path} />}
              under={
                one.id === 'worktrees' ? (
                  <div className={s.quietCleanup}>
                    <LinkButton onClick={() => props.setCleanupOpen(!props.cleanupOpen)}>
                      {props.cleanupOpen ? 'Hide task folders' : 'Free space'}
                    </LinkButton>
                    {props.cleanupOpen && <Cleanup folders={props.folders} onRemove={props.remove} />}
                  </div>
                ) : undefined
              }
            >
              {() => (
                <>
                  <span className={s.size}>
                    {one.id === 'worktrees' ? `at least ${storageSize(props.taskBytes)}` : storageSize(bytesFor(one.id, props.taskBytes))}
                  </span>
                  <ShowButton place={one} onShow={() => props.show(one)} />
                </>
              )}
            </SettingRow>
          ))}
        </SettingList>
      </SettingGroup>
      <Privacy {...props} compact />
      <Version style="quiet" updateChecked={props.updateChecked} onCheck={props.onCheck} onReport={props.onReport} />
    </>
  )
}

function Disk(props: DirectionProps) {
  const used = DISK_BYTES - DISK_FREE
  const other = used - props.totalBytes
  const pct = (bytes: number) => `${(bytes / DISK_BYTES) * 100}%`
  const tasks = place('worktrees')
  return (
    <>
      <Version style="line" updateChecked={props.updateChecked} onCheck={props.onCheck} onReport={props.onReport} />
      <SettingGroup title="Storage" action={<Measure measured={props.measured} onMeasure={props.measure} />}>
        <div className={s.disk}>
          <div className={s.diskFigures}>
            <span className={s.diskBig}>{storageSize(props.totalBytes)}</span>
            <span className={s.diskOf}>of this disk’s {storageSize(DISK_BYTES)}</span>
            <span className={s.diskFree}>
              {storageSize(DISK_FREE + (INITIAL_FOLDERS.reduce((sum, one) => sum + one.bytes, 0) - props.taskBytes))} free
            </span>
          </div>
          <div className={s.diskBar} aria-hidden="true">
            <span className={s.diskTasks} style={{ width: pct(props.taskBytes) }} />
            <span className={s.diskProfile} style={{ width: pct(PROFILE_BYTES + LOG_BYTES) }} />
            <span className={s.diskOther} style={{ width: pct(other) }} />
          </div>
          <div className={s.proportionKey}>
            <span>
              <i className={s.taskKey} />
              Task folders
            </span>
            <span>
              <i className={s.profileKey} />
              Profile and logs
            </span>
            <span>
              <i className={s.otherKey} />
              Everything else
            </span>
          </div>
        </div>
        <SettingList>
          <SettingRow
            title={tasks.title}
            note={<Path path={tasks.path} className={s.path} />}
            under={props.cleanupOpen ? <Cleanup folders={props.folders} onRemove={props.remove} /> : undefined}
          >
            {() => (
              <>
                <span className={s.size}>at least {storageSize(props.taskBytes)}</span>
                <Button size="small" onClick={() => props.setCleanupOpen(!props.cleanupOpen)}>
                  {props.cleanupOpen ? 'Done' : 'Free up space…'}
                </Button>
                <ShowButton compact place={tasks} onShow={() => props.show(tasks)} />
              </>
            )}
          </SettingRow>
          {(['profile', 'logs'] as const).map((id) => {
            const one = place(id)
            return (
              <SettingRow key={id} title={one.title} note={<Path path={one.path} className={s.path} />}>
                {() => (
                  <>
                    <span className={s.size}>{storageSize(bytesFor(id, props.taskBytes))}</span>
                    <ShowButton compact place={one} onShow={() => props.show(one)} />
                  </>
                )}
              </SettingRow>
            )
          })}
        </SettingList>
      </SettingGroup>
      <Privacy {...props} compact />
    </>
  )
}

function Finished(props: DirectionProps) {
  const finished = props.folders.filter((one) => one.done !== null)
  const finishedBytes = finished.reduce((sum, one) => sum + one.bytes, 0)
  const tasks = place('worktrees')
  return (
    <>
      <Version style="line" updateChecked={props.updateChecked} onCheck={props.onCheck} onReport={props.onReport} />
      <SettingGroup
        title="Storage"
        note={`At least ${storageSize(props.totalBytes)} on this computer`}
        action={<Measure measured={props.measured} onMeasure={props.measure} />}
      >
        {finished.length > 0 ? (
          <div className={s.reclaimBanner}>
            <span className={s.reclaimWords}>
              <strong>{storageSize(finishedBytes)} in folders of finished tasks</strong>
              <span>The tasks and their conversations stay.</span>
            </span>
            <Button onClick={() => props.removeMany(finished.map((one) => one.id))}>
              Remove {finished.length === 1 ? 'it' : `all ${finished.length}`}
            </Button>
          </div>
        ) : (
          <div className={s.reclaimBanner}>
            <span className={s.reclaimWords}>
              <strong>No finished tasks’ folders left</strong>
              <span>Folders of open tasks stay until you settle them.</span>
            </span>
          </div>
        )}
        <SettingList>
          <SettingRow title={tasks.title} note={<Path path={tasks.path} className={s.path} />}>
            {() => (
              <>
                <span className={s.size}>at least {storageSize(props.taskBytes)}</span>
                <ShowButton compact place={tasks} onShow={() => props.show(tasks)} />
              </>
            )}
          </SettingRow>
          <ul className={s.taskFolders}>
            {props.folders.map((folder) => (
              <li key={folder.id}>
                <span className={s.folderName}>
                  <strong>{folder.title}</strong>
                  <span>{folder.project}</span>
                </span>
                <span className={folder.done === null ? s.folderOpen : s.folderDone}>{folder.done ?? 'Open'}</span>
                <span className={s.folderSize}>{storageSize(folder.bytes)}</span>
                <span className={s.folderRemove}>
                  <Button size="small" variant="quiet" onClick={() => props.remove(folder.id)}>
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {(['profile', 'logs'] as const).map((id) => {
            const one = place(id)
            return (
              <SettingRow key={id} title={one.title} note={<Path path={one.path} className={s.path} />}>
                {() => (
                  <>
                    <span className={s.size}>{storageSize(bytesFor(id, props.taskBytes))}</span>
                    <ShowButton compact place={one} onShow={() => props.show(one)} />
                  </>
                )}
              </SettingRow>
            )
          })}
        </SettingList>
      </SettingGroup>
      <Privacy {...props} compact />
    </>
  )
}

function Tiles(props: DirectionProps) {
  const tiles = [
    { one: place('worktrees'), bytes: props.taskBytes, lead: true },
    { one: place('profile'), bytes: PROFILE_BYTES, lead: false },
    { one: place('logs'), bytes: LOG_BYTES, lead: false },
  ]
  return (
    <>
      <header className={s.appHeader}>
        <Logo size={36} />
        <span className={s.appWords}>
          <strong>Althar 0.9.0</strong>
          <span className={s.appState}>
            {props.updateChecked ? (
              <>
                <i className={s.okDot} />
                Up to date
              </>
            ) : (
              <LinkButton onClick={props.onCheck}>Check for updates</LinkButton>
            )}
          </span>
        </span>
        <span className={s.appActions}>
          <Button size="small" trailingIcon="external" onClick={() => window.open(RELEASE_NOTES, '_blank')}>
            What’s new
          </Button>
          <Button size="small" onClick={props.onReport}>
            Report a problem
          </Button>
        </span>
      </header>
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
                  <Button size="small" onClick={() => props.setCleanupOpen(!props.cleanupOpen)}>
                    {props.cleanupOpen ? 'Done' : 'Free up space…'}
                  </Button>
                )}
                <ShowButton compact place={one} onShow={() => props.show(one)} />
              </span>
            </div>
          ))}
        </div>
        {props.cleanupOpen && <Cleanup folders={props.folders} onRemove={props.remove} />}
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

function PairSwitch({ title, on, onChange }: { title: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={s.pairSwitch}>
      <span>{title}</span>
      <Switch checked={on} onChange={onChange} label={title} />
    </label>
  )
}

function Cleanup({
  folders,
  onRemove,
  crowded = false,
}: {
  folders: typeof INITIAL_FOLDERS
  onRemove: (id: string) => void
  crowded?: boolean
}) {
  return (
    <div className={crowded ? s.crowdedCleanup : s.cleanup}>
      <div className={s.cleanupHead}>
        <strong>Remove folders you no longer need</strong>
        <span>The task and its conversation stay in Althar.</span>
      </div>
      {folders.length === 0 ? (
        <p className={s.empty}>No task folders left to remove.</p>
      ) : (
        <ul className={s.folderList}>
          {folders.map((folder) => (
            <li key={folder.id}>
              <span className={s.folderName}>
                <strong>{folder.title}</strong>
                <span>{folder.project}</span>
              </span>
              <span className={s.folderSize}>{storageSize(folder.bytes)}</span>
              <Button size="small" variant="danger" onClick={() => onRemove(folder.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Privacy({
  usage,
  setUsage,
  crashes,
  setCrashes,
  compact = false,
}: Pick<DirectionProps, 'usage' | 'setUsage' | 'crashes' | 'setCrashes'> & { compact?: boolean }) {
  return (
    <SettingGroup title="Privacy" note="Anonymous. Never your code or any name.">
      <SettingList>
        <UsageData on={usage} onChange={setUsage} text={{ note: compact ? 'How Althar is used.' : undefined }} />
        <CrashReports on={crashes} onChange={setCrashes} text={{ note: compact ? 'What failed, and where.' : undefined }} />
      </SettingList>
    </SettingGroup>
  )
}

const element = document.getElementById('root')
if (element === null) throw new Error('The page has no #root')
createRoot(element).render(
  <StrictMode>
    <AboutPrototype />
  </StrictMode>,
)
