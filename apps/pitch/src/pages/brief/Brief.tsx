import { useRef } from 'react'

import { useMeta } from '../../lib/useMeta'
import { BRIEF } from '../../meta'
import { Chrome } from './Chrome'
import { Abstract } from './slides/Abstract'
import { Arch } from './slides/Arch'
import { Business } from './slides/Business'
import { Closer } from './slides/Closer'
import { Coordinator } from './slides/Coordinator'
import { Hero } from './slides/Hero'
import { Ladder } from './slides/Ladder'
import { Market } from './slides/Market'
import { Models } from './slides/Models'
import { Morning } from './slides/Morning'
import { Open } from './slides/Open'
import { Plan } from './slides/Plan'
import { Problem } from './slides/Problem'
import { Team } from './slides/Team'
import ui from './ui.module.css'

/** Keep in step with the slides below: the counter reads it on first paint. */
const SLIDE_COUNT = 14

/** The investor brief: fourteen full-screen panels, some of them pinned while their figure plays. */
export function Brief() {
  useMeta(BRIEF)
  const deck = useRef<HTMLDivElement>(null)
  return (
    <div ref={deck} className={ui.deck}>
      <Chrome deck={deck} total={SLIDE_COUNT} first="Althar" />
      <main id="main" tabIndex={-1}>
        <Hero />
        <Abstract />
        <Problem />
        <Morning />
        <Coordinator />
        <Ladder />
        <Team />
        <Arch />
        <Models />
        <Market />
        <Open />
        <Business />
        <Plan />
        <Closer />
      </main>
    </div>
  )
}
