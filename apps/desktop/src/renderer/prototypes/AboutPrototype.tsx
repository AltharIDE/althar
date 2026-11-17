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
  UsageData,
  storageSize,
} from '@althar/ui'
import { type KeyboardEvent, StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { GROUPS, sectionText } from '../features/settings/sections'
import s from './AboutPrototype.module.css'

type Direction = 'a' | 'b' | 'c'
type Theme = 'light' | 'dark'

const GB = 1024 ** 3
const PROFILE_BYTES = 7.2 * GB
const LOG_BYTES = 11 * 1024 ** 2
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
    note: 'The fastest route to freeing space; task folders dominate the screen.',
  },
  {
    id: 'c',
    name: 'Quiet',
    note: 'The calmest, most compact screen; proportions take more hunting.',
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
  { id: 'billing', title: 'Billing retry', project: 'Orca', bytes: 9.8 * GB },
  { id: 'search', title: 'Search across Althar', project: 'Althar', bytes: 7.4 * GB },
  { id: 'linux', title: 'Linux packages', project: 'Althar', bytes: 6.2 * GB },
  { id: 'import', title: 'Import from other tools', project: 'Althar', bytes: 4.6 * GB },
  { id: 'docs', title: 'A scannable feature table', project: 'Website', bytes: 3 * GB },
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
  const [lastRemoved, setLastRemoved] = useState<string | null>(null)
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
    setLastRemoved(id)
    setNotice(`${storageSize(folder.bytes)} freed from ${folder.project}.`)
    root.current?.focus()
  }
  const undo = () => {
    if (lastRemoved === null) return
    setRemoved((was) => was.filter((id) => id !== lastRemoved))
    setLastRemoved(null)
    setNotice('Task folder restored.')
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
        {direction === 'a' && (
          <Proportion
            {...shared}
            updateChecked={updateChecked}
            onCheck={checkForUpdates}
            onReport={report}
            usage={usage}
            setUsage={setUsage}
            crashes={crashes}
            setCrashes={setCrashes}
          />
        )}
        {direction === 'b' && (
          <Reclaim
            {...shared}
            updateChecked={updateChecked}
            onCheck={checkForUpdates}
            onReport={report}
            usage={usage}
            setUsage={setUsage}
            crashes={crashes}
            setCrashes={setCrashes}
          />
        )}
        {direction === 'c' && (
          <Quiet
            {...shared}
            updateChecked={updateChecked}
            onCheck={checkForUpdates}
            onReport={report}
            usage={usage}
            setUsage={setUsage}
            crashes={crashes}
            setCrashes={setCrashes}
          />
        )}
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
}: Pick<DirectionProps, 'updateChecked' | 'onCheck' | 'onReport'> & { style: 'line' | 'brand' | 'quiet' }) {
  if (style === 'brand')
    return (
      <header className={s.brandVersion}>
        <Logo size={34} />
        <div className={s.brandWords}>
          <AppVersion version="0.9.0" notes={RELEASE_NOTES} className={s.brandName} />
          <span>{updateChecked ? 'Checked just now' : 'Up to date'}</span>
        </div>
        <div className={s.versionActions}>
          {!updateChecked && <LinkButton onClick={onCheck}>Check for updates</LinkButton>}
          <LinkButton onClick={onReport}>Report a problem</LinkButton>
        </div>
      </header>
    )
  return (
    <div className={style === 'quiet' ? s.quietVersion : s.lineVersion}>
      <AppVersion version="0.9.0" notes={RELEASE_NOTES} />
      <span className={s.updateState}>{updateChecked ? 'Checked just now' : 'Up to date'}</span>
      {!updateChecked && <LinkButton onClick={onCheck}>Check for updates</LinkButton>}
      <LinkButton onClick={onReport}>Report a problem</LinkButton>
    </div>
  )
}

function Measure({ measured, onMeasure }: { measured: boolean; onMeasure: () => void }) {
  return <LinkButton onClick={onMeasure}>{measured ? 'Measured just now' : 'Measure again'}</LinkButton>
}

function ShowButton({ place, onShow }: { place: (typeof PLACES)[number]; onShow: () => void }) {
  return (
    <Button size="small" icon="folder" aria-label={`Show in Finder, ${place.title}`} onClick={onShow}>
      Show in Finder
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
  return (
    <>
      <Version style="brand" updateChecked={props.updateChecked} onCheck={props.onCheck} onReport={props.onReport} />
      <SettingGroup
        title="Storage"
        note={`At least ${storageSize(props.totalBytes)} in three places`}
        action={<Measure measured={props.measured} onMeasure={props.measure} />}
      >
        <section className={s.reclaim} aria-labelledby="reclaim-title">
          <div>
            <h3 id="reclaim-title">Task folders</h3>
            <p>A copy of each project for every task.</p>
          </div>
          <div className={s.reclaimFigure}>
            <strong>at least {storageSize(props.taskBytes)}</strong>
            <span>{share}% of Althar’s storage</span>
          </div>
          <div className={s.reclaimActions}>
            <Button size="small" trailingIcon="arrow" onClick={() => props.setCleanupOpen(!props.cleanupOpen)}>
              Review task folders
            </Button>
            <ShowButton place={place('worktrees')} onShow={() => props.show(place('worktrees'))} />
          </div>
          <Path path={place('worktrees').path} className={s.reclaimPath} />
        </section>
        {props.cleanupOpen && <Cleanup folders={props.folders} onRemove={props.remove} crowded />}
        <SettingList>
          {(['profile', 'logs'] as const).map((id) => {
            const one = place(id)
            return (
              <SettingRow key={id} title={one.title} note={<Path path={one.path} className={s.path} />}>
                {() => (
                  <>
                    <span className={s.size}>{storageSize(bytesFor(id, props.taskBytes))}</span>
                    <ShowButton place={one} onShow={() => props.show(one)} />
                  </>
                )}
              </SettingRow>
            )
          })}
        </SettingList>
      </SettingGroup>
      <Privacy {...props} />
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
