import type { ReactNode } from 'react'

import { ChromeButton, Room, RoomSwitch, TitleBar, type WorkNeed, WorkStatus } from '@althar/ui'

/*
 * A project's bar, under the window's tabs: its views, how much runs and
 * what waits on the person (pointed at, what it is; clicked, the first of
 * it), its menu (rename, repositories, rules, remove), and a new task. The
 * project's own screen has it; a task has its own header in the bar. The
 * views have no shortcut of their own: ⌘ and a number belongs to the tabs,
 * and b steps through the views.
 */

export const text = {
  newTask: 'New task',
}

export function ProjectBar({
  room,
  onRoom,
  working,
  yours,
  needs,
  onYours,
  menu,
  onNewTask,
  newTask = false,
}: {
  /** The project's view, which the bar starts with. */
  room: Room
  onRoom: (room: Room) => void
  /** How many run and wait; null until the board is read, when nothing is said. */
  working: number | null
  yours: number | null
  /** What waits on the person, each opening its task, for the count's preview. */
  needs?: ReadonlyArray<WorkNeed>
  /** Opens the first thing that needs the person; without it, the count only says how many. */
  onYours?: () => void
  /** The project's menu (`ProjectMenu`); without it, none. */
  menu?: ReactNode
  onNewTask: () => void
  /** A new task is being planned beside the conversation. */
  newTask?: boolean
}) {
  return (
    <TitleBar
      lights="none"
      end={
        <>
          {working !== null && yours !== null && (
            <WorkStatus
              running={working}
              yours={yours}
              {...(onYours === undefined ? {} : { onYours })}
              {...(needs === undefined ? {} : { needs })}
            />
          )}
          {menu}
          <ChromeButton icon="plus" label={text.newTask} expanded={newTask} onClick={onNewTask} />
        </>
      }
    >
      <RoomSwitch value={room} onChange={onRoom} text={{ key: () => '' }} />
    </TitleBar>
  )
}

/** The views in the order b steps through them. */
export const ROOMS: readonly Room[] = [Room.Talk, Room.Board, Room.Both]

/** The view after this one, round the end. */
export const nextRoom = (room: Room): Room => ROOMS[(ROOMS.indexOf(room) + 1) % ROOMS.length] ?? Room.Talk
