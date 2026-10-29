import type { ReactNode } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { BrandMark } from '../../foundations/Marks/Marks'
import type { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import { Room, TaskStatus } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Menu, MenuGroup, MenuItem } from '../../primitives/Menu/Menu'
import { ChromeButton } from '../ChromeButton/ChromeButton'
import { roomOptions, type RoomSwitchText } from '../RoomSwitch/RoomSwitch'
import { TaskHeader } from '../TaskHeader/TaskHeader'
import { TitleBar, type TitleBarProps } from '../TitleBar/TitleBar'
import { type WorkNeed, WorkStatus, workStatusText } from '../WorkStatus/WorkStatus'
import s from './ProjectHeader.module.css'

/*
 * The top of a project's screen, under the window's bar: the bar a task has,
 * so nothing at the top moves between a project and its tasks. Where a task
 * has its way back and its title, the project has its mark and its name, the
 * screen's heading. Then, as a task's: where it stands in one chip, its
 * views as its faces, and what it opens at the end.
 *
 * Where it stands is violet while something waits on you, its count a way
 * into the first of it (pointed at, what each is); blue while work runs, how
 * much; grey and checked when neither. Until the work is read, no chip.
 *
 * Its views are all five, home, the conversation, the board, its automations
 * and its settings, a violet dot on the last two where one paused itself or
 * a connection waits on you. The window's bar keeps only the tabs.
 *
 * At the end, what it runs (a RunButton), then ⋯, what it is made of: its
 * repositories, each with its host's mark, and the tracker its tasks name,
 * each opening where it lives. The project's colour is in its mark alone.
 */

export interface ProjectHeaderText {
  /** The views, for their landmark. */
  views: string
  /** Nothing waits and nothing runs. */
  quiet: string
  /** What the project is made of, as ⋯ names it. */
  madeOf: string
  /** The views' own names and dots' words (RoomSwitch). */
  rooms?: Partial<RoomSwitchText>
}

export const projectHeaderText: ProjectHeaderText = {
  views: 'View',
  quiet: 'Nothing running',
  madeOf: 'Made of',
}

/** Something the project is made of: a repository with its host's mark, or the tracker its tasks name. */
export interface ProjectPart {
  id: string
  name: string
  /** Its host's or tracker's mark; without one, an empty place where it would be. */
  brand?: Brand
  /** Opens it where it lives (its repository on its host, its tracker's space); without it, it is listed, not offered. */
  onOpen?: () => void
  /** What opening it says: Open on GitHub. */
  openLabel?: string
}

export interface ProjectHeaderProps {
  name: string
  /** What its mark is drawn from: what stays when it is renamed, such as its id. */
  seed: string
  ink: ProjectInk
  /** How many things wait on you; with this and inProgress both unknown (the work not read yet), no chip. */
  yours?: number
  /** What waits on you, shown while the count is pointed at, each opening its own. */
  needs?: ReadonlyArray<WorkNeed>
  /** Opens the first thing that waits on you; without it, the count is words. */
  onYours?: () => void
  /** How many tasks are at work. */
  inProgress?: number
  /** The view it is on. */
  room: Room
  onRoom: (room: Room) => void
  /** The conversation has something you haven't seen. */
  news?: boolean
  /** Something in its settings waits on you, such as a connection to sign in again. */
  settingsNeedYou?: boolean
  /** One of its automations paused itself, and says why. */
  automationsNeedYou?: boolean
  /** What the project is made of, its repositories first; with none, no ⋯. */
  parts?: ReadonlyArray<ProjectPart>
  /** What it runs, with no agent: a RunButton. */
  run?: ReactNode
  /** Under the tabs, none; a window of its own leaves room for the system's lights. */
  lights?: TitleBarProps['lights']
  headingLevel?: HeadingLevel
  className?: string
  text?: Partial<ProjectHeaderText>
}

export function ProjectHeader({
  name,
  seed,
  ink,
  yours,
  needs,
  onYours,
  inProgress,
  room,
  onRoom,
  news,
  settingsNeedYou,
  automationsNeedYou,
  parts = [],
  run,
  lights = 'none',
  headingLevel = 1,
  className,
  text,
}: ProjectHeaderProps) {
  const t = { ...projectHeaderText, ...text }
  const { status, state } = standingOf({ yours, needs, onYours, inProgress }, t)
  return (
    <TitleBar
      lights={lights}
      className={cx(s.bar, className)}
      end={
        <TaskHeader
          title={name}
          status={status}
          {...(state === null ? {} : { state })}
          faces={roomOptions({
            ...(news === undefined ? {} : { news }),
            ...(settingsNeedYou === undefined ? {} : { needsYou: settingsNeedYou }),
            ...(automationsNeedYou === undefined ? {} : { automationsNeedYou }),
            // The views have no shortcut of their own: ⌘ and a number belongs to the window's tabs.
            text: { key: () => '', ...t.rooms },
          })}
          face={room}
          onFace={onRoom}
          text={{ faces: t.views }}
          actions={
            (run != null || parts.length > 0) && (
              <>
                {run}
                <MadeOf parts={parts} label={t.madeOf} />
              </>
            )
          }
        />
      }
    >
      <span className={s.crumb}>
        <ProjectMark seed={seed} ink={ink} size={18} className={s.mark} />
        <Heading level={headingLevel} className={s.name} title={name}>
          {name}
        </Heading>
      </span>
    </TitleBar>
  )
}

/** One chip for where it stands: what waits on you first, then what runs, then neither; nothing until either is known. */
function standingOf(
  { yours, needs, onYours, inProgress }: Pick<ProjectHeaderProps, 'yours' | 'needs' | 'onYours' | 'inProgress'>,
  t: ProjectHeaderText,
): { status: TaskStatus; state: ReactNode | null } {
  if (yours === undefined && inProgress === undefined) return { status: TaskStatus.Done, state: null }
  if (yours !== undefined && yours > 0)
    return {
      status: TaskStatus.Yours,
      state: (
        <WorkStatus
          bare
          yours={yours}
          align="start"
          {...(onYours === undefined ? {} : { onYours })}
          {...(needs === undefined ? {} : { needs })}
        />
      ),
    }
  if (inProgress !== undefined && inProgress > 0) return { status: TaskStatus.Running, state: workStatusText.running(inProgress) }
  return { status: TaskStatus.Done, state: t.quiet }
}

/** ⋯: what the project is made of, each opening where it lives. */
function MadeOf({ parts, label }: { parts: ReadonlyArray<ProjectPart>; label: string }) {
  if (parts.length === 0) return null
  return (
    <Menu label={label} align="end" width={280} trigger={<ChromeButton icon="more" label={label} compact />}>
      <MenuGroup label={label}>
        {parts.map((part) => (
          <MenuItem
            key={part.id}
            lead={part.brand === undefined ? <span className={s.noMark} aria-hidden="true" /> : <BrandMark brand={part.brand} size={14} />}
            {...(part.openLabel === undefined ? {} : { hint: part.openLabel })}
            disabled={part.onOpen === undefined}
            onSelect={() => part.onOpen?.()}
          >
            {part.name}
          </MenuItem>
        ))}
      </MenuGroup>
    </Menu>
  )
}
