import { useSyncExternalStore } from 'react'

import { Fragment } from './Fragment'
import s from './Review.module.css'
import review from './styled/d-review.html?raw'
import chat from './styled/r-chat.html?raw'
import log from './styled/r-log.html?raw'
import proxy from './styled/r-proxy.html?raw'
import rally from './styled/r-rally.html?raw'

/*
 * The work reviewing itself: the lead types its change, a reviewer from
 * another lab (GLM-5.3, an open model) flags two lines, the lead rewrites
 * both, round 2 comes back clean, and only then does the pull request reach
 * you. Drawn as an interface lit by one light, large, on the section's own
 * dark. While the drawing is being chosen, `?review=` shows another take on
 * it, with links between the takes under it.
 */

const TAKES = [
  { id: 'diff', name: 'Diff', source: review },
  { id: 'chat', name: 'Chat', source: chat },
  { id: 'proxy', name: 'You, the proxy', source: proxy },
  { id: 'log', name: 'Log', source: log },
  { id: 'rally', name: 'Rally', source: rally },
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
