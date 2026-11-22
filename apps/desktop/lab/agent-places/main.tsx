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
  IconButton,
  LinkButton,
  ProjectTabs,
  SettingsLayout,
} from '@althar/ui'

import { ServicesProvider } from '../../src/renderer/data/services'
import { BoardView } from '../../src/renderer/features/board/BoardView'
import { QuickCards } from '../../src/renderer/features/settings/QuickCards'
import { text as settingsText } from '../../src/renderer/features/settings/text'
import { usePreferences } from '../../src/renderer/shared/usePreferences'
import { agents, fakeClient, fakeHost } from '../../tests/fixtures'
import { servicesFor } from '../../tests/render'
import { bar, quick } from './base'
import {
  boardOf,
  loadOf,
  NOW,
  type Pov,
  PROJECTS,
  type Runners,
  runnersOf,
  type Scene,
  SCENES,
  waitingOf,
  type Worker,
  workersOf,
} from './data'
import { AddComputer } from './settings/pieces'
import { at, pageOf, side, TAKES } from './settings/takes'
import type { Ctx, Place, Take } from './types'
import s from './lab.module.css'

/*
 * The agent places lab (README.md): Settings › Computers, B's modules, and
 * three ways to tell the computers apart. The base is what was picked (the
 * home's popover with the other computers under it, the quick settings'
 * slider with a row for each). The bar along the bottom, or its keys, swaps
 * in place: the take (A B C), the home (1 This Mac, 2 studio, 3 hosted in
 * Althar Cloud), its cloud runners (U), the scene (Q W E R), crowded (K), the
 * home alone (M), a narrow window (N), the board or Settings (S), dark (D);
 * G opens the quick settings, P the home's popover.
 */

const SCENE_KEYS = ['q', 'w', 'e', 'r'] as const
const HOMES = [
  { key: 'mac', pov: 'local', label: 'This Mac' },
  { key: 'studio', pov: 'remote', label: 'studio' },
  { key: 'cloud', pov: 'cloud', label: 'Cloud' },
] as const satisfies readonly { key: string; pov: Pov; label: string }[]
type Home = (typeof HOMES)[number]['key']

const params = () => new URLSearchParams(location.search)
const read = () => {
  const now = params()
  return {
    d: TAKES.find((one) => one.key === now.get('d'))?.key ?? 'a',
    p: (SCENES.find((one) => one.key === now.get('p'))?.key ?? 'memory') as Scene,
    h: (HOMES.find((one) => one.key === now.get('h'))?.key ?? 'mac') as Home,
    u: now.get('u') === '1',
    l: now.get('l') === '1',
    k: now.get('k') === '1',
    m: now.get('m') === '1',
    n: now.get('n') === '1',
    dark: now.get('theme') === 'dark',
    screen: (now.get('screen') === 'board' ? 'board' : 'settings') as 'board' | 'settings',
    sec: now.get('sec'),
    w: now.get('w'),
  }
}
type State = ReturnType<typeof read>

if (params().get('shot') === '1') document.documentElement.dataset.shot = ''

function Gear({ ctx, onAll }: { ctx: Ctx; onAll: () => void }) {
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
        <ControlSheet>{quick(ctx)}</ControlSheet>
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

function SettingsScreen({ ctx, take, place, go }: { ctx: Ctx; take: Take; place: Place; go: (place: Place) => void }) {
  const preferences = usePreferences()
  const page = pageOf(ctx, take.style, place, go) ?? pageOf(ctx, take.style, at(null), go)!
  return (
    <SettingsLayout
      section={place.section}
      title={page.title}
      {...(page.lede === undefined ? {} : { lede: page.lede })}
      side={side(ctx, place, go, <QuickCards side preferences={preferences} sounds={[]} onSection={() => undefined} />)}
    >
      {page.body}
    </SettingsLayout>
  )
}

function Lab() {
  const [state, setStateNow] = useState(read)
  // Each worker's own number, where the person moved its slider, and those taking no new tasks.
  const [own, setOwn] = useState<Record<string, number | null>>({})
  const [paused, setPaused] = useState<ReadonlySet<string>>(new Set())
  // The runners' own number, whether they start by themselves, and the month's limit.
  const [runnersOwn, setRunnersOwn] = useState<number | null>(null)
  const [auto, setAuto] = useState(true)
  const [limit, setLimit] = useState<number | null>(40)
  const [open, setOpen] = useState({ peek: params().get('open') === 'peek', quick: params().get('open') === 'quick' })
  const [adding, setAdding] = useState(params().get('open') === 'add')
  const [said, setSaid] = useState<string | null>(null)
  const services = useMemo(() => servicesFor(fakeClient().client, fakeHost()), [])
  const take = TAKES.find((one) => one.key === state.d)!

  const set = (next: Partial<State>) => {
    const merged = { ...state, ...next }
    const url = params()
    url.set('d', merged.d)
    url.set('p', merged.p)
    if (merged.h === 'mac') url.delete('h')
    else url.set('h', merged.h)
    for (const [key, on] of [
      ['u', merged.u],
      ['l', merged.l],
      ['k', merged.k],
      ['m', merged.m],
      ['n', merged.n],
    ] as const)
      if (on) url.set(key, '1')
      else url.delete(key)
    if (merged.dark) url.set('theme', 'dark')
    else url.delete('theme')
    if (merged.screen === 'board') url.set('screen', 'board')
    else url.delete('screen')
    for (const [key, value] of [
      ['sec', merged.sec],
      ['w', merged.w],
    ] as const)
      if (value === null) url.delete(key)
      else url.set(key, value)
    url.delete('open')
    history.replaceState(null, '', `?${url.toString()}`)
    if (next.p !== undefined || next.k !== undefined || next.h !== undefined) {
      setOwn({})
      setRunnersOwn(null)
    }
    setStateNow(merged)
  }

  useEffect(() => {
    document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'
  }, [state.dark])

  const pov = HOMES.find((one) => one.key === state.h)!.pov
  // Hosted in Althar Cloud, the home's agents run on its runners: it has them whatever U says.
  const withRunners = state.u || pov === 'cloud'

  // The scene's workers, with the person's own numbers where they moved a slider: lowered for now still lowers it.
  const { workers, mac } = useMemo(() => {
    const mine = (one: Worker): Worker => {
      const n = own[one.id]
      if (n === undefined) return one
      const configured = n ?? one.machine.count
      return { ...one, configured, atOnce: one.why === null ? configured : Math.min(one.atOnce, configured) }
    }
    const found = workersOf(state.p, state.k, state.m, pov, state.l)
    return { workers: found.workers.map(mine), mac: mine(found.mac) }
  }, [state.p, state.k, state.m, pov, state.l, own])
  const home = workers[0]!
  const runners = useMemo((): Runners | null => {
    if (!withRunners) return null
    const found = runnersOf(state.p, state.k)
    return { ...found, atOnce: runnersOwn ?? found.suggested, auto, limit }
  }, [withRunners, state.p, state.k, runnersOwn, auto, limit])
  const waiting = useMemo(() => waitingOf(workers, runners, state.k), [workers, runners, state.k])
  // Drawn again only when what it shows changes: the board moves its cards on a new one.
  const lanes = useMemo(() => boardOf(workers, runners, waiting), [workers, runners, waiting])
  const loads = useMemo(() => new Map([...workers, mac].map((one) => [one.id, loadOf(one)])), [workers, mac])

  const say = (what: string) => {
    setSaid(what)
    setTimeout(() => setSaid((was) => (was === what ? null : was)), 2600)
  }
  const titleOf = (id: string) =>
    [...workers.flatMap((one) => one.agents), ...(runners?.running ?? []), ...waiting].find((one) => one.taskId === id)?.title ?? id

  const ctx: Ctx = {
    pov,
    workers,
    home,
    mac,
    load: loads.get(home.id)!,
    loadOf: (worker) => loads.get(worker.id) ?? loadOf(worker),
    waiting,
    most: MOST_AT_ONCE,
    setCount: (id, n) => setOwn((was) => ({ ...was, [id]: n })),
    taking: (id) => !paused.has(id),
    setTaking: (id, on) =>
      setPaused((was) => {
        const next = new Set(was)
        if (on) next.delete(id)
        else next.add(id)
        return next
      }),
    lent: state.l,
    setLent: (on) => set({ l: on }),
    runners,
    setRunners: setRunnersOwn,
    setAuto,
    setLimit,
    onOpen: (id) => say(`Opens ${titleOf(id)}`),
    say,
    peek: { open: open.peek, set: (on) => setOpen((was) => ({ ...was, peek: on, ...(on ? { quick: false } : {}) })) },
    quick: { open: open.quick, set: (on) => setOpen((was) => ({ ...was, quick: on, ...(on ? { peek: false } : {}) })) },
    settings: (worker) => {
      setOpen({ peek: false, quick: false })
      const where = at(worker ?? null)
      set({ screen: 'settings', sec: where.section, w: where.worker })
      if (worker !== undefined)
        requestAnimationFrame(() => document.getElementById(`worker-${worker}`)?.scrollIntoView({ block: 'center' }))
    },
    add: () => setAdding(true),
  }

  // Where Settings is: as the address says, or where the take opens.
  const place: Place = state.sec === null ? at(null) : { section: state.sec, worker: state.w }
  const go = (next: Place) => set({ sec: next.section, w: next.worker })

  const boardKey = `${state.p}-${state.k}-${state.m}-${state.h}-${withRunners}-${state.n}-${home.configured}`

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const found = TAKES.find((one) => one.kbd === key)
      if (found !== undefined) return set({ d: found.key, sec: null, w: null })
      const scene = SCENES[SCENE_KEYS.indexOf(key as (typeof SCENE_KEYS)[number])]
      if (scene !== undefined) return set({ p: scene.key })
      const homeAt = HOMES[Number(key) - 1]
      if (homeAt !== undefined) return set({ h: homeAt.key, sec: null, w: null })
      if (key === 'u') return set({ u: !state.u, sec: null, w: null })
      if (key === 'k') return set({ k: !state.k })
      if (key === 'm') return set({ m: !state.m })
      if (key === 'n') return set({ n: !state.n })
      if (key === 'd') return set({ dark: !state.dark })
      if (key === 's') return set({ screen: state.screen === 'board' ? 'settings' : 'board' })
      if (key === 'g') ctx.quick.set(!open.quick)
      if (key === 'p') {
        if (state.screen !== 'board') set({ screen: 'board' })
        ctx.peek.set(!open.peek)
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
                running: workers.some((one) => one.agents.some((agent) => agent.project === project.name)),
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
                  {bar(ctx)}
                  <Gear ctx={ctx} onAll={() => ctx.settings()} />
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
                </div>
              ) : (
                <SettingsScreen ctx={ctx} take={take} place={place} go={go} />
              )}
            </div>
          </div>
        </div>
        {adding && <AddComputer ctx={ctx} onClose={() => setAdding(false)} />}
        {said !== null && <output className={s.said}>{said}</output>}
        <div className={s.bar} role="toolbar" aria-label="Takes">
          {TAKES.map((one) => (
            <button
              key={one.key}
              type="button"
              aria-pressed={state.d === one.key}
              onClick={() => set({ d: one.key, sec: null, w: null })}
              title={one.idea}
            >
              <kbd>{one.kbd.toUpperCase()}</kbd>
              {one.label}
            </button>
          ))}
          <span className={s.rule} />
          {HOMES.map((one, i) => (
            <button key={one.key} type="button" aria-pressed={state.h === one.key} onClick={() => set({ h: one.key, sec: null, w: null })}>
              <kbd>{i + 1}</kbd>
              {one.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={withRunners}
            disabled={pov === 'cloud'}
            onClick={() => set({ u: !state.u, sec: null, w: null })}
            title="The home’s cloud runners; hosted in Althar Cloud, it always has them"
          >
            <kbd>U</kbd>Runners
          </button>
          <span className={s.rule} />
          {SCENES.map((one, i) => (
            <button key={one.key} type="button" aria-pressed={state.p === one.key} onClick={() => set({ p: one.key })}>
              <kbd>{SCENE_KEYS[i]!.toUpperCase()}</kbd>
              {one.label}
            </button>
          ))}
          <span className={s.rule} />
          {(
            [
              ['K', 'Crowded', state.k, () => set({ k: !state.k })],
              ['M', 'Alone', state.m, () => set({ m: !state.m })],
              ['N', 'Narrow', state.n, () => set({ n: !state.n })],
              ['S', 'Board', state.screen === 'board', () => set({ screen: state.screen === 'board' ? 'settings' : 'board' })],
              ['D', 'Dark', state.dark, () => set({ dark: !state.dark })],
            ] as const
          ).map(([key, label, on, press]) => (
            <button key={key} type="button" aria-pressed={on} onClick={press}>
              <kbd>{key}</kbd>
              {label}
            </button>
          ))}
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
