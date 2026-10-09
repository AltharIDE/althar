import { Fragment } from 'react'

import { type Os, OsMark } from '../../shared/OsMark'
import s from './RunsOn.module.css'

/*
 * The systems Althar runs on, as a band between the first screen and the
 * rest: one line between hairlines, "Runs on" and each system with its own
 * mark.
 */

const SYSTEMS: ReadonlyArray<{ id: Os; name: string }> = [
  { id: 'mac', name: 'macOS' },
  { id: 'windows', name: 'Windows' },
  { id: 'linux', name: 'Linux' },
]

export function RunsOn() {
  return (
    <section className={s.band} aria-label="Runs on macOS, Windows and Linux">
      <span className={s.label}>Runs on</span>
      {SYSTEMS.map((x, i) => (
        <Fragment key={x.id}>
          {i > 0 && <i className={s.dot} aria-hidden="true" />}
          <span className={s.system}>
            <OsMark id={x.id} />
            {x.name}
          </span>
        </Fragment>
      ))}
    </section>
  )
}
