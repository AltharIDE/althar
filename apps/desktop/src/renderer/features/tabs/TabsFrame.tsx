import { createContext, type ReactNode, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { ProjectTabs, TitleBar, type Room } from '@althar/ui'

import { useServices } from '../../data/services'
import { useWindowChrome } from '../../shared/useWindowChrome'
import { tabsStoreOf } from './store'
import { beside, byNumber } from './tabs'
import s from './Tabs.module.css'
import { useTabs } from './useTabs'

/*
 * Every screen under the window's tabs: the home's, then each open
 * project's. ⌘1 goes to the home, ⌘2 to ⌘8 to the projects in order, ⌘9 to
 * the last, and Control-Tab to the next tab (with Shift, the one before),
 * as in a browser. The tabs are the window's one bar: a screen puts its own
 * controls at the bar's end with BarEnd, and its way back, where it has one,
 * at the top of its page. Before there is any project there are no tabs:
 * the first screen has the whole window.
 */

const VisitContext = createContext<(threadId: string, projectId: string) => void>(() => undefined)

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
function TabsBar({ tabs, endRef }: { tabs: ReturnType<typeof useTabs>; endRef: (element: HTMLElement | null) => void }) {
  const { host } = useServices()
  const chrome = useWindowChrome()
  const { select, current } = tabs
  return (
    <ProjectTabs
      tabs={tabs.tabs}
      current={current}
      yours={tabs.yours}
      others={tabs.others}
      onSelect={select}
      onClose={tabs.close}
      onOpen={tabs.open}
      onOpenFolder={tabs.openFolder}
      end={<div ref={endRef} className={s.end} />}
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
  const [end, setEnd] = useState<HTMLElement | null>(null)
  const { select, current } = tabs
  const open = tabs.tabs.map((tab) => tab.id)
  const order = open.join(' ')
  useEffect(() => {
    const ids = order === '' ? [] : order.split(' ')
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        const id = byNumber(ids, Number(event.key))
        if (id === undefined) return
        event.preventDefault()
        select(id)
        return
      }
      if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
        event.preventDefault()
        select(beside(ids, current, event.shiftKey ? -1 : 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [order, current, select])
  return (
    <VisitContext.Provider value={tabs.visit}>
      <EndContext.Provider value={end}>
        <TabBarContext.Provider value={!tabs.none}>
          <div className={s.frame}>
            {!tabs.none && <TabsBar tabs={tabs} endRef={setEnd} />}
            <div className={s.screen}>{children}</div>
          </div>
        </TabBarContext.Provider>
      </EndContext.Provider>
    </VisitContext.Provider>
  )
}
