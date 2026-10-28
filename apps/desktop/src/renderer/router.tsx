import { createHashHistory, createRouter, type RouterHistory } from '@tanstack/react-router'

import { newProjectRoute } from './features/newProject/route'
import { projectRoute } from './features/project/route'
import { settingsRoute } from './features/settings/route'
import { startRoute } from './features/start/route'
import { taskRoute } from './features/task/route'
import { type RouterContext, rootRoute } from './root'

/*
 * The app's places, each feature's own route: the start or home, a new project, a project with its settings, a task, and
 * Althar's settings, which have a tab of their own. Their quick settings are a panel from the window's bar, on every screen.
 * The window loads from a file, so the place lives in the hash.
 *
 * Going somewhere the window has never read reads what it shows first (each
 * route's loader), and the screen the person was on stays until then, so a
 * screen opens whole, never empty and filling in. Only a read slower than a
 * glance shows the place's outline meanwhile, and then long enough not to
 * flash. A place the window holds shows at once, what changed since read
 * behind it; a project's or task's screen the person was on is kept as they
 * left it (`KeptScreens`).
 */

export const routeTree = rootRoute.addChildren([startRoute, newProjectRoute, projectRoute, taskRoute, settingsRoute])

/** How long a read may take before the place's outline shows, and how long the outline stays once it does. */
export const PENDING = { after: 150, atLeast: 300 }

export const makeRouter = (context: RouterContext, history: RouterHistory = createHashHistory()) =>
  createRouter({
    routeTree,
    history,
    context,
    // Every visit runs its loader again, which waits only on what the window doesn't hold.
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
