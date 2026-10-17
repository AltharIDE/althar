import { Fragment } from 'react'

import { PLATFORMS } from '../../content/facts'
import { OsMark } from '../../shared/OsMark'
import s from './RunsOn.module.css'

/*
 * The systems Althar runs on, as a band between the first screen and the
 * rest: one line between hairlines, "Runs on" and each system with its own
 * mark. A system with no build yet (PLATFORMS) is there, dimmed, and says
 * Coming.
 */

const ready = PLATFORMS.filter((p) => p.files !== null).map((p) => p.name)
const coming = PLATFORMS.filter((p) => p.files === null).map((p) => p.name)
const label = `Runs on ${ready.join(' and ')}${coming.length > 0 ? `; ${coming.join(' and ')} coming` : ''}`

export function RunsOn() {
  return (
    <section className={s.band} aria-label={label}>
      <span className={s.label}>Runs on</span>
      {PLATFORMS.map((x, i) => (
        <Fragment key={x.os}>
          {i > 0 && <i className={s.dot} aria-hidden="true" />}
          <span className={x.files === null ? s.coming : s.system}>
            <OsMark id={x.os} />
            {x.name}
            {x.files === null && <small className={s.soon}>Coming</small>}
          </span>
        </Fragment>
      ))}
    </section>
  )
}
