import { createHashHistory, createRouter } from '@tanstack/react-router'

import { projectRoute } from './features/project/route'
import { startRoute } from './features/start/route'
import { taskRoute } from './features/task/route'
import { rootRoute } from './root'

/*
 * The app's places, each feature's own route: the start, a project, a task.
 * The window loads from a file, so the place lives in the hash.
 */

export const router = createRouter({
  routeTree: rootRoute.addChildren([startRoute, projectRoute, taskRoute]),
  history: createHashHistory(),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
