import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import type { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './ProjectWord.module.css'

/*
 * A project where a line of work names it, on the home: its mark, then its
 * name. Every line about work across projects says whose it is this way, so
 * the eye learns the marks.
 */

/** A project as the home draws it: what its mark is drawn from, and its name. */
export interface ProjectRef {
  /** What stays when the project is renamed, such as its id. */
  seed: string
  ink: ProjectInk
  name: string
}

export type ProjectWordProps = RootProps<'span', { project: ProjectRef }>

export function ProjectWord({ project, className, ...rest }: ProjectWordProps) {
  return (
    <span className={cx(s.word, className)} {...rest}>
      <ProjectMark seed={project.seed} ink={project.ink} size={15} />
      {project.name}
    </span>
  )
}
