import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { StrictMode, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
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
import { boardOf, loadOf, NOW, placesOf, PROJECTS, type Scene, SCENES, waitingOf } from './data'
import { A, B, C } from './takes/takes'
import type { Ctx, Take } from './takes/types'
import { ZERO } from './takes/zero'
import { words } from './words'
import s from './lab.module.css'

/*
 * The agent places lab (README.md): where this computer's agents live once the
 * board's banner over Up next goes, by This Mac (the CPU and MEM meter and
 * what it opens) and the Agents at once slider, on the app's own board, the
 * kit's own window bar and its own settings, with no runtime. The bar along
 * the bottom, or its keys, swaps in place: the take (0 as built, A B C), the
 * scene (Q W E R), one line back in Up next (U), crowded (K), a narrow window
 * (N), the Settings tab (S), dark (D), and whether the meter's popover stays
 * open as they change (O). G opens the quick settings.
 */

const TAKES: readonly Take[] = [ZERO, A, B, C]
const SCENE_KEYS = ['q', 'w', 'e', 'r'] as const

const params = () => new URLSearchParams(location.search)
const read = () => {
  const now = params()
  return {
    d: TAKES.find((one) => one.key === now.get('d'))?.key ?? A.key,
    p: (SCENES.find((one) => one.key === now.get('p'))?.key ?? 'memory') as Scene,
    o: now.get('o') !== '0',
    u: now.get('u') === '1',
    k: now.get('k') === '1',
    n: now.get('n') === '1',
    dark: now.get('theme') === 'dark',
    screen: (now.get('screen') === 'settings' ? 'settings' : 'board') as 'board' | 'settings',
  }
}
type State = ReturnType<typeof read>

const opened = params().get('open')
if (params().get('shot') === '1') document.documentElement.dataset.shot = ''

function Gear({ ctx, take, onAll }: { ctx: Ctx; take: Take; onAll: () => void }) {
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
        <ControlSheet>{take.slider(ctx, true)}</ControlSheet>
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

function SettingsScreen({ ctx, take }: { ctx: Ctx; take: Take }) {
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
        {take.slider(ctx, false)}
        {/* in A, the switch takes the one meter out: the agents and this computer's load */}
        <SettingSwitch
          title={take === A ? words.showMeter : settingsText.loadTitle}
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
    </SettingsLayout>
  )
}

/**
 * Lab only: the one line Up next may keep, at the end of its heading, where the board has no room for it; it opens
 * the meter's popover. Nothing while there's room.
 */
function UpNextLine({ ctx, version }: { ctx: Ctx; version: string }) {
  const [at, setAt] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const title = document.querySelector('section[data-lane="next"] header h2')
    if (title === null) return
    const span = document.createElement('span')
    title.after(span)
    setAt(span)
    return () => {
      span.remove()
      setAt(null)
    }
  }, [version])
  const line = words.upNext(ctx.places)
  if (at === null || line === null) return null
  return createPortal(
    <button type="button" className={s.upNext} onClick={() => ctx.peek.set(true)}>
      {line}
    </button>,
    at,
  )
}

function Lab() {
  const [state, setStateNow] = useState(read)
  const [own, setOwn] = useState<number | null>(null)
  const first = read()
  const [peek, setPeek] = useState(first.o && first.d !== ZERO.key && first.screen === 'board' && opened !== 'quick')
  const [quick, setQuick] = useState(opened === 'quick')
  const [said, setSaid] = useState<string | null>(null)
  const services = useMemo(() => servicesFor(fakeClient().client, fakeHost()), [])
  const take = TAKES.find((one) => one.key === state.d)!

  const set = (next: Partial<State>) => {
    const merged = { ...state, ...next }
    const url = params()
    url.set('d', merged.d)
    url.set('p', merged.p)
    for (const [key, on] of [
      ['u', merged.u],
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
    setPeek(merged.o && merged.d !== ZERO.key && merged.screen === 'board')
    setQuick(false)
    setStateNow(merged)
  }

  useEffect(() => {
    document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'
  }, [state.dark])

  // The scene's agents, with the person's own number where they moved the slider: lowered for now still lowers it.
  const places = useMemo(() => {
    const base = placesOf(state.p, state.k)
    if (own === null) return base
    return { ...base, configured: own, atOnce: base.why === null ? own : Math.min(base.atOnce, own) }
  }, [state.p, state.k, own])
  const waiting = useMemo(() => waitingOf(places, state.k), [places, state.k])
  // Drawn again only when what it shows changes: the board moves its cards on a new one.
  const lanes = useMemo(() => boardOf(places, waiting, state.d === ZERO.key), [places, waiting, state.d])
  const load = loadOf(state.p, places, state.k)

  const say = (what: string) => {
    setSaid(what)
    setTimeout(() => setSaid((was) => (was === what ? null : was)), 2200)
  }
  const titleOf = (id: string) =>
    places.agents.find((one) => one.taskId === id)?.title ?? waiting.find((one) => one.taskId === id)?.title ?? id

  const ctx: Ctx = {
    places,
    load,
    waiting,
    most: MOST_AT_ONCE,
    setCount: setOwn,
    onOpen: (id) => say(`Opens ${titleOf(id)}`),
    say,
    peek: { open: peek, set: setPeek },
    quick: { open: quick, set: setQuick },
  }

  const boardKey = `${state.d}-${state.p}-${state.k}-${state.n}-${places.configured}`

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const found = TAKES.find((one) => one.kbd === key)
      if (found !== undefined) return set({ d: found.key })
      const scene = SCENES[SCENE_KEYS.indexOf(key as (typeof SCENE_KEYS)[number])]
      if (scene !== undefined) return set({ p: scene.key })
      if (key === 'u') return set({ u: !state.u })
      if (key === 'k') return set({ k: !state.k })
      if (key === 'n') return set({ n: !state.n })
      if (key === 'd') return set({ dark: !state.dark })
      if (key === 'o') return set({ o: !state.o })
      if (key === 's') return set({ screen: state.screen === 'board' ? 'settings' : 'board' })
      if (key === 'g') {
        setPeek(false)
        setQuick((was) => !was)
      }
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
                running: places.agents.some((one) => one.project === project.name),
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
                  {take.bar(ctx)}
                  <Gear ctx={ctx} take={take} onAll={() => set({ screen: 'settings' })} />
                </>
              }
            />
            <div className={s.screen}>
              {state.screen === 'board' ? (
                <div className={s.board}>
                  <BoardView
                    key={boardKey}
                    lanes={lanes}
                    agents={agents}
                    now={NOW}
                    onOpen={(threadId) => ctx.onOpen(threadId.replace(/^th-/, ''))}
                  />
                  {state.u && take !== ZERO && <UpNextLine ctx={ctx} version={boardKey} />}
                </div>
              ) : (
                <SettingsScreen ctx={ctx} take={take} />
              )}
            </div>
          </div>
        </div>
        <div className={s.bar} role="toolbar" aria-label="Takes">
          {TAKES.map((one) => (
            <button key={one.key} type="button" aria-pressed={state.d === one.key} onClick={() => set({ d: one.key })} title={one.idea}>
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
          <button
            type="button"
            aria-pressed={state.u}
            onClick={() => set({ u: !state.u })}
            title="Up next keeps one line, at the end of its heading"
          >
            <kbd>U</kbd>Up next line
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
            <kbd>O</kbd>Popover open
          </button>
          <span className={s.gap} />
          <span className={s.idea} title={take.idea}>
            {said ?? take.idea}
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
