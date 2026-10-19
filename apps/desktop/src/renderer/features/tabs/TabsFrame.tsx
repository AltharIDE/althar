import { createContext, type ReactNode, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'

import { LoadMeter, ProjectTabs, Room, TitleBar, UpdateReady, UsageButton } from '@althar/ui'

import { useServices } from '../../data/services'
import { FinderView } from '../finder/FinderView'
import { QuickSettings } from '../settings/QuickSettings'
import { CarriedAtFoot, CarriedBack } from '../../shared/dictation/Carried'
import { UsageView } from '../usage/UsageView'
import { UsageOpenContext, usePlanUsage } from '../usage/useUsage'
import { useWindowChrome } from '../../shared/useWindowChrome'
import { useUpdate } from '../../shared/useUpdate'
import type { Destination } from '../../shared/dictation/sessions'
import { tabsStoreOf } from './store'
import { beside, byNumber } from './tabs'
import s from './Tabs.module.css'
import { SLOTS, text as loadText, useLoad } from './useLoad'
import { useTabs } from './useTabs'

/*
 * Every screen under the window's tabs: the home's, Althar's settings' while
 * they are open, then each open project's. ⌘1 goes to the home, ⌘2 to ⌘8 to
 * the projects in order, ⌘9 to the last, and Control-Tab to the next tab
 * (with Shift, the one before), as in a browser. ⌘N starts a new project in
 * a tab of its own, as the + does. ⌘K finds a task: in the project whose tab
 * has the window, or, on the home, in every project. ⌘U opens plan usage,
 * and again closes it; the bar also always has a way to it, with the count
 * of warnings not yet seen. The tabs are the window's one bar: a screen puts
 * its own controls at the bar's end with BarEnd, and its way back, where it
 * has one, at the top of its page. Before it, on every screen, how hard the
 * computer works, in two short meters the person may turn off (`useLoad`),
 * and a newer Althar ready to install, in one quiet line; after it, at the
 * very end, Althar's settings' gear, whose quick settings ⌘, opens and
 * closes, and whose All settings, or ⌘⇧,, opens the settings' tab. Before
 * there is any project there are no tabs: the first screen has the whole
 * window.
 */

/** The settings' tab among the projects' ids, stepping from tab to tab: no project's id is empty. */
const SETTINGS_STOP = ''

const VisitContext = createContext<(threadId: string, projectId: string) => void>(() => undefined)

/** A new project's tab, as the screens under the tabs reach it. */
export interface NewTab {
  /** Starts one, or goes to the one being made; folders dropped are added to it. */
  readonly start: (files?: ReadonlyArray<File>) => void
  /** It was made: its tab becomes the project's, open on its conversation. */
  readonly made: (projectId: string) => void
  /** It closes, and nothing is made. */
  readonly close: () => void
}

/** Outside the tabs, as a screen is in a test, there is no new project's tab to start. */
export const NewTabContext = createContext<NewTab>({ start: () => undefined, made: () => undefined, close: () => undefined })

/** The new project's tab: starting one, and its end, made or closed. */
export const useNewTab = (): NewTab => useContext(NewTabContext)

/** The end of the window's bar: undefined outside the tabs, null until the bar is drawn. */
const EndContext = createContext<HTMLElement | null | undefined>(undefined)

/** Whether the window's bar is drawn here, so a screen knows not to draw one of its own. */
const TabBarContext = createContext(false)

/** What the screen on show puts at the end of the window's bar; a screen shown without the tabs keeps it in place. */
export function BarEnd({ children }: { children: ReactNode }) {
  const end = useContext(EndContext)
  if (end === undefined) return <div className={s.end}>{children}</div>
  return end === null ? null : createPortal(children, end)
}

/** A task screen says which project its thread is in, once it has read it, so that project's tab has the window. */
export const useVisit = (threadId: string, projectId: string | undefined) => {
  const visit = useContext(VisitContext)
  useEffect(() => {
    if (projectId !== undefined) visit(threadId, projectId)
  }, [visit, threadId, projectId])
}

/**
 * The view a project was last on (null before it was on one), and the way
 * to keep the one it is on now: it opens on it again, from its tab or back
 * from one of its tasks.
 */
export const useLastRoom = (projectId: string): readonly [Room | null, (room: Room) => void] => {
  const store = tabsStoreOf(useServices().client)
  const { kept, pending } = useSyncExternalStore(store.subscribe, store.get)
  const keep = useCallback((room: Room) => store.view(projectId, room), [store, projectId])
  return [kept?.rooms?.[projectId] ?? pending[projectId] ?? null, keep]
}

/**
 * The window's one bar, while there are tabs: the projects, the screen's own
 * end, and the window's own buttons where the system draws none. Its own
 * component, so the maximized-state subscription lives only while it is here.
 */
function TabsBar({
  tabs,
  usage,
  endRef,
  quick,
  onQuick,
}: {
  tabs: ReturnType<typeof useTabs>
  usage: { readonly open: boolean; readonly toggle: () => void }
  endRef: (element: HTMLElement | null) => void
  /** Whether the quick settings are open. */
  quick: boolean
  onQuick: (open: boolean) => void
}) {
  const { host } = useServices()
  const chrome = useWindowChrome()
  const update = useUpdate()
  const load = useLoad(tabs.tabs.length > 0 || tabs.others.length > 0)
  const waiting = usePlanUsage()?.warnings.length ?? 0
  const { select, current } = tabs
  return (
    <ProjectTabs
      tabs={tabs.tabs}
      current={current}
      yours={tabs.yours}
      others={tabs.others}
      {...(tabs.settings.open
        ? { settings: { current: tabs.settings.current, onSelect: () => tabs.openSettings(), onClose: tabs.closeSettings } }
        : {})}
      onSelect={select}
      onClose={tabs.close}
      onReorder={tabs.reorder}
      onOpen={tabs.open}
      onNewProject={tabs.newProject}
      end={
        <>
          {load.glance !== null && (
            <LoadMeter load={load.glance} slots={SLOTS} onOpen={load.open} onHide={load.hide} text={loadText.meter} />
          )}
          {update.ready !== null && <UpdateReady {...update.ready} />}
          <UsageButton waiting={waiting} expanded={usage.open} onClick={usage.toggle} />
          <div ref={endRef} className={s.end} />
          <QuickSettings open={quick} onOpenChange={onQuick} onSettings={tabs.openSettings} />
        </>
      }
      // macOS draws its traffic lights over the bar; elsewhere the bar draws the window's own buttons.
      lights={host.platform === 'darwin' ? 'space' : 'drawn'}
      maximized={chrome.window?.maximized === true}
      onCloseWindow={() => host.window('close')}
      onMinimize={() => host.window('minimize')}
      onToggleMaximize={() => host.window('toggle-maximize')}
    />
  )
}

/**
 * The bar for a screen shown without the tabs: nothing where the window's bar
 * is already there, so a screen on a tabbed route never draws a second one.
 */
export function BareBar({ className }: { className?: string }) {
  const barIsHere = useContext(TabBarContext)
  if (barIsHere) return null
  return <BareTitleBar className={className} />
}

/** The overlay bar itself, subscribing only while it is drawn. */
function BareTitleBar({ className }: { className?: string }) {
  const chrome = useWindowChrome()
  return (
    <TitleBar {...chrome} className={className}>
      {null}
    </TitleBar>
  )
}

export function TabsFrame({ children }: { children: ReactNode }) {
  const tabs = useTabs()
  const { host } = useServices()
  const [end, setEnd] = useState<HTMLElement | null>(null)
  // Finding a task, in the project with the window or on the home in every one; from a composer too.
  const [finding, setFinding] = useState(false)
  // Plan usage, over the window, from any screen.
  const [usage, setUsage] = useState(false)
  const openUsage = useCallback(() => setUsage(true), [])
  // The quick settings, from the gear at the bar's end, and ⌘, on every screen.
  const [quick, setQuick] = useState(false)
  const { select, current, newProject, none, openSettings } = tabs
  const { open: settingsOpen, current: onSettings } = tabs.settings
  const open = tabs.tabs.map((tab) => tab.id)
  const order = open.join(' ')
  const newTab: NewTab = { start: tabs.newProject, made: tabs.made, close: tabs.closeNew }
  // Back to the composer dictation was carried from: the coordinator's conversation, or the task.
  const navigate = useNavigate()
  const back = useCallback(
    (to: Destination['back']) =>
      void (to.kind === 'coordinator'
        ? navigate({ to: '/projects/$projectId', params: { projectId: to.projectId }, search: { room: Room.Talk } })
        : navigate({ to: '/threads/$threadId', params: { threadId: to.threadId } })),
    [navigate],
  )
  useEffect(() => {
    const ids = order === '' ? [] : order.split(' ')
    const onKey = (event: KeyboardEvent) => {
      const command = host.platform === 'darwin' ? event.metaKey : event.ctrlKey
      // ⌘, opens and closes the quick settings; ⌘⇧, goes to the settings' tab. Once there is a project, and its bar.
      if (command && !event.altKey && event.code === 'Comma' && !none) {
        event.preventDefault()
        if (event.shiftKey) {
          setQuick(false)
          openSettings()
        } else setQuick((now) => !now)
        return
      }
      // ⌘K, Control-K off a Mac: once there is a project, a task to find.
      if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k' && !none) {
        event.preventDefault()
        setFinding(true)
        return
      }
      // ⌘U, Control-U off a Mac: plan usage, opened and closed again by the same key.
      if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'u') {
        event.preventDefault()
        setUsage((open) => !open)
        return
      }
      // Before there is a project, the first screen has ⌘N for a folder of its own.
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n' && !none) {
        event.preventDefault()
        newProject()
        return
      }
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        const id = byNumber(ids, Number(event.key))
        if (id === undefined) return
        event.preventDefault()
        select(id)
        return
      }
      if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
        event.preventDefault()
        // The settings' tab, while open, is a stop between the home's and the projects'.
        const next = beside(settingsOpen ? [SETTINGS_STOP, ...ids] : ids, onSettings ? SETTINGS_STOP : current, event.shiftKey ? -1 : 1)
        if (next === SETTINGS_STOP) openSettings()
        else select(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [order, current, select, newProject, openSettings, settingsOpen, onSettings, none, host.platform])
  return (
    <CarriedBack.Provider value={back}>
      <VisitContext.Provider value={tabs.visit}>
        <NewTabContext.Provider value={newTab}>
          <UsageOpenContext.Provider value={openUsage}>
            <EndContext.Provider value={end}>
              <TabBarContext.Provider value={!tabs.none}>
                <div className={s.frame}>
                  {!tabs.none && (
                    <TabsBar
                      tabs={tabs}
                      usage={{ open: usage, toggle: () => setUsage((open) => !open) }}
                      endRef={setEnd}
                      quick={quick}
                      onQuick={setQuick}
                    />
                  )}
                  <div className={s.screen}>{children}</div>
                </div>
                {finding && <FinderView projectId={current} onClose={() => setFinding(false)} />}
                {usage && <UsageView onClose={() => setUsage(false)} />}
                {/* Dictation carried from its composer, at the window's foot where no composer shows. */}
                <CarriedAtFoot />
              </TabBarContext.Provider>
            </EndContext.Provider>
          </UsageOpenContext.Provider>
        </NewTabContext.Provider>
      </VisitContext.Provider>
    </CarriedBack.Provider>
  )
}
