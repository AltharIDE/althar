import { useId } from 'react'

import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import { TaskStatus } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../primitives/Fold/Fold'
import { Heading } from '../../primitives/Heading/Heading'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import type { ProjectRef } from '../ProjectWord/ProjectWord'
import { WorkTicks } from '../WorkTicks/WorkTicks'
import s from './ProjectList.module.css'

/*
 * Every project, as the home's side list: a row each, the ones that need
 * you first, then the ones with work in progress, then the quiet ones. A
 * row is the project's mark, large enough to see as its picture, its name,
 * and a quiet line under it: what is off (held for a reset, stopped), or
 * else how much is in progress, or else when it last had a task. At its
 * end, how many calls wait there, in violet; otherwise a still grey tick
 * for each task in progress. The row opens the project, where its tasks
 * are. Past QUIET_FOLD projects, the quiet ones fold into one line at the
 * end. The list scrolls on its own, so thirty projects are a longer list,
 * not a different page.
 */

/** Past this many projects, the quiet ones fold away. */
export const QUIET_FOLD = 8

export interface ProjectListText {
  title: string
  openFolder: string
  openFolderKbd: string
  /** Read after a project's name. */
  yours: (n: number) => string
  held: (n: number) => string
  stopped: (n: number) => string
  waiting: (n: number) => string
  /** Under a project's name, with nothing off: how many tasks are in progress in it. */
  inProgress: (n: number) => string
  quiet: (n: number) => string
}

export const projectListText: ProjectListText = {
  title: 'Projects',
  openFolder: 'Open a folder',
  openFolderKbd: '⌘N',
  yours: (n) => (n === 1 ? '1 needs you' : `${n} need you`),
  held: (n) => `${n} held for a reset`,
  stopped: (n) => `${n} stopped`,
  waiting: (n) => `${n} waiting`,
  inProgress: (n) => (n === 1 ? '1 task in progress' : `${n} tasks in progress`),
  quiet: (n) => (n === 1 ? '1 quiet project' : `${n} quiet projects`),
}

/** A task in progress, as a tick in its project's row: still, when held or stopped. */
export interface ProjectListTask {
  id: string
  status?: TaskStatus
}

/** A project, as its row is given it. */
export interface ProjectListItem {
  id: string
  project: ProjectRef
  /** Calls in it that wait on you. */
  yours: number
  /** Its tasks in progress, in order. */
  tasks: readonly ProjectListTask[]
  /** What a project with nothing going on says under its name: Last task 11 days ago. */
  note?: string
}

export type ProjectListProps = RootProps<
  'aside',
  {
    projects: readonly ProjectListItem[]
    onOpenProject?: (id: string) => void
    /** Open a folder as a new project. Without it, no way to from here. */
    onOpenFolder?: () => void
    text?: Partial<ProjectListText>
  }
>

/** Only what is off, in a few words; nothing when all is well. */
const offOf = (tasks: readonly ProjectListTask[], t: ProjectListText) => {
  const count = (status: TaskStatus) => tasks.filter((task) => task.status === status).length
  return [
    count(TaskStatus.Paused) > 0 && t.held(count(TaskStatus.Paused)),
    count(TaskStatus.Stopped) > 0 && t.stopped(count(TaskStatus.Stopped)),
    count(TaskStatus.Yours) > 0 && t.waiting(count(TaskStatus.Yours)),
  ]
    .filter(Boolean)
    .join(' · ')
}

export function ProjectList({ projects, onOpenProject, onOpenFolder, className, text, ...rest }: ProjectListProps) {
  const t = { ...projectListText, ...text }
  const titleId = useId()
  const quietOf = (p: ProjectListItem) => p.yours === 0 && p.tasks.length === 0
  // Needs you, then work in progress, then quiet: each group in the order given.
  const order = [...projects.filter((p) => p.yours > 0), ...projects.filter((p) => p.yours === 0 && p.tasks.length > 0)]
  const quiet = projects.filter(quietOf)
  const fold = projects.length > QUIET_FOLD
  const row = (p: ProjectListItem) => <Row key={p.id} p={p} t={t} onOpenProject={onOpenProject} />
  return (
    <aside aria-labelledby={titleId} className={cx(s.list, className)} {...rest}>
      <header className={s.head} data-arrive>
        <Heading level={2} id={titleId} className={s.title}>
          {t.title}
        </Heading>
        <span className={s.count}>{projects.length}</span>
        {onOpenFolder && (
          <IconButton icon="plus" label={t.openFolder} kbd={t.openFolderKbd} size="small" className={s.add} onClick={onOpenFolder} />
        )}
      </header>
      <div className={s.scroll}>
        <ul className={s.rows} data-arrive-each>
          {order.map(row)}
          {!fold && quiet.map(row)}
        </ul>
        {fold && quiet.length > 0 && (
          <Disclosure className={s.quiet}>
            <DisclosureTrigger>
              <button type="button" className={s.quietLine}>
                {t.quiet(quiet.length)}
                <Caret />
              </button>
            </DisclosureTrigger>
            <Fold bleed={false}>
              <ul className={s.rows}>{quiet.map(row)}</ul>
            </Fold>
          </Disclosure>
        )}
      </div>
    </aside>
  )
}

function Row({ p, t, onOpenProject }: { p: ProjectListItem; t: ProjectListText; onOpenProject?: ((id: string) => void) | undefined }) {
  const quiet = p.yours === 0 && p.tasks.length === 0
  const said = offOf(p.tasks, t) || (p.tasks.length > 0 ? t.inProgress(p.tasks.length) : p.note)
  const body = (
    <>
      <ProjectMark seed={p.project.seed} ink={p.project.ink} size={30} quiet={quiet} className={s.mark} />
      <span className={s.words}>
        <span className={s.name}>{p.project.name}</span>
        {said && <span className={s.said}>{said}</span>}
      </span>
      {p.yours > 0 ? (
        <span className={s.yours}>
          <i aria-hidden="true" />
          <span aria-hidden="true">{p.yours}</span>
          <VisuallyHidden>, {t.yours(p.yours)}</VisuallyHidden>
        </span>
      ) : (
        p.tasks.length > 0 && <WorkTicks tasks={p.tasks} max={5} aria-hidden="true" className={s.ticks} />
      )}
    </>
  )
  return (
    <li className={cx(s.item, quiet && s.quietItem)}>
      {onOpenProject ? (
        <button type="button" className={s.row} onClick={() => onOpenProject(p.id)}>
          {body}
        </button>
      ) : (
        <span className={s.row}>{body}</span>
      )}
    </li>
  )
}
