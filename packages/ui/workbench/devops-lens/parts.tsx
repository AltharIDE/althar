import type { ReactNode } from 'react'

import { Heading, LiveDot } from '../../src'
import type { Tone } from './data'
import s from './devops.module.css'

/* Small pieces the DevOps views share. */

export const Dot = ({ tone = 'quiet' }: { tone?: Tone }) =>
  tone === 'live' ? <LiveDot /> : <i className={s.dot} data-tone={tone} aria-hidden="true" />

/** A state in words with its dot: Healthy, Rolling out, CrashLoopBackOff. */
export const State = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <span className={s.state} data-tone={tone}>
    <Dot tone={tone} />
    {children}
  </span>
)

/** A section of a page: its title, an optional line beside it, and what it holds. */
export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`${s.section} ${className ?? ''}`} aria-label={title}>
      <header className={s.sectionHead}>
        <Heading level={2} className={s.sectionTitle}>
          {title}
        </Heading>
        {aside !== undefined && <span className={s.sectionAside}>{aside}</span>}
      </header>
      {children}
    </section>
  )
}

/** A share of something, as a thin bar and its percent, coloured when it runs high. */
export function Meter({ value }: { value: number }) {
  const tone = value >= 0.85 ? 'danger' : value >= 0.7 ? 'warm' : 'quiet'
  return (
    <span className={s.meter} data-tone={tone}>
      <span className={s.meterTrack}>
        <span className={s.meterFill} style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className={s.meterValue}>{Math.round(value * 100)}%</span>
    </span>
  )
}

/** A stage for a single piece, on the page's background. */
export const Stage = ({ children, width = 720 }: { children: ReactNode; width?: number }) => (
  <div className={s.stage}>
    <div className={s.stageInner} style={{ maxWidth: width }}>
      {children}
    </div>
  </div>
)

export const Mono = ({ children }: { children: ReactNode }) => <code className={s.mono}>{children}</code>
