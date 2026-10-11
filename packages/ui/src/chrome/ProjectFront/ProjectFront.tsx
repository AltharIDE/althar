import type { CSSProperties, ReactNode } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { BrandMark } from '../../foundations/Marks/Marks'
import type { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { type WorkNeed, WorkStatus } from '../WorkStatus/WorkStatus'
import s from './ProjectFront.module.css'

/*
 * The top of a project's screen, as its own front page: its mark large in a
 * wash of its ink, its name as the screen's heading, how it stands in one
 * line, and what it is made of under that. How it stands is what needs you
 * (a way into the first of it, and pointed at, what each is), how much is in
 * progress, and what settled last; what it is made of is its repositories,
 * each with its host's mark, and the tracker its tasks name. Only what there
 * is to say shows. Its settings open from the slot at the end.
 */

export interface ProjectFrontText {
  inProgress: (n: number) => string
  /** The list of what the project is made of, for its landmark. */
  madeOf: string
}

export const projectFrontText: ProjectFrontText = {
  inProgress: (n) => `${n} in progress`,
  madeOf: 'Made of',
}

/** Something the project is made of: a repository with its host's mark, or the tracker its tasks name. */
export interface ProjectPart {
  id: string
  name: string
  /** Its host's or tracker's mark; without one, an empty place where it would be. */
  brand?: Brand
}

export type ProjectFrontProps = RootProps<
  'header',
  {
    name: string
    /** What its mark is drawn from: what stays when it is renamed, such as its id. */
    seed: string
    ink: ProjectInk
    /** How many things wait on you; with none, nothing is said of them. */
    yours?: number
    /** What waits on you, shown while the count is pointed at, each opening its own. */
    needs?: ReadonlyArray<WorkNeed>
    /** Opens the first thing that waits on you; without it, the count is words. */
    onYours?: () => void
    /** How many tasks are in progress; with none, nothing is said of them. */
    inProgress?: number
    /** What settled last, in words: PR 1184 merged 3h ago. */
    last?: string
    /** What the project is made of, its repositories first. */
    parts?: ReadonlyArray<ProjectPart>
    /** The way to the project's settings, at the end: a ControlCenter with its button. */
    settings?: ReactNode
    headingLevel?: HeadingLevel
    text?: Partial<ProjectFrontText>
  }
>

export function ProjectFront({
  name,
  seed,
  ink,
  yours = 0,
  needs,
  onYours,
  inProgress = 0,
  last,
  parts = [],
  settings,
  headingLevel = 1,
  className,
  style,
  text,
  ...rest
}: ProjectFrontProps) {
  const t = { ...projectFrontText, ...text }
  // How it stands, each part only where there is something to say.
  const standing: ReactNode[] = [
    ...(yours > 0
      ? [
          <WorkStatus
            key="yours"
            yours={yours}
            {...(onYours === undefined ? {} : { onYours })}
            {...(needs === undefined ? {} : { needs })}
            align="start"
            className={s.yours}
          />,
        ]
      : []),
    ...(inProgress > 0 ? [<span key="progress">{t.inProgress(inProgress)}</span>] : []),
    ...(last === undefined || last === '' ? [] : [<span key="last">{last}</span>]),
  ]
  return (
    <header className={cx(s.front, className)} style={{ '--ink': `var(--project-${ink})`, ...style } as CSSProperties} {...rest}>
      <ProjectMark seed={seed} ink={ink} size={56} className={s.mark} />
      <div className={s.words}>
        <Heading level={headingLevel} className={s.name}>
          {name}
        </Heading>
        {standing.length > 0 && (
          <p className={s.standing}>
            {standing.flatMap((part, i) =>
              i === 0
                ? [part]
                : [
                    <span key={`dot-${i}`} className={s.dot} aria-hidden="true">
                      ·
                    </span>,
                    part,
                  ],
            )}
          </p>
        )}
        {parts.length > 0 && (
          <ul className={s.parts} aria-label={t.madeOf}>
            {parts.map((part) => (
              <li key={part.id} className={s.part}>
                {part.brand === undefined ? <span className={s.noMark} aria-hidden="true" /> : <BrandMark brand={part.brand} size={11} />}
                {part.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      {settings != null && <div className={s.end}>{settings}</div>}
    </header>
  )
}
