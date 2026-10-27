import { lazy, Suspense, useEffect, type ComponentType } from 'react'

import { pageMeta, pathOf } from './content/pages'
import { Docs } from './docs/Docs'
import { Home } from './home/Home'
import { Pathname } from './lib/pathname'
import { NotFound } from './notfound/NotFound'
import { Shifts } from './shifts/Shifts'
import { Wallpaper } from './wallpaper/Wallpaper'

/* The thesis (with its Markdown compiler), the earlier enterprise page (with its 3D scene) and the first-screen concepts load only on their own paths. */
const Thesis = lazy(() => import('./thesis/Thesis').then((m) => ({ default: m.Thesis })))
const EnterpriseHome = lazy(() => import('./enterprise/Home').then((m) => ({ default: m.EnterpriseHome })))
const Train = lazy(() => import('./train/Train').then((m) => ({ default: m.Train })))
const Orbit = lazy(() => import('./orbit/Orbit').then((m) => ({ default: m.Orbit })))
const Reentry = lazy(() => import('./reentry/Reentry').then((m) => ({ default: m.Reentry })))

const PAGES: Record<string, ComponentType> = {
  '/': Home,
  '/shifts': Shifts,
  '/thesis': Thesis,
  '/wallpaper': Wallpaper,
  '/docs': Docs,
  /** The earlier, enterprise-facing page: kept for the company version, linked from nowhere. */
  '/enterprise': EnterpriseHome,
  /** A concept for the first screen, seen from a train: linked from nowhere, to be looked at beside the root. */
  '/train': Train,
  /** Another, seen from a space station as the sun comes up: linked from nowhere, likewise. */
  '/orbit': Orbit,
  /** And another, inside a capsule coming in from orbit: linked from nowhere, likewise. */
  '/reentry': Reentry,
  /** The link previews, drawn for scripts/og.ts to screenshot: in development only, and not in the build. */
  ...(import.meta.env.DEV ? { '/og': lazy(() => import('./og/Og').then((m) => ({ default: m.Og }))) } : {}),
}

/** The developer page at the root, and the other pages by path. Any other path is the page that isn't there. */
export function App({ pathname }: { pathname: string }) {
  const Page = PAGES[pathOf(pathname)] ?? NotFound
  const { title } = pageMeta(pathname)
  useEffect(() => {
    document.title = title
  }, [title])
  return (
    <Pathname value={pathname}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    </Pathname>
  )
}
