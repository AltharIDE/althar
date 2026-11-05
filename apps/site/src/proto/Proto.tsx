import { type ComponentType, useEffect, useState } from 'react'

import { DesktopBody } from '../home/bodies/desktop/DesktopBody'
import { RunsOn } from '../home/bodies/RunsOn'
import { Hero } from '../home/Hero'
import { Footer } from '../shared/footer/Footer'
import { Nav, NavSpace } from '../shared/Nav'
import s from './Proto.module.css'
import { Control } from './takes/Control'
import { Warp } from './takes/Warp'
import { Window } from './takes/Window'

/*
 * PROTOTYPE, in development only, deleted once a direction is picked: the
 * developer page's flow, in takes. What follows the first screen swaps in
 * place, from the bar along the bottom or by key: A, B, C, and N for the
 * page as it is now. ← and → step through them. `?take=` holds one. Most
 * takes follow the shared first screen, which stays mounted as they swap
 * (its opening plays once); a take that needs the first screen inside its
 * own scene brings its own.
 */

function Now() {
  return (
    <div className={s.now}>
      <RunsOn />
      <DesktopBody />
      <Footer />
    </div>
  )
}

const TAKES: ReadonlyArray<{ key: string; name: string; Page: ComponentType; ownHero?: boolean }> = [
  { key: 'a', name: 'Warp', Page: Warp },
  { key: 'b', name: 'Mission control', Page: Control },
  { key: 'c', name: 'The window', Page: Window, ownHero: true },
  { key: 'n', name: 'Now', Page: Now },
]

const asked = () => {
  if (typeof window === 'undefined') return 'a'
  const take = new URLSearchParams(window.location.search).get('take')
  return TAKES.some((x) => x.key === take) ? (take as string) : 'a'
}

export function Proto() {
  const [take, setTake] = useState(asked)

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('take', take)
    window.history.replaceState(null, '', url)
  }, [take])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable]')) return
      const at = TAKES.findIndex((x) => x.key === take)
      const k = e.key.toLowerCase()
      if (TAKES.some((x) => x.key === k)) setTake(k)
      else if (e.key === 'ArrowRight') setTake(TAKES[(at + 1) % TAKES.length]!.key)
      else if (e.key === 'ArrowLeft') setTake(TAKES[(at - 1 + TAKES.length) % TAKES.length]!.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [take])

  const { Page, ownHero } = TAKES.find((x) => x.key === take) ?? TAKES[0]!
  return (
    <div className={s.page} id="top">
      <Nav opening />
      {!ownHero && <Hero nav={<NavSpace />} />}
      <Page key={take} />
      <nav className={s.bar} aria-label="Takes">
        {TAKES.map((x) => (
          <button key={x.key} type="button" className={s.take} aria-pressed={x.key === take} onClick={() => setTake(x.key)}>
            <kbd>{x.key.toUpperCase()}</kbd>
            {x.name}
          </button>
        ))}
      </nav>
    </div>
  )
}
