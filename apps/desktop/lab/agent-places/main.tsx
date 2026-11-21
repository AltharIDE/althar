import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { StrictMode, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { MOST_AT_ONCE } from '@althar/contracts'
import {
  AppVersion,
  Button,
  ControlCenter,
  ControlFoot,
  ControlFootStart,
  ControlSheet,
  Icon,
  IconButton,
  KeepAwake,
  LinkButton,
  ProjectTabs,
  SettingGroup,
  SettingList,
  SettingsLayout,
  SettingsNav,
  SettingSwitch,
} from '@althar/ui'

import { ServicesProvider } from '../../src/renderer/data/services'
import { BoardView } from '../../src/renderer/features/board/BoardView'
import { QuickCards } from '../../src/renderer/features/settings/QuickCards'
import { GROUPS, sectionText } from '../../src/renderer/features/settings/sections'
import { text as settingsText } from '../../src/renderer/features/settings/text'
import { usePreferences } from '../../src/renderer/shared/usePreferences'
import { agents, fakeClient, fakeHost } from '../../tests/fixtures'
import { servicesFor } from '../../tests/render'
import { boardOf, loadOf, NOW, PROJECTS, type Scene, SCENES, thisMacOf, waitingOf, type Worker, workersOf } from './data'
import { workerSlider } from './directions/meter'
import { P1, P2, P3 } from './directions/peeks'
import type { BarKind, Ctx, Direction, Offer } from './directions/types'
import { ZERO } from './directions/zero'
import { words } from './words'
import s from './lab.module.css'

/*
 * The agent places lab (README.md): one meter in the window's bar for every
 * computer this home's agents work on and this computer's load, and what it
 * opens, on the app's own board, the kit's own window bar and its own
 * settings, with no runtime. Homes stays as it is. The bar along the bottom,
 * or its keys, swaps the take in place (0 as built, 1–3 what the meter
 * opens), what the meter draws (Z X C), the scene (Q W E R T Y), only this
 * Mac (M), crowded (K), a narrow window (N), the Settings tab (S), dark (D),
 * and whether the meter's peek stays open as they change (O). ?open=quick
 * opens the quick settings.
 */

const DIRECTIONS: readonly Direction[] = [ZERO, P1, P2, P3]
const SCENE_KEYS = ['q', 'w', 'e', 'r', 't', 'y'] as const
const BARS: readonly { key: BarKind; kbd: string; label: string; idea: string }[] = [
  {
    key: 'gauges',
    kbd: 'z',
    label: 'AGENTS, CPU, MEM',
    idea: 'The meter: an AGENTS gauge before CPU and MEM, in their manner, one button',
  },
  { key: 'cells', kbd: 'x', label: 'A cell a place', idea: 'The meter: a cell a place, a group a computer, then how many wait' },
  {
    key: 'track',
    kbd: 'c',
    label: 'One track',
    idea: 'The meter: one track, a part a computer, as wide whatever the numbers, then how many wait',
  },
]

/** Work any computer could take that has waited this long, in minutes, with no room for it, brings up Althar Cloud. */
const SUSTAINED = 10

const params = () => new URLSearchParams(location.search)
const read = () => {
  const now = params()
  return {
    d: DIRECTIONS.find((one) => one.key === now.get('d'))?.key ?? P1.key,
    b: BARS.find((one) => one.key === now.get('b'))?.key ?? 'gauges',
    o: now.get('o') !== '0',
    m: now.get('m') === '1',
    p: (SCENES.find((one) => one.key === now.get('p'))?.key ?? 'mac') as Scene,
    k: now.get('k') === '1',
    n: now.get('n') === '1',
    dark: now.get('theme') === 'dark',
    screen: (now.get('screen') === 'settings' ? 'settings' : 'board') as 'board' | 'settings',
  }
}
type State = ReturnType<typeof read>

const opened = params().get('open')
if (params().get('shot') === '1') document.documentElement.dataset.shot = ''

function Gear({ ctx, direction, onAll }: { ctx: Ctx; direction: Direction; onAll: () => void }) {
  const preferences = usePreferences()
  return (
    <ControlCenter
      trigger={<IconButton icon="gear" label={settingsText.gear} kbd={settingsText.kbd} size="small" />}
      open={ctx.quick.open}
      onOpenChange={ctx.quick.set}
      text={{ label: settingsText.quick }}
    >
      <div className={s.quick}>
        <QuickCards preferences={preferences} sounds={[]} onSection={onAll} />
        <ControlSheet>{direction.quick(ctx)}</ControlSheet>
      </div>
      <ControlFoot>
        <ControlFootStart>
          <AppVersion version="0.9.4" notes="https://althar.dev/changelog" text={{ name: settingsText.version }} />
          <LinkButton>{settingsText.report}</LinkButton>
        </ControlFootStart>
        <Button
          size="small"
          icon="gear"
          kbd={settingsText.allKbd}
          onClick={() => {
            ctx.quick.set(false)
            onAll()
          }}
        >
          {settingsText.all}
        </Button>
      </ControlFoot>
    </ControlCenter>
  )
}

/** Each other computer's number, and the cloud's, under this computer's. */
function OtherComputers({ ctx }: { ctx: Ctx }) {
  const others = ctx.workers.filter((one) => one.kind !== 'this')
  if (others.length === 0) return null
  return (
    <SettingGroup
      title={words.otherComputers}
      action={<LinkButton onClick={() => ctx.say('Opens Add a computer')}>{words.addComputer.replace('…', '')}</LinkButton>}
    >
      <SettingList>
        {others.map((one) => (
          <div key={one.id}>{workerSlider(ctx, one, false, `${words.title} on ${one.name}`)}</div>
        ))}
      </SettingList>
    </SettingGroup>
  )
}

function SettingsScreen({ ctx, direction }: { ctx: Ctx; direction: Direction }) {
  const preferences = usePreferences()
  return (
    <SettingsLayout
      section="this-mac"
      title={sectionText['this-mac'].title}
      side={
        <>
          <QuickCards side preferences={preferences} sounds={[]} onSection={() => undefined} />
          <SettingsNav
            label="Settings"
            groups={GROUPS.map((group) => group.map((id) => ({ id, title: sectionText[id].title, icon: sectionText[id].icon })))}
            value="this-mac"
            onChange={() => undefined}
          />
        </>
      }
    >
      <SettingList>
        <KeepAwake
          on
          onChange={() => undefined}
          onBattery={false}
          onBatteryChange={() => undefined}
          text={{ title: settingsText.awakeTitle, note: settingsText.awakeNote }}
        />
        {direction.settings(ctx)}
        {/* in a take, the switch hides the one meter: the agents and this computer's load */}
        <SettingSwitch
          title={direction === ZERO ? settingsText.loadTitle : words.showMeter}
          glyph={<Icon name="load" size={15} />}
          checked
          onChange={() => undefined}
        />
        <SettingSwitch
          title={settingsText.atLoginTitle}
          note={settingsText.atLoginNote}
          glyph={<Icon name="automation" size={15} />}
          checked={false}
          onChange={() => undefined}
        />
        <SettingSwitch
          title={settingsText.pauseAllTitle}
          note={settingsText.pauseAllNote}
          glyph={<Icon name="hold" size={15} />}
          checked={false}
          onChange={() => undefined}
        />
      </SettingList>
      {direction !== ZERO && <OtherComputers ctx={ctx} />}
    </SettingsLayout>
  )
}

function Lab() {
  const [state, setStateNow] = useState(read)
  const [own, setOwn] = useState<Readonly<Record<string, number | null>>>({})
  const first = read()
  const [peek, setPeek] = useState(first.o && first.d !== ZERO.key && opened !== 'quick')
  const [quick, setQuick] = useState(opened === 'quick')
  const [said, setSaid] = useState<string | null>(null)
  const services = useMemo(() => servicesFor(fakeClient().client, fakeHost()), [])
  const direction = DIRECTIONS.find((one) => one.key === state.d)!

  const set = (next: Partial<State>) => {
    const merged = { ...state, ...next }
    const url = params()
    url.set('d', merged.d)
    url.set('b', merged.b)
    url.set('p', merged.p)
    for (const [key, on] of [
      ['k', merged.k],
      ['n', merged.n],
      ['m', merged.m],
    ] as const)
      if (on) url.set(key, '1')
      else url.delete(key)
    if (merged.dark) url.set('theme', 'dark')
    else url.delete('theme')
    if (merged.screen === 'settings') url.set('screen', 'settings')
    else url.delete('screen')
    if (merged.o) url.delete('o')
    else url.set('o', '0')
    url.delete('open')
    history.replaceState(null, '', `?${url.toString()}`)
    if (next.p !== undefined || next.k !== undefined) setOwn({})
    setPeek(merged.o && merged.d !== ZERO.key)
    setQuick(false)
    setStateNow(merged)
  }

  useEffect(() => {
    document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'
  }, [state.dark])

  // The scene's workers, each with the person's own number where they moved its slider: lowered for now still lowers it.
  const workers = useMemo(
    () =>
      workersOf(state.p, state.k, state.m).map((one): Worker => {
        const n = own[one.id]
        if (n === undefined || n === null) return one
        const base = one.places
        return { ...one, places: { ...base, configured: n, atOnce: base.why === null ? n : Math.min(base.atOnce, n), own: true } }
      }),
    [state.p, state.k, state.m, own],
  )
  const here = thisMacOf(workers)
  const places = here.places
  const count = places.configured
  // Drawn again only when what it shows changes: the board moves its cards on a new one.
  const board = useMemo(() => {
    const all = boardOf(workers, state.k)
    // As built, the board draws this computer's places itself; each take draws its own.
    if (state.d === '0') return { lanes: all.lanes, pinned: [] }
    const { workPlaces: _, ...rest } = all.lanes
    return { lanes: rest, pinned: all.pinned }
  }, [workers, state.d, state.k])
  const lanes = board.lanes
  const load = loadOf(state.p, places, state.k)
  const waiting = waitingOf(workers, state.k)
  // Althar Cloud, where work any computer could take has waited a while with no room for it: to set up, or its cap to raise.
  const offer: Offer = (() => {
    const any = waiting.filter((one) => one.only === null)
    if (any.length === 0 || Math.max(...any.map((one) => one.minutes)) < SUSTAINED) return null
    const cloud = workers.find((one) => one.kind === 'cloud')
    if (cloud === undefined) return { kind: 'setup', waiting: any }
    if (cloud.spend === null) return null
    if (cloud.places.why === 'cap') return { kind: 'raise', waiting: any, resets: cloud.spend.resets }
    if (cloud.places.held.length >= cloud.places.atOnce) return { kind: 'more', waiting: any, month: words.quietOf(cloud) ?? '' }
    return null
  })()

  const say = (what: string) => {
    setSaid(what)
    setTimeout(() => setSaid((was) => (was === what ? null : was)), 2200)
  }
  const titleOf = (id: string) =>
    workers.flatMap((one) => [...one.places.held, ...one.pinned]).find((one) => one.taskId === id)?.title ??
    [...lanes.next, ...lanes.running, ...lanes.settled, ...lanes.waiting.map((one) => one.task)].find(
      (one) => one.taskId === id || one.threadId === id,
    )?.title ??
    id

  const ctx: Ctx = {
    workers,
    here,
    places,
    load,
    bar: state.b,
    waiting,
    offer,
    count,
    most: MOST_AT_ONCE,
    setCount: (n) => setOwn((was) => ({ ...was, [here.id]: n })),
    setCountOf: (id, n) => setOwn((was) => ({ ...was, [id]: n })),
    onOpen: (taskId) => say(`Opens ${titleOf(taskId)}`),
    say,
    peek: { open: peek, set: setPeek },
    quick: { open: quick, set: setQuick },
  }

  const boardKey = `${state.d}-${state.p}-${state.k}-${state.m}-${state.n}-${workers.map((one) => one.places.configured).join('.')}`

  // Lab only: a row of Up next that can start on one worker alone says which, in place of the board's words.
  useLayoutEffect(() => {
    for (const { taskId, worker } of board.pinned) {
      const at = document.querySelector(`[data-move="${taskId}"] [class*="NextRow-module__words"]`)
      if (at !== null) at.textContent = words.waitsFor(worker)
    }
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const found = DIRECTIONS.find((one) => one.kbd === key)
      if (found !== undefined) return set({ d: found.key })
      const scene = SCENES[SCENE_KEYS.indexOf(key as (typeof SCENE_KEYS)[number])]
      if (scene !== undefined) return set({ p: scene.key })
      const bar = BARS.find((one) => one.kbd === key)
      if (bar !== undefined) return set({ b: bar.key })
      if (key === 'm') return set({ m: !state.m })
      if (key === 'k') return set({ k: !state.k })
      if (key === 'n') return set({ n: !state.n })
      if (key === 'd') return set({ dark: !state.dark })
      if (key === 'o') return set({ o: !state.o })
      if (key === 's') return set({ screen: state.screen === 'board' ? 'settings' : 'board' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <ServicesProvider value={services}>
      <div className={s.lab}>
        <div className={s.desk}>
          <div className={s.window} data-narrow={state.n || undefined}>
            <ProjectTabs
              tabs={PROJECTS.map((project, i) => ({
                id: project.id,
                name: project.name,
                seed: project.id,
                ink: project.ink,
                running: workers.some((one) => one.places.held.some((held) => held.project === project.name)),
                yours: i === 0 ? 1 : 0,
              }))}
              current={state.screen === 'settings' ? null : 'meridian'}
              {...(state.screen === 'settings'
                ? { settings: { current: true, onSelect: () => undefined, onClose: () => set({ screen: 'board' }) } }
                : {})}
              onSelect={(id) => {
                if (id === 'meridian') set({ screen: 'board' })
              }}
              onClose={() => undefined}
              lights="space"
              end={
                <>
                  {direction.bar(ctx)}
                  <Gear ctx={ctx} direction={direction} onAll={() => set({ screen: 'settings' })} />
                </>
              }
            />
            <div className={s.screen}>
              {state.screen === 'board' ? (
                <div className={s.board}>
                  <BoardView key={boardKey} lanes={lanes} agents={agents} now={NOW} onOpen={(threadId) => ctx.onOpen(threadId)} />
                </div>
              ) : (
                <SettingsScreen ctx={ctx} direction={direction} />
              )}
            </div>
          </div>
        </div>
        <div className={s.bar} role="toolbar" aria-label="Directions">
          {DIRECTIONS.map((one) => (
            <button key={one.key} type="button" aria-pressed={state.d === one.key} onClick={() => set({ d: one.key })} title={one.idea}>
              <kbd>{one.kbd}</kbd>
              {one.label}
            </button>
          ))}
          <span className={s.rule} />
          {BARS.map((one) => (
            <button key={one.key} type="button" aria-pressed={state.b === one.key} onClick={() => set({ b: one.key })} title={one.idea}>
              <kbd>{one.kbd.toUpperCase()}</kbd>
              {one.label}
            </button>
          ))}
          <span className={s.rule} />
          {SCENES.map((one, i) => (
            <button key={one.key} type="button" aria-pressed={state.p === one.key} onClick={() => set({ p: one.key })}>
              <kbd>{SCENE_KEYS[i]!.toUpperCase()}</kbd>
              {one.label}
            </button>
          ))}
          <span className={s.rule} />
          <button type="button" aria-pressed={state.m} onClick={() => set({ m: !state.m })}>
            <kbd>M</kbd>Only this Mac
          </button>
          <button type="button" aria-pressed={state.k} onClick={() => set({ k: !state.k })}>
            <kbd>K</kbd>Crowded
          </button>
          <button type="button" aria-pressed={state.n} onClick={() => set({ n: !state.n })}>
            <kbd>N</kbd>Narrow
          </button>
          <button
            type="button"
            aria-pressed={state.screen === 'settings'}
            onClick={() => set({ screen: state.screen === 'board' ? 'settings' : 'board' })}
          >
            <kbd>S</kbd>Settings
          </button>
          <button type="button" aria-pressed={state.dark} onClick={() => set({ dark: !state.dark })}>
            <kbd>D</kbd>Dark
          </button>
          <button type="button" aria-pressed={state.o} onClick={() => set({ o: !state.o })}>
            <kbd>O</kbd>Peek open
          </button>
          <span className={s.gap} />
          <span className={s.idea} title={direction.idea}>
            {said ?? direction.idea}
          </span>
        </div>
      </div>
    </ServicesProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
)
