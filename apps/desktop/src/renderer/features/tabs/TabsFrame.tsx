import { createContext, type ReactNode, useCallback, useContext, useEffect, useSyncExternalStore } from 'react'

import { ProjectTabs, type Room } from '@althar/ui'

import { useServices } from '../../data/services'
import { tabsStoreOf } from './store'
import { useWindowChrome } from '../../shared/useWindowChrome'
import { beside, byNumber } from './tabs'
import s from './Tabs.module.css'
import { useTabs } from './useTabs'

/*
 * Every screen under the window's tabs: the home's, then each open
 * project's. ⌘1 goes to the home, ⌘2 to ⌘8 to the projects in order, ⌘9 to
 * the last, and Control-Tab to the next tab (with Shift, the one before),
 * as in a browser. A screen's own bar sits under the tabs, so it leaves the
 * system's lights to them. Before there is any project there are no tabs:
 * the first screen has the whole window.
 */

const VisitContext = createContext<(threadId: string, projectId: string) => void>(() => undefined)

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

export function TabsFrame({ children }: { children: ReactNode }) {
  const tabs = useTabs()
  const { host } = useServices()
  // The window's own buttons in the strip, and whether the third says maximize or restore.
  const chrome = useWindowChrome()
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
      <div className={s.frame}>
        {!tabs.none && (
          <ProjectTabs
            tabs={tabs.tabs}
            current={current}
            yours={tabs.yours}
            others={tabs.others}
            onSelect={select}
            onClose={tabs.close}
            onOpen={tabs.open}
            onOpenFolder={tabs.openFolder}
            // macOS draws its traffic lights over the strip; elsewhere the strip draws the window's own buttons.
            lights={host.platform === 'darwin' ? 'space' : 'drawn'}
            maximized={chrome.window?.maximized === true}
            onCloseWindow={() => host.window('close')}
            onMinimize={() => host.window('minimize')}
            onToggleMaximize={() => host.window('toggle-maximize')}
          />
        )}
        <div className={s.screen}>{children}</div>
      </div>
    </VisitContext.Provider>
  )
}
