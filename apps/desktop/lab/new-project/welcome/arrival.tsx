import { HalftoneMark, Light } from '@althar/ui'

import { HOME } from '../world'
import ar from './arrival.module.css'
import { Doors, ReadyStrip, useArrive, usePasteAnywhere } from './Welcome'
import w from './welcome.module.css'

/*
 * 1 · Arrival. The home's welcome as the window's launch is: Althar's light
 * rises tall off the foot of the window, the mark comes up dot by dot, and
 * the home's name arrives a letter at a time over what it is. Then three
 * doors in, each drawn as what's behind it, and the strip of what the home
 * has. A repository's address pasted anywhere goes straight in.
 */

export function ArrivalWelcome() {
  const ref = useArrive<HTMLElement>()
  usePasteAnywhere()
  return (
    <main ref={ref} className={`${w.stage} ${ar.stage}`}>
      <div className={w.light} aria-hidden="true">
        <Light height={0.82} />
      </div>
      <div className={ar.head}>
        <HalftoneMark size={72} className={ar.mark} />
        <span className={w.eyebrow} data-arrive>
          {HOME.remote ? `althar@${HOME.name} · ${HOME.what}` : HOME.what}
        </span>
        <h1 className={`${w.display} ${ar.title}`} aria-label={`Welcome to ${HOME.name}`}>
          <span className={ar.welcome}>Welcome to</span>{' '}
          <span className={ar.name} aria-hidden="true">
            {[...HOME.name].map((letter, i) => (
              <span key={i} style={{ ['--i' as string]: i }}>
                {letter}
              </span>
            ))}
          </span>
        </h1>
        <p className={ar.line} data-arrive>
          Bring it a project. Its tasks run on it, and keep going with this Mac asleep.
        </p>
      </div>
      <Doors label="Ways in" />
      <div className={ar.foot} data-arrive>
        <ReadyStrip label={`Ready on ${HOME.name}`} />
      </div>
    </main>
  )
}
