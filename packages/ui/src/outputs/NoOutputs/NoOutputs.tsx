import { useId } from 'react'

import { Light } from '../../foundations/Light/Light'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import s from './NoOutputs.module.css'

/*
 * A task's outputs before it has made anything: what is true, in a line or
 * two, then the files its lead has looked at, the latest first and the
 * earlier fading as they go down, so the page shows where the work is going
 * before anything changes. Under it all, a low light: drifting while the
 * lead works, still once it stops.
 */

export interface NoOutputsText {
  looked: (count: number) => string
}

export const noOutputsText: NoOutputsText = {
  looked: (count) => (count === 1 ? 'Looked at 1 file' : `Looked at ${count} files`),
}

export type NoOutputsProps = RootProps<
  'section',
  {
    title: string
    /** A line or two under the title. */
    note?: string
    /** Its lead is working on it now: the light drifts and the count pulses while it does. */
    working?: boolean
    /** The files its lead has looked at, the latest first, as paths in the task's folder. */
    looked?: readonly string[]
    headingLevel?: HeadingLevel
    text?: Partial<NoOutputsText>
  }
>

/** How many of the files looked at are shown; the count says how many in all. */
const SHOWN = 9

const split = (path: string) => {
  const at = path.lastIndexOf('/')
  return at < 0 ? { dir: '', name: path } : { dir: path.slice(0, at + 1), name: path.slice(at + 1) }
}

export function NoOutputs({ title, note, working = false, looked = [], headingLevel = 2, className, text, ...rest }: NoOutputsProps) {
  const t = { ...noOutputsText, ...text }
  const id = useId()
  return (
    <section aria-labelledby={id} className={cx(s.none, className)} {...rest}>
      <Light height={0.34} motion={working ? 'drift' : 'still'} />
      <div className={s.column}>
        <Heading level={headingLevel} id={id} className={s.title}>
          {title}
        </Heading>
        {note !== undefined && <p className={s.note}>{note}</p>}
        {looked.length > 0 && (
          <div className={s.trail}>
            <p className={s.label}>
              {working && <LiveDot pulse />}
              {t.looked(looked.length)}
            </p>
            <ol className={s.files}>
              {looked.slice(0, SHOWN).map((path, i) => {
                const { dir, name } = split(path)
                return (
                  // The latest brightest, the earlier fading as they go down.
                  <li key={path} className={s.file} style={{ opacity: Math.max(0.28, 1 - i * 0.1) }} title={path}>
                    <span className={s.name}>{name}</span>
                    <span className={s.dir}>{dir}</span>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </div>
    </section>
  )
}
