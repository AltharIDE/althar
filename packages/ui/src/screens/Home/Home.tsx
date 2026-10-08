import { Children, type ReactNode, useId } from 'react'

import { HomeLane } from '../../foundations/vocabulary'
import { HomeSection } from '../../home/HomeSection/HomeSection'
import { ProjectRow, type ProjectRowProps } from '../../home/ProjectRow/ProjectRow'
import { RunRow, type RunRowProps } from '../../home/RunRow/RunRow'
import { SinceRow, type SinceRowProps } from '../../home/SinceRow/SinceRow'
import { cx } from '../../lib/cx'
import { Heading } from '../../primitives/Heading/Heading'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './Home.module.css'

/*
 * The window you come back to, once there are projects. One stream across
 * every project, in the order you deal with it: what waits on you, what
 * is in progress, and what the loop did since you last looked. Beside it,
 * every project, as the way into each.
 *
 * A call that can be answered in a click is answered where it is; anything
 * else opens its task. There is no side panel to read it in. There is no composer here: every coordinator belongs to a project, so you
 * talk to one in its project. The window's bar is the consumer's.
 *
 * As the window opens, each card and row arrives on its own, top to bottom
 * (`data-arrive-each`, see screens/Launch).
 */

export interface HomeText {
  /** The page's name, for its outline. */
  title: string
  projects: string
  openFolder: string
  openFolderKbd: string
}

export const homeText: HomeText = {
  title: 'Home',
  projects: 'Projects',
  openFolder: 'Open a folder',
  openFolderKbd: '⌘N',
}

/** A running task, as its row is given it. */
export type HomeRun = Omit<RunRowProps, 'onOpen' | 'text'> & { id: string }

/** Something the loop did, as its line is given it. */
export type HomeEvent = Omit<SinceRowProps, 'onOpen' | 'text'> & { id: string }

/** A project, as its row is given it. */
export type HomeProject = Omit<ProjectRowProps, 'onOpen' | 'className' | 'text'> & { id: string }

export interface HomeProps {
  /** What waits on you: NeedCards, and AskAnswered lines for the calls just answered. */
  needs?: ReactNode
  /** How many calls still wait on you. */
  waiting: number
  running: readonly HomeRun[]
  since: readonly HomeEvent[]
  /** When you last looked: 3 h ago. */
  looked: string
  projects: readonly HomeProject[]
  onOpenTask?: (id: string) => void
  /** Open what something the loop did happened to, by the event's id. */
  onOpenEvent?: (id: string) => void
  onOpenProject?: (id: string) => void
  /** Open a folder as a new project. Without it, no way to from here. */
  onOpenFolder?: () => void
  className?: string
  text?: Partial<HomeText>
}

export function Home({
  needs,
  waiting,
  running,
  since,
  looked,
  projects,
  onOpenTask,
  onOpenEvent,
  onOpenProject,
  onOpenFolder,
  className,
  text,
}: HomeProps) {
  const t = { ...homeText, ...text }
  const projectsId = useId()
  return (
    <div className={cx(s.home, className)}>
      <main className={s.stream}>
        <Heading level={1} className={s.title}>
          <VisuallyHidden>{t.title}</VisuallyHidden>
        </Heading>
        <div className={s.column}>
          <HomeSection lane={HomeLane.Yours} count={waiting}>
            {Children.toArray(needs).length > 0 && (
              <div className={s.cards} data-arrive-each>
                {needs}
              </div>
            )}
          </HomeSection>
          <HomeSection lane={HomeLane.Running} count={running.length}>
            {running.length > 0 && (
              <ul className={s.rows} data-arrive-each>
                {running.map(({ id, ...run }) => (
                  <li key={id}>
                    <RunRow {...run} {...(onOpenTask ? { onOpen: () => onOpenTask(id) } : {})} />
                  </li>
                ))}
              </ul>
            )}
          </HomeSection>
          <HomeSection lane={HomeLane.Since} count={since.length} when={looked}>
            {since.length > 0 && (
              <ul className={s.events} data-arrive-each>
                {since.map(({ id, ...event }) => (
                  <li key={id}>
                    <SinceRow {...event} {...(onOpenEvent ? { onOpen: () => onOpenEvent(id) } : {})} />
                  </li>
                ))}
              </ul>
            )}
          </HomeSection>
        </div>
      </main>

      <aside className={s.projects} aria-labelledby={projectsId}>
        <header className={s.projectsHead} data-arrive>
          <Heading level={2} id={projectsId} className={s.projectsTitle}>
            {t.projects}
          </Heading>
          {onOpenFolder && <IconButton icon="plus" label={t.openFolder} kbd={t.openFolderKbd} size="small" onClick={onOpenFolder} />}
        </header>
        <ul className={s.list} data-arrive-each>
          {projects.map(({ id, ...project }) => (
            <li key={id}>
              <ProjectRow {...project} {...(onOpenProject ? { onOpen: () => onOpenProject(id) } : {})} />
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
