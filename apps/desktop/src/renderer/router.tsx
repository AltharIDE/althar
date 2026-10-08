import { createHashHistory, createRouter, type RouterHistory } from '@tanstack/react-router'

import { projectRoute } from './features/project/route'
import { repositoriesRoute } from './features/repositories/route'
import { rulesRoute } from './features/rules/route'
import { settingsRoute } from './features/settings/route'
import { startRoute } from './features/start/route'
import { taskRoute } from './features/task/route'
import { type RouterContext, rootRoute } from './root'

/*
 * The app's places, each feature's own route: the start or home, settings, a project, its rules, its repositories, a task.
 * The window loads from a file, so the place lives in the hash.
 *
 * Going somewhere reads what it shows first (each route's loader, from the
 * window's cache when nothing has changed), and the screen the person was on
 * stays until then, so a screen opens whole, never empty and filling in.
 * Only a read slower than a glance shows the place's outline meanwhile, and
 * then long enough not to flash.
 */

export const routeTree = rootRoute.addChildren([startRoute, settingsRoute, projectRoute, rulesRoute, repositoriesRoute, taskRoute])

/** How long a read may take before the place's outline shows, and how long the outline stays once it does. */
export const PENDING = { after: 150, atLeast: 300 }

export const makeRouter = (context: RouterContext, history: RouterHistory = createHashHistory()) =>
  createRouter({
    routeTree,
    history,
    context,
    // Every visit reads again, and waits for it: the cache answers at once when nothing has changed.
    defaultStaleTime: 0,
    defaultStaleReloadMode: 'blocking',
    defaultPendingMs: PENDING.after,
    defaultPendingMinMs: PENDING.atLeast,
  })

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>
  }
}
