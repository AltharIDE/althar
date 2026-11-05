import { type ComponentType, useEffect, useState } from 'react'

import { DesktopBody } from '../home/bodies/desktop/DesktopBody'
import { RunsOn } from '../home/bodies/RunsOn'
import { Hero } from '../home/Hero'
import { Footer } from '../shared/footer/Footer'
import { Nav, NavSpace } from '../shared/Nav'
import s from './Proto.module.css'
import { Descent } from './takes/Descent'
import { NightSide } from './takes/NightSide'
import { Plan } from './takes/Plan'

/*
 * PROTOTYPE, in development only, deleted once a direction is picked: the
 * developer page's flow, in takes. The first screen is the same in each and
 * stays where it is (its opening plays once); what follows it swaps in
 * place, from the bar along the bottom or by key: A, B, C, and N for the
 * page as it is now. ← and → step through them. `?take=` holds one.
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

const TAKES: ReadonlyArray<{ key: string; name: string; Page: ComponentType }> = [
  { key: 'a', name: 'Descent', Page: Descent },
  { key: 'b', name: 'Flight plan', Page: Plan },
  { key: 'c', name: 'Night side', Page: NightSide },
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

  const { Page } = TAKES.find((x) => x.key === take) ?? TAKES[0]!
  return (
    <div className={s.page} id="top">
      <Nav opening />
      <Hero nav={<NavSpace />} />
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
