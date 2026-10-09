import { useId } from 'react'

import { Light } from '../../foundations/Light/Light'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import s from './NoOutputs.module.css'

/*
 * A task's outputs before it has made anything: what is true, in a line or
 * two, and something to look at while the work happens. TEMPORARY, while
 * the person picks one: three looks. light: Althar's light at the foot,
 * drifting while the lead works and still once it stops. trail: the files
 * the lead has looked at, the latest first, so the page shows where the work
 * is going before anything changes. outline: what this page will hold, in
 * the order it fills, and which part is under way. lit: the trail, over the
 * light.
 */

export interface NoOutputsStep {
  readonly title: string
  readonly note: string
  readonly state: 'done' | 'now' | 'next'
}

export interface NoOutputsText {
  looked: (count: number) => string
  now: string
  done: string
}

export const noOutputsText: NoOutputsText = {
  looked: (count) => (count === 1 ? 'Looked at 1 file' : `Looked at ${count} files`),
  now: 'now',
  done: 'done',
}

export type NoOutputsLook = 'light' | 'trail' | 'outline' | 'lit'

export type NoOutputsProps = RootProps<
  'section',
  {
    title: string
    /** A line or two under the title. */
    note?: string
    /** Its lead is working on it now: the page moves while it does. */
    working?: boolean
    /** The files its lead has looked at, the latest first, as paths in the task's folder. */
    looked?: readonly string[]
    /** What fills this page, in the order it does. */
    ahead?: readonly NoOutputsStep[]
    look?: NoOutputsLook
    headingLevel?: HeadingLevel
    text?: Partial<NoOutputsText>
  }
>

/** How many of the files looked at are shown; the rest are counted. */
const SHOWN = 9

const split = (path: string) => {
  const at = path.lastIndexOf('/')
  return at < 0 ? { dir: '', name: path } : { dir: path.slice(0, at + 1), name: path.slice(at + 1) }
}

export function NoOutputs({
  title,
  note,
  working = false,
  looked = [],
  ahead = [],
  look = 'light',
  headingLevel = 2,
  className,
  text,
  ...rest
}: NoOutputsProps) {
  const t = { ...noOutputsText, ...text }
  const id = useId()
  const words = (
    <>
      <Heading level={headingLevel} id={id} className={s.title}>
        {title}
      </Heading>
      {note !== undefined && <p className={s.note}>{note}</p>}
    </>
  )
  return (
    <section aria-labelledby={id} className={cx(s.none, s[look], className)} {...rest}>
      {look === 'light' && (
        <>
          <Light height={0.5} motion={working ? 'drift' : 'still'} />
          <div className={s.words}>{words}</div>
        </>
      )}
      {look === 'lit' && <Light height={0.34} motion={working ? 'drift' : 'still'} />}
      {(look === 'trail' || look === 'lit') && (
        <div className={s.column}>
          {words}
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
      )}
      {look === 'outline' && (
        <div className={s.column}>
          {words}
          {ahead.length > 0 && (
            <ol className={s.ahead}>
              {ahead.map((step, i) => (
                <li key={step.title} className={cx(s.step, s[step.state])} aria-current={step.state === 'now' ? 'step' : undefined}>
                  <span className={s.number} aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className={s.stepWords}>
                    <span className={s.stepTitle}>
                      {step.title}
                      {step.state === 'now' && (
                        <span className={s.when}>
                          {working && <LiveDot pulse />}
                          {t.now}
                        </span>
                      )}
                      {step.state === 'done' && <span className={s.when}>{t.done}</span>}
                    </span>
                    <span className={s.stepNote}>{step.note}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}
