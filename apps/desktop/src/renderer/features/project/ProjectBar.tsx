import type { ReactNode } from 'react'

import { ChromeButton, Room, RoomSwitch, type WorkNeed, WorkStatus } from '@althar/ui'

import { BarEnd } from '../tabs/TabsFrame'

/*
 * A project's end of the window's bar, beside the tabs: its views, what
 * waits on the person when anything does (pointed at, what it is; clicked,
 * the first of it), its menu (rename, repositories, rules, remove), and a
 * new task. The project's own screen has it; a task has its own header in
 * the bar under the tabs. What runs isn't counted here: running stays
 * still, and the tab's mark says it. The views have no shortcut of their
 * own: ⌘ and a number belongs to the tabs, and b steps through the views.
 */

export const text = {
  newTask: 'New task',
}

export function ProjectBar({
  room,
  onRoom,
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
  /** How many wait on the person; null until the board is read, when nothing is said. */
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
    <BarEnd>
      <RoomSwitch value={room} onChange={onRoom} text={{ key: () => '' }} />
      {yours !== null && yours > 0 && (
        <WorkStatus yours={yours} {...(onYours === undefined ? {} : { onYours })} {...(needs === undefined ? {} : { needs })} />
      )}
      {menu}
      <ChromeButton icon="plus" label={text.newTask} expanded={newTask} onClick={onNewTask} />
    </BarEnd>
  )
}

/** The views in the order b steps through them. */
export const ROOMS: readonly Room[] = [Room.Talk, Room.Board, Room.Both]

/** The view after this one, round the end. */
export const nextRoom = (room: Room): Room => ROOMS[(ROOMS.indexOf(room) + 1) % ROOMS.length] ?? Room.Talk
