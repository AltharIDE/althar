import { createContext, type ReactNode, useContext, useEffect, useSyncExternalStore } from 'react'

import { ProjectTabs } from '@althar/ui'

import { useServices } from '../../data/services'
import { tabsStoreOf } from './store'
import { beside, byNumber, type LastTask } from './tabs'
import s from './Tabs.module.css'
import { useTabs } from './useTabs'

/*
 * Every screen under the window's tabs: the home's, then each open
 * project's. ⌘1 goes to the home, ⌘2 to ⌘8 to the projects in order, ⌘9 to
 * the last, and Control-Tab to the next tab (with Shift, the one before),
 * as in a browser. A screen's own bar sits under the tabs, so it leaves the
 * system's lights to them.
 */

const VisitContext = createContext<(threadId: string, projectId: string, title?: string) => void>(() => undefined)

/**
 * A task screen says which project its thread is in, once it has read it,
 * so that project's tab has the window; and that it is the task last opened
 * there, for the project's bar to go back to.
 */
export const useVisit = (threadId: string, projectId: string | undefined, title?: string) => {
  const visit = useContext(VisitContext)
  useEffect(() => {
    if (projectId !== undefined) visit(threadId, projectId, title)
  }, [visit, threadId, projectId, title])
}

/** The task last opened in a project, for its bar's way back; null before one was. */
export const useLastTask = (projectId: string): LastTask | null => {
  const store = tabsStoreOf(useServices().client)
  const { kept } = useSyncExternalStore(store.subscribe, store.get)
  return kept?.tasks?.[projectId] ?? null
}

export function TabsFrame({ children }: { children: ReactNode }) {
  const tabs = useTabs()
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
        <ProjectTabs
          tabs={tabs.tabs}
          current={current}
          yours={tabs.yours}
          others={tabs.others}
          onSelect={select}
          onClose={tabs.close}
          onOpen={tabs.open}
          onOpenFolder={tabs.openFolder}
        />
        <div className={s.screen}>{children}</div>
      </div>
    </VisitContext.Provider>
  )
}
