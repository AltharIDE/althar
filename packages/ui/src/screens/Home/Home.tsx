import { Children, type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'

import { HomeLane } from '../../foundations/vocabulary'
import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import { HomeRest } from '../../home/HomeRest/HomeRest'
import { HomeSection } from '../../home/HomeSection/HomeSection'
import { ProjectRow, type ProjectRowProps } from '../../home/ProjectRow/ProjectRow'
import { RunRow, type RunRowProps } from '../../home/RunRow/RunRow'
import { SinceRow, type SinceRowProps } from '../../home/SinceRow/SinceRow'
import { cx } from '../../lib/cx'
import { reducedMotion } from '../../lib/motion'
import { Button } from '../../primitives/Button/Button'
import { Heading } from '../../primitives/Heading/Heading'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { arrive } from '../Launch/Launch'
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
 * When nothing waits on you and nothing is in progress, and the loop has
 * done little since you looked, the home rests (HomeRest): Althar's light
 * at the foot of the stream, the mark over it, and under the mark what is
 * true. With projects that have no task yet, the way to their coordinators;
 * otherwise the last few things the loop did. When work comes, the light
 * lies down and the stream arrives in its place.
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
  /** What the home says at rest. */
  rest: {
    /** One project, with no task yet. */
    fresh: (project: string) => string
    /** Every project, none with a task yet. */
    allFresh: string
    /** Projects that have had work, and nothing going on now. */
    quiet: string
    tellOne: string
    tellMany: string
    nothing: string
    /** Before the last few things the loop did: when you last looked, 3 h ago. */
    since: (when: string) => string
    talk: (project: string) => string
    /** More projects with no task yet than it offers ways to. */
    more: (n: number) => string
  }
}

export const homeText: HomeText = {
  title: 'Home',
  projects: 'Projects',
  openFolder: 'Open a folder',
  openFolderKbd: '⌘N',
  rest: {
    fresh: (project) => `Nothing in ${project} yet`,
    allFresh: 'Nothing in your projects yet',
    quiet: 'All quiet',
    tellOne: 'Tell its coordinator what you want done. It plans the tasks and hands them to your agents.',
    tellMany: 'Tell a project’s coordinator what you want done. It plans the tasks and hands them to your agents.',
    nothing: 'Nothing needs you and nothing is in progress.',
    since: (when) => `Nothing needs you and nothing is in progress. Since you looked, ${when}:`,
    talk: (project) => `Talk to ${project}’s coordinator`,
    more: (n) => (n === 1 ? '1 more under Projects' : `${n} more under Projects`),
  },
}

/** The most things the loop did that the home still rests over; past them, it shows the stream. */
export const REST_SINCE = 4
/** The most projects it offers a way to a coordinator for, at rest. */
export const REST_WAYS = 3

/** A running task, as its row is given it. */
export type HomeRun = Omit<RunRowProps, 'onOpen' | 'text'> & { id: string }

/** Something the loop did, as its line is given it. */
export type HomeEvent = Omit<SinceRowProps, 'onOpen' | 'text'> & { id: string }

/** A project, as its row is given it, and whether it has had a task yet. */
export type HomeProject = Omit<ProjectRowProps, 'onOpen' | 'className' | 'text'> & {
  id: string
  /** No task has been made in it yet. */
  fresh?: boolean
}

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
  /** Open a project's conversation with its coordinator, by the project's id. Without it, the home at rest offers no way to one. */
  onTalk?: (id: string) => void
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
  onTalk,
  onOpenFolder,
  className,
  text,
}: HomeProps) {
  const t = { ...homeText, ...text }
  const projectsId = useId()
  const resting = waiting === 0 && Children.toArray(needs).length === 0 && running.length === 0 && since.length <= REST_SINCE
  // At rest it shows at once; leaving, it stays until its light has lain down, then the stream arrives.
  const [atRest, setAtRest] = useState(resting)
  if (resting && !atRest) setAtRest(true)
  const leaving = atRest && !resting
  const stream = useRef<HTMLDivElement>(null)
  const cameFromRest = useRef(false)
  useLayoutEffect(() => {
    if (atRest || !cameFromRest.current) return
    cameFromRest.current = false
    if (stream.current && !reducedMotion()) arrive(stream.current)
  }, [atRest])

  return (
    <div className={cx(s.home, className)}>
      <main className={s.stream}>
        <Heading level={1} className={s.title}>
          <VisuallyHidden>{t.title}</VisuallyHidden>
        </Heading>
        {atRest ? (
          <Rest
            t={t.rest}
            since={since}
            looked={looked}
            projects={projects}
            leaving={leaving}
            onLeft={() => {
              cameFromRest.current = true
              setAtRest(false)
            }}
            {...(onTalk ? { onTalk } : {})}
            {...(onOpenEvent ? { onOpenEvent } : {})}
          />
        ) : (
          <div ref={stream} className={s.column}>
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
        )}
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

/** The home at rest: what it says, and the ways on or the last few lines under it. */
function Rest({
  t,
  since,
  looked,
  projects,
  leaving,
  onLeft,
  onTalk,
  onOpenEvent,
}: {
  t: HomeText['rest']
  since: readonly HomeEvent[]
  looked: string
  projects: readonly HomeProject[]
  leaving: boolean
  onLeft: () => void
  onTalk?: (id: string) => void
  onOpenEvent?: (id: string) => void
}) {
  const fresh = projects.filter((project) => project.fresh === true)
  const [only] = projects
  const everyFresh = since.length === 0 && fresh.length > 0 && fresh.length === projects.length
  const title = !everyFresh ? t.quiet : projects.length === 1 && only ? t.fresh(only.project.name) : t.allFresh
  const note = since.length > 0 ? t.since(looked) : everyFresh ? (projects.length === 1 ? t.tellOne : t.tellMany) : t.nothing
  const ways = since.length === 0 && onTalk ? fresh.slice(0, REST_WAYS) : []
  return (
    <HomeRest title={title} note={note} leaving={leaving} onLeft={onLeft}>
      {since.length > 0 && (
        <ul className={s.restSince} data-arrive-each>
          {since.map(({ id, ...event }) => (
            <li key={id}>
              <SinceRow {...event} {...(onOpenEvent ? { onOpen: () => onOpenEvent(id) } : {})} />
            </li>
          ))}
        </ul>
      )}
      {ways.length > 0 && (
        <div className={s.ways}>
          {ways.map(({ id, project }) => (
            <Button key={id} onClick={() => onTalk?.(id)} className={s.way}>
              <ProjectMark seed={project.seed} ink={project.ink} size={16} />
              {t.talk(project.name)}
            </Button>
          ))}
          {fresh.length > ways.length && <p className={s.moreWays}>{t.more(fresh.length - ways.length)}</p>}
        </div>
      )}
    </HomeRest>
  )
}
