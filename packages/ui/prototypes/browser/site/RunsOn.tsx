// Scrappy: the site's "Runs on" band, as main has it, or as the task's branch changed it (?run=task): each system with what it needs.
import { Fragment } from 'react'

import { RunsOn as Main } from '../../../../../apps/site/src/home/bodies/RunsOn'
import { type Os, OsMark } from '../../../../../apps/site/src/shared/OsMark'
import base from '../../../../../apps/site/src/home/bodies/RunsOn.module.css'
import s from './RunsOn.module.css'

/** The task's branch: under each system's name, the oldest it runs on, as Electron 44 supports them. */
const SYSTEMS: ReadonlyArray<{ id: Os; name: string; needs: string; fixed?: string }> = [
  { id: 'mac', name: 'macOS', needs: '12 Monterey or later · Apple silicon and Intel' },
  { id: 'windows', name: 'Windows', needs: '10 or later · x64', fixed: '10 or later · x64 and arm64' },
  { id: 'linux', name: 'Linux', needs: 'Ubuntu 20.04, Fedora 38 or later · x64 and arm64', fixed: 'x64 and arm64' },
]

/** ?rev=2: the lead's second go, after the person's comments: the band with room for two lines, Linux's line short, Windows on Arm. */
const second = () => new URLSearchParams(window.location.search).get('rev') === '2'

function Branch() {
  const fixed = second()
  return (
    <section className={`${base.band} ${fixed ? s.roomy : ''}`} aria-label="Runs on macOS, Windows and Linux">
      <span className={base.label}>Runs on</span>
      {SYSTEMS.map((x, i) => (
        <Fragment key={x.id}>
          {i > 0 && <i className={base.dot} aria-hidden="true" />}
          <span className={s.system}>
            <OsMark id={x.id} />
            <span className={s.words}>
              <span className={s.name}>{x.name}</span>
              <span className={s.needs}>{fixed ? (x.fixed ?? x.needs) : x.needs}</span>
            </span>
          </span>
        </Fragment>
      ))}
    </section>
  )
}

export function RunsOn() {
  return new URLSearchParams(window.location.search).get('run') === 'task' ? <Branch /> : <Main />
}
