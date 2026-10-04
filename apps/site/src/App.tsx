import { lazy, Suspense, type ComponentType } from 'react'

import { Home } from './home/Home'
import { Shifts } from './shifts/Shifts'

/* The thesis (with its Markdown compiler) and the earlier enterprise page (with its 3D scene) load only on their own paths. */
const Thesis = lazy(() => import('./thesis/Thesis').then((m) => ({ default: m.Thesis })))
const EnterpriseHome = lazy(() => import('./enterprise/Home').then((m) => ({ default: m.EnterpriseHome })))

const PAGES: Record<string, ComponentType> = {
  '/shifts': Shifts,
  '/thesis': Thesis,
  /** The earlier, enterprise-facing page: kept for the company version, linked from nowhere. */
  '/enterprise': EnterpriseHome,
}

/** The developer page at the root, and the other pages by path. Any other path is the developer page. */
export function App({ pathname }: { pathname: string }) {
  const Page = PAGES[pathname.replace(/\/+$/, '')] ?? Home
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
