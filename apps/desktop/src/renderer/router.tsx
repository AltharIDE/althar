import { createHashHistory, createRouter } from '@tanstack/react-router'

import { projectRoute } from './features/project/route'
import { rulesRoute } from './features/rules/route'
import { settingsRoute } from './features/settings/route'
import { startRoute } from './features/start/route'
import { taskRoute } from './features/task/route'
import { rootRoute } from './root'

/*
 * The app's places, each feature's own route: the start or home, settings, a project, its rules, a task.
 * The window loads from a file, so the place lives in the hash.
 */

export const router = createRouter({
  routeTree: rootRoute.addChildren([startRoute, settingsRoute, projectRoute, rulesRoute, taskRoute]),
  history: createHashHistory(),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
