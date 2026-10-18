import { type ComponentType, useCallback, useMemo, useSyncExternalStore } from 'react'

import { Footer } from '../shared/footer/Footer'
import { Nav } from '../shared/Nav'
import * as A from './a/Reading'
import * as B from './b/SideBySide'
import * as C from './c/Story'
import * as D from './d/Questions'
import s from './Docs.module.css'
import { Switcher } from './Switcher'
import { type Direction, DocsView, move, onMove, type View, viewOf } from './view'

/*
 * The docs, while their direction is chosen: four ways to draw the same
 * docs, each with its home and the one page written out (When an account
 * runs out), under the site's nav and over its footer. The switcher at the
 * foot moves between them, and the address keeps which is shown.
 */

const SCREENS: Record<Direction, { Home: ComponentType; Page: ComponentType }> = { a: A, b: B, c: C, d: D }

export function Docs() {
  // The build draws the first; the address says which once the page is in the browser.
  const view = viewOf(
    useSyncExternalStore(
      onMove,
      () => window.location.search,
      () => '',
    ),
  )
  const go = useCallback((to: Partial<View>) => {
    move({ ...viewOf(window.location.search), ...to })
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])
  const docs = useMemo(() => ({ ...view, go }), [view, go])
  const { Home, Page } = SCREENS[view.v]
  return (
    <DocsView.Provider value={docs}>
      <div className={s.page} data-direction={view.v}>
        <Nav />
        <main id="main" tabIndex={-1} key={`${view.v}-${view.p}`}>
          {view.p === 'home' ? <Home /> : <Page />}
        </main>
        <Footer />
        <Switcher />
      </div>
    </DocsView.Provider>
  )
}
