import { useEffect, useSyncExternalStore, type ComponentType } from 'react'

import { Footer } from '../shared/footer/Footer'
import { Nav } from '../shared/Nav'
import s from './Changelog.module.css'
import { Board } from './takes/Board'
import { Graph } from './takes/Graph'
import { Log } from './takes/Log'
import { Spreads } from './takes/Spreads'

/*
 * What changed in Althar, release by release, with what has merged since the
 * last one and what's next. While its direction is being chosen, `?v=` picks
 * one, and a bar along the bottom swaps them in place (A to D, with keys).
 */

const TAKES = [
  { id: 'graph', key: 'A', name: 'Graph', Take: Graph },
  { id: 'board', key: 'B', name: 'Board', Take: Board },
  { id: 'spreads', key: 'C', name: 'Spreads', Take: Spreads },
  { id: 'log', key: 'D', name: 'Flight log', Take: Log },
] as const satisfies readonly { id: string; key: string; name: string; Take: ComponentType }[]

const unchanging = () => () => {}
const askedFor = () => new URLSearchParams(window.location.search).get('v')

const go = (id: string) => {
  const url = new URL(window.location.href)
  url.searchParams.set('v', id)
  window.location.assign(url)
}

export function Changelog() {
  const asked = useSyncExternalStore(unchanging, askedFor, () => null)
  const take = TAKES.find((one) => one.id === asked) ?? TAKES[0]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLInputElement) return
      const next = TAKES.find((one) => one.key.toLowerCase() === e.key.toLowerCase())
      if (next && next.id !== take.id) go(next.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [take.id])

  return (
    <div className={s.page}>
      <Nav />
      <take.Take />
      <Footer />
      <nav className={s.takes} aria-label="Directions for this page">
        {TAKES.map((one) => (
          <a key={one.id} href={`?v=${one.id}`} aria-current={one.id === take.id ? 'page' : undefined}>
            <kbd>{one.key}</kbd>
            {one.name}
          </a>
        ))}
      </nav>
    </div>
  )
}
