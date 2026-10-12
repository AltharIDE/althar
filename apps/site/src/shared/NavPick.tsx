import { lazy, Suspense } from 'react'

import { Nav } from './Nav'

/*
 * The homepage's nav, with the glass proposals beside it in development:
 * `?nav=glass-a` for the pane, `?nav=glass-b` for the lens, and today's
 * island otherwise (or `?nav=today`). Like /og, the proposals are not in
 * the build: there this is only the Nav.
 */

const GlassNav = import.meta.env.DEV ? lazy(() => import('./GlassNav').then((m) => ({ default: m.GlassNav }))) : null

const KINDS = { 'glass-a': 'pane', 'glass-b': 'lens' } as const

export function NavPick() {
  const asked = GlassNav && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('nav') : null
  const kind = asked && asked in KINDS ? KINDS[asked as keyof typeof KINDS] : null
  if (!GlassNav || !kind) return <Nav />
  return (
    <Suspense fallback={null}>
      <GlassNav kind={kind} />
    </Suspense>
  )
}
