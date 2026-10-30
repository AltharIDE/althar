import { useSyncExternalStore } from 'react'

import { Fragment } from './Fragment'
import s from './Review.module.css'
import proxy from './styled/r-proxy.html?raw'
import braid from './styled/rp-braid.html?raw'
import card from './styled/rp-card.html?raw'
import loop from './styled/rp-loop.html?raw'
import task from './styled/rp-task.html?raw'

/*
 * The work reviewing itself, as a before and after. Today you carry each
 * agent's answer to the other by hand, Copy and Paste, round after round;
 * with Althar the lead and a reviewer from another lab go round by
 * themselves, and only the pull request reaches you. While its right side
 * is being chosen, `?review=` shows another take on it, with links between
 * the takes under it.
 */

const TAKES = [
  { id: 'windows', name: 'Windows', source: proxy },
  { id: 'task', name: 'Task', source: task },
  { id: 'card', name: 'One card', source: card },
  { id: 'loop', name: 'Loop', source: loop },
  { id: 'braid', name: 'Braid', source: braid },
] as const

const unchanging = () => () => {}
const askedFor = () => new URLSearchParams(window.location.search).get('review')

export function Review() {
  const asked = useSyncExternalStore(unchanging, askedFor, () => null)
  const take = TAKES.find((one) => one.id === asked) ?? TAKES[0]
  return (
    <div className={s.wrap}>
      <Fragment key={take.id} source={take.source} tone="dark" className={s.stage} />
      {asked && (
        <nav className={s.takes} aria-label="Takes on the review">
          {TAKES.map((one) => (
            <a key={one.id} href={`?review=${one.id}#review`} aria-current={one.id === take.id ? 'page' : undefined}>
              {one.name}
            </a>
          ))}
        </nav>
      )}
    </div>
  )
}
