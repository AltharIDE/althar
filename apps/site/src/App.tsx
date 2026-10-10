import { lazy, Suspense, useEffect, type ComponentType } from 'react'

import { pageMeta } from './content/pages'
import { Docs } from './docs/Docs'
import { Home } from './home/Home'
import { Shifts } from './shifts/Shifts'
import { Wallpaper } from './wallpaper/Wallpaper'

/* The thesis (with its Markdown compiler) and the earlier enterprise page (with its 3D scene) load only on their own paths. */
const Thesis = lazy(() => import('./thesis/Thesis').then((m) => ({ default: m.Thesis })))
const EnterpriseHome = lazy(() => import('./enterprise/Home').then((m) => ({ default: m.EnterpriseHome })))

const PAGES: Record<string, ComponentType> = {
  '/shifts': Shifts,
  '/thesis': Thesis,
  '/wallpaper': Wallpaper,
  '/docs': Docs,
  /** The earlier, enterprise-facing page: kept for the company version, linked from nowhere. */
  '/enterprise': EnterpriseHome,
  /** The link previews, drawn for scripts/og.ts to screenshot: in development only, and not in the build. */
  ...(import.meta.env.DEV ? { '/og': lazy(() => import('./og/Og').then((m) => ({ default: m.Og }))) } : {}),
}

/** The developer page at the root, and the other pages by path. Any other path is the developer page. */
export function App({ pathname }: { pathname: string }) {
  const Page = PAGES[pathname.replace(/\/+$/, '')] ?? Home
  const { title } = pageMeta(pathname)
  useEffect(() => {
    document.title = title
  }, [title])
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    </>
  )
}
