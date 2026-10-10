import { type CSSProperties, Fragment, type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'

import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import { TaskStatus } from '../../foundations/vocabulary'
import { HomeRest } from '../../home/HomeRest/HomeRest'
import { NeedList } from '../../home/NeedLine/NeedLine'
import { type ProjectListItem, ProjectList, type ProjectListText } from '../../home/ProjectList/ProjectList'
import type { ProjectRef } from '../../home/ProjectWord/ProjectWord'
import { SinceRow, type SinceRowProps } from '../../home/SinceRow/SinceRow'
import { cx } from '../../lib/cx'
import { reducedMotion } from '../../lib/motion'
import { Button } from '../../primitives/Button/Button'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../primitives/Fold/Fold'
import { Heading } from '../../primitives/Heading/Heading'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { arrive } from '../Launch/Launch'
import s from './Home.module.css'

/*
 * The window you come back to, once there are projects. The middle is only
 * what waits on you, across every project, and its colour comes from the
 * projects it waits in: a wash of their inks behind the heading, their
 * marks beside how many, and the calls gathered under the project each is
 * from, a line each, answered where it is when a click will do and opened
 * as its task when it needs reading. Nothing but the calls is violet. Under
 * them, what the loop did since you last looked, as one line that opens.
 * Beside it, every project as a list, its mark large enough to see, with
 * the work in progress as still grey ticks: running asks nothing of you, so
 * it takes no room in the middle. There is no composer here: every
 * coordinator belongs to a project, so you talk to one in its project. The
 * window's bar is the consumer's.
 *
 * When nothing waits on you, the home rests (HomeRest): Althar's light at
 * the foot of the middle, and over it the marks of the projects where work
 * is moving, or with none, Althar's own, in the first screen's printed
 * halo, and under them what is true. With projects that have no task yet,
 * the way to their coordinators. When a call comes, the light lies down and
 * the calls arrive in its place.
 *
 * As the window opens, each line arrives on its own, top to bottom
 * (`data-arrive-each`, see screens/Launch).
 */

export interface HomeText {
  /** The page's name, for its outline. */
  title: string
  /** How many calls wait on you, over them. */
  yours: (n: number) => string
  /** Under it, where: in Halyard and Meridian, or in 4 projects. */
  where: (projects: readonly string[]) => string
  /** The line that opens what the loop did: how many things, since when you last looked (3 h ago). */
  since: (n: number, when: string) => string
  /** The projects' list. */
  projects: Partial<ProjectListText>
  /** What the home says at rest. */
  rest: {
    /** One project, with no task yet. */
    fresh: (project: string) => string
    /** Every project, none with a task yet. */
    allFresh: string
    /** Nothing waits on you. */
    quiet: string
    /** Under it, while work is moving: how much, and where. */
    moving: (tasks: number, projects: number) => string
    tellOne: string
    tellMany: string
    talk: (project: string) => string
    /** More projects with no task yet than it offers ways to. */
    more: (n: number) => string
  }
}

export const homeText: HomeText = {
  title: 'Home',
  yours: (n) => (n === 1 ? '1 thing needs you' : `${n} things need you`),
  where: (projects) =>
    projects.length > 3
      ? `in ${projects.length} projects`
      : `in ${projects.length === 1 ? projects[0] : `${projects.slice(0, -1).join(', ')} and ${projects.at(-1)}`}`,
  since: (n, when) => `${n === 1 ? '1 thing' : `${n} things`} since you looked, ${when}`,
  projects: {},
  rest: {
    fresh: (project) => `Nothing in ${project} yet`,
    allFresh: 'Nothing in your projects yet',
    quiet: 'Nothing needs you',
    moving: (tasks, projects) =>
      `${tasks === 1 ? '1 task' : `${tasks} tasks`} moving in ${projects === 1 ? '1 project' : `${projects} projects`}.`,
    tellOne: 'Tell its coordinator what you want done. It plans the tasks and hands them to your agents.',
    tellMany: 'Tell a project’s coordinator what you want done. It plans the tasks and hands them to your agents.',
    talk: (project) => `Talk to ${project}’s coordinator`,
    more: (n) => (n === 1 ? '1 more under Projects' : `${n} more under Projects`),
  },
}

/** The most projects it offers a way to a coordinator for, at rest. */
export const REST_WAYS = 3

/** The most marks it stacks beside the heading, and stands up at rest. */
export const MARKS_SHOWN = 4

/** A task in progress, as the home is given it: a tick in its project's row; still, when held or stopped. */
export interface HomeRun {
  id: string
  project: ProjectRef
  title: string
  status?: TaskStatus
}

/** Something that waits on you, as the home is given it: its line, and whose it is, to gather it under. */
export interface HomeNeed {
  key: string
  project: ProjectRef
  /** A NeedLine, settled where it was for a call just answered. */
  line: ReactNode
  /** Just answered: it stays where it was, but no longer counts as waiting. */
  answered?: boolean
}

/** Something the loop did, as its line is given it. */
export type HomeEvent = Omit<SinceRowProps, 'onOpen' | 'text'> & { id: string }

/** A project, as the home is given it, and whether it has had a task yet. */
export interface HomeProject {
  id: string
  project: ProjectRef
  /** Calls in it that wait on you. */
  yours: number
  /** What a quiet project says instead: Last task Friday. */
  note?: string
  /** No task has been made in it yet. */
  fresh?: boolean
}

export interface HomeProps {
  /** What waits on you, in order: each line, and whose it is. */
  needs?: readonly HomeNeed[]
  /** How many calls still wait on you. */
  waiting: number
  /** Every task in progress, by project. */
  running: readonly HomeRun[]
  since: readonly HomeEvent[]
  /** When you last looked: 3 h ago. */
  looked: string
  projects: readonly HomeProject[]
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

/** The needs gathered by project, each project where its first one is. */
const groupsOf = (needs: readonly HomeNeed[]) => {
  const groups = new Map<string, { project: ProjectRef; lines: HomeNeed[] }>()
  for (const need of needs) {
    const group = groups.get(need.project.seed) ?? { project: need.project, lines: [] }
    group.lines.push(need)
    groups.set(need.project.seed, group)
  }
  return [...groups.values()]
}

/** The first three projects' inks, for the wash behind the heading. */
const washOf = (projects: readonly ProjectRef[]) =>
  Object.fromEntries(projects.slice(0, 3).map((project, i) => [`--wash-${i + 1}`, `var(--project-${project.ink})`])) as CSSProperties

const movingOf = (run: HomeRun) => (run.status ?? TaskStatus.Running) === TaskStatus.Running

export function Home({
  needs = [],
  waiting,
  running,
  since,
  looked,
  projects,
  onOpenEvent,
  onOpenProject,
  onTalk,
  onOpenFolder,
  className,
  text,
}: HomeProps) {
  const t = { ...homeText, ...text, rest: { ...homeText.rest, ...text?.rest } }
  const headingId = useId()
  const resting = waiting === 0 && needs.length === 0
  // At rest it shows at once; leaving, it stays until its light has lain down, then the calls arrive.
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

  const list: ProjectListItem[] = projects.map((p) => ({
    id: p.id,
    project: p.project,
    yours: p.yours,
    tasks: running
      .filter((run) => run.project.seed === p.project.seed)
      .map((run) => ({ id: run.id, ...(run.status === undefined ? {} : { status: run.status }) })),
    ...(p.note === undefined ? {} : { note: p.note }),
  }))
  const sinceLine = since.length > 0 && <Since since={since} looked={looked} t={t} {...(onOpenEvent ? { onOpenEvent } : {})} />
  const groups = groupsOf(needs)
  // Whose calls still wait, for the heading, its marks and its wash: not a project whose only line was just answered.
  const whose = groupsOf(needs.filter((need) => need.answered !== true)).map((group) => group.project)

  return (
    <div className={cx(s.home, className)}>
      <main className={cx(s.stream, !atRest && s.washed)} style={atRest ? undefined : washOf(whose)}>
        <Heading level={1} className={s.title}>
          <VisuallyHidden>{t.title}</VisuallyHidden>
        </Heading>
        {atRest ? (
          <Rest
            t={t.rest}
            since={sinceLine}
            hasSince={since.length > 0}
            projects={projects}
            running={running}
            leaving={leaving}
            onLeft={() => {
              cameFromRest.current = true
              setAtRest(false)
            }}
            {...(onTalk ? { onTalk } : {})}
          />
        ) : (
          <div ref={stream} className={s.column}>
            <section aria-labelledby={headingId} className={s.needs}>
              <header className={s.head} data-arrive>
                <span className={s.stack} aria-hidden="true">
                  {whose.slice(0, MARKS_SHOWN).map((project) => (
                    <ProjectMark key={project.seed} seed={project.seed} ink={project.ink} size={34} />
                  ))}
                </span>
                <span className={s.headWords}>
                  <Heading level={2} id={headingId} className={s.yours}>
                    {t.yours(waiting)}
                  </Heading>
                  {whose.length > 0 && <span className={s.where}>{t.where(whose.map((project) => project.name))}</span>}
                </span>
              </header>
              {groups.map(({ project, lines }) => (
                <Group key={project.seed} project={project}>
                  {lines.map((need) => (
                    <Fragment key={need.key}>{need.line}</Fragment>
                  ))}
                </Group>
              ))}
            </section>
            {sinceLine}
          </div>
        )}
      </main>

      <ProjectList
        projects={list}
        className={s.projects}
        text={t.projects}
        {...(onOpenProject ? { onOpenProject } : {})}
        {...(onOpenFolder ? { onOpenFolder } : {})}
      />
    </div>
  )
}

/** One project's calls, under its mark and name; the lines needn't say whose again. */
function Group({ project, children }: { project: ProjectRef; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={s.group}>
      <Heading level={3} id={id} className={s.groupHead} data-arrive>
        <ProjectMark seed={project.seed} ink={project.ink} size={20} />
        {project.name}
      </Heading>
      <NeedList whose={false} headingLevel={4} data-arrive-each>
        {children}
      </NeedList>
    </section>
  )
}

/** What the loop did since you looked: one line, which opens to a line each. */
function Since({
  since,
  looked,
  t,
  onOpenEvent,
}: {
  since: readonly HomeEvent[]
  looked: string
  t: HomeText
  onOpenEvent?: (id: string) => void
}) {
  return (
    <Disclosure className={s.since} data-arrive>
      <DisclosureTrigger>
        <button type="button" className={s.sinceLine}>
          <span className={s.sinceWords}>{t.since(since.length, looked)}</span>
          <Caret />
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <ul className={s.events}>
          {since.map(({ id, ...event }) => (
            <li key={id}>
              <SinceRow {...event} {...(onOpenEvent ? { onOpen: () => onOpenEvent(id) } : {})} />
            </li>
          ))}
        </ul>
      </Fold>
    </Disclosure>
  )
}

/** The home at rest: what it says, and the ways on or what happened under it. */
function Rest({
  t,
  since,
  hasSince,
  projects,
  running,
  leaving,
  onLeft,
  onTalk,
}: {
  t: HomeText['rest']
  since: ReactNode
  hasSince: boolean
  projects: readonly HomeProject[]
  running: readonly HomeRun[]
  leaving: boolean
  onLeft: () => void
  onTalk?: (id: string) => void
}) {
  const fresh = projects.filter((project) => project.fresh === true)
  const [only] = projects
  const everyFresh = !hasSince && fresh.length > 0 && fresh.length === projects.length
  const title = !everyFresh ? t.quiet : projects.length === 1 && only ? t.fresh(only.project.name) : t.allFresh
  // Where work is moving, its projects' marks stand up in place of Althar's.
  const moving = running.filter(movingOf)
  const where = projects.filter((p) => moving.some((run) => run.project.seed === p.project.seed))
  const note = everyFresh
    ? projects.length === 1
      ? t.tellOne
      : t.tellMany
    : moving.length > 0
      ? t.moving(moving.length, where.length)
      : undefined
  const ways = !hasSince && onTalk ? fresh.slice(0, REST_WAYS) : []
  const figure =
    where.length > 0 ? (
      <span className={s.marks}>
        {where.slice(0, MARKS_SHOWN).map(({ id, project }) => (
          <span key={id} className={s.markOne}>
            <ProjectMark seed={project.seed} ink={project.ink} size={52} />
            <span>{project.name}</span>
          </span>
        ))}
      </span>
    ) : undefined
  return (
    <HomeRest
      title={title}
      {...(note === undefined ? {} : { note })}
      {...(figure === undefined ? {} : { figure })}
      leaving={leaving}
      onLeft={onLeft}
    >
      {hasSince && <div className={s.restSince}>{since}</div>}
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
