import { createRootRoute, Outlet } from '@tanstack/react-router'

/* The route every feature's routes hang from. */
export const rootRoute = createRootRoute({ component: Outlet })
