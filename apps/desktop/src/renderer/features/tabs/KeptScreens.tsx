import { Activity, useEffect, useSyncExternalStore } from 'react'

import { useServices } from '../../data/services'
import { HomeScreen } from '../home/HomeScreen'
import { ProjectScreen } from '../project/ProjectScreen'
import { TaskScreen } from '../task/TaskScreen'
import { keptStoreOf } from './kept'
import { tabsStoreOf } from './store'

/*
 * The home's, projects' and tasks' screens the window keeps, beside the place on
 * show: the one its route shows is visible, the others hidden as they were
 * left. Hidden, a screen does nothing (React's Activity): no listening, no
 * clocks, no measuring, and what it reads changes only in the window's
 * cache, so going back to it shows it at once, and it catches up from there.
 * A project whose tab closed, or that was removed, keeps no screen, nor do
 * its tasks; the home's stays.
 */
export function KeptScreens() {
  const { client } = useServices()
  const store = keptStoreOf(client)
  const tabs = tabsStoreOf(client)
  const { screens, shown } = useSyncExternalStore(store.subscribe, store.get)
  const { kept, threads } = useSyncExternalStore(tabs.subscribe, tabs.get)
  const open = kept?.open
  useEffect(() => {
    if (open === undefined) return
    const tabbed = new Set(open)
    store.keepOnly((place) => {
      if (place.kind === 'home') return true
      const projectId = place.kind === 'project' ? place.projectId : threads[place.threadId]
      return projectId === undefined || tabbed.has(projectId)
    })
  }, [store, open, threads, shown])
  return screens.map(({ key, place, visit }) => (
    <Activity key={key} mode={key === shown ? 'visible' : 'hidden'}>
      {place.kind === 'home' ? (
        <HomeScreen />
      ) : place.kind === 'project' ? (
        <ProjectScreen projectId={place.projectId} search={place.search} visit={visit} />
      ) : (
        <TaskScreen threadId={place.threadId} />
      )}
    </Activity>
  ))
}
