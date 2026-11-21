import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { StrictMode, useEffect, useMemo, useState } from 'react'
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
import { boardOf, loadOf, NOW, placesOf, PROJECTS, type Scene, SCENES } from './data'
import { P1, P2, P3, P4 } from './directions/popovers'
import type { Ctx, Direction } from './directions/types'
import { ZERO } from './directions/zero'
import s from './lab.module.css'

/*
 * The agent places lab (README.md): This Mac's chip, its places beside its
 * name, and what it opens, on the app's own board, the kit's own window bar
 * and its own settings, with no runtime. The bar along the bottom, or its
 * keys, swaps the take in place (0 as built, 1–4 what the chip opens), the
 * scene (Q W E R), crowded (K), a narrow window (N), the Settings tab (S),
 * dark (D), and whether the chip's popover stays open as they change (O).
 * ?open=quick opens the quick settings.
 */

const DIRECTIONS: readonly Direction[] = [ZERO, P1, P2, P3, P4]
const SCENE_KEYS = ['q', 'w', 'e', 'r'] as const

const params = () => new URLSearchParams(location.search)
const read = () => {
  const now = params()
  return {
    d: DIRECTIONS.find((one) => one.key === now.get('d'))?.key ?? P1.key,
    o: now.get('o') !== '0',
    p: (SCENES.find((one) => one.key === now.get('p'))?.key ?? 'memory') as Scene,
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
        <SettingSwitch title={settingsText.loadTitle} glyph={<Icon name="load" size={15} />} checked onChange={() => undefined} />
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
    </SettingsLayout>
  )
}

function Lab() {
  const [state, setStateNow] = useState(read)
  const [own, setOwn] = useState<number | null>(null)
  const first = read()
  const [mac, setMac] = useState<string | null>(first.o && first.d !== ZERO.key && opened !== 'quick' ? 'bar' : null)
  const [quick, setQuick] = useState(opened === 'quick')
  const [said, setSaid] = useState<string | null>(null)
  const services = useMemo(() => servicesFor(fakeClient().client, fakeHost()), [])
  const direction = DIRECTIONS.find((one) => one.key === state.d)!

  const set = (next: Partial<State>) => {
    const merged = { ...state, ...next }
    const url = params()
    url.set('d', merged.d)
    url.set('p', merged.p)
    for (const [key, on] of [
      ['k', merged.k],
      ['n', merged.n],
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
    if (next.p !== undefined || next.k !== undefined) setOwn(null)
    setMac(merged.o && merged.d !== ZERO.key ? 'bar' : null)
    setQuick(false)
    setStateNow(merged)
  }

  useEffect(() => {
    document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'
  }, [state.dark])

  // The scene's places, with the person's own number where they moved the slider: lowered for now still lowers it.
  const places = useMemo(() => {
    const base = placesOf(state.p, state.k)
    const n = own ?? base.configured
    return { ...base, configured: n, atOnce: base.why === null ? n : Math.min(base.atOnce, n), own: own !== null }
  }, [state.p, state.k, own])
  const count = places.configured
  // Drawn again only when what it shows changes: the board moves its cards on a new one.
  const lanes = useMemo(() => {
    const all = boardOf(places, state.k)
    // As built, the board draws the places itself; each direction draws its own take.
    if (state.d === '0') return all
    const { workPlaces: _, ...rest } = all
    return rest
  }, [places, state.d, state.k])
  const load = loadOf(state.p, places, state.k)

  const say = (what: string) => {
    setSaid(what)
    setTimeout(() => setSaid((was) => (was === what ? null : was)), 2200)
  }
  const titleOf = (id: string) =>
    places.held.find((one) => one.taskId === id)?.title ??
    [...lanes.next, ...lanes.running, ...lanes.settled, ...lanes.waiting.map((one) => one.task)].find(
      (one) => one.taskId === id || one.threadId === id,
    )?.title ??
    id

  const ctx: Ctx = {
    places,
    load,
    count,
    most: MOST_AT_ONCE,
    setCount: (n) => setOwn(n),
    onOpen: (taskId) => say(`Opens ${titleOf(taskId)}`),
    mac: { open: mac, set: setMac },
    quick: { open: quick, set: setQuick },
  }

  const boardKey = `${state.d}-${state.p}-${state.k}-${state.n}-${count}`

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const found = DIRECTIONS.find((one) => one.kbd === key)
      if (found !== undefined) return set({ d: found.key })
      const scene = SCENES[SCENE_KEYS.indexOf(key as (typeof SCENE_KEYS)[number])]
      if (scene !== undefined) return set({ p: scene.key })
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
                running: places.held.some((one) => one.project === project.name),
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
          {SCENES.map((one, i) => (
            <button key={one.key} type="button" aria-pressed={state.p === one.key} onClick={() => set({ p: one.key })}>
              <kbd>{SCENE_KEYS[i]!.toUpperCase()}</kbd>
              {one.label}
            </button>
          ))}
          <span className={s.rule} />
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
            <kbd>O</kbd>Popover open
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
