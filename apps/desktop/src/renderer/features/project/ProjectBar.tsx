import { ChromeButton, Room, RoomSwitch, TitleBar, WorkStatus } from '@althar/ui'

/*
 * A project's bar, under the window's tabs: its views, how much runs and
 * what waits on the person, its rules, and a new task. The project's own
 * screen and each of its tasks have it, so the way around a project is the
 * same wherever in it the person is; on a task, no view is on, and choosing
 * one goes back to the project in it. The views have no shortcut of their
 * own: ⌘ and a number belongs to the tabs, and b steps through the views.
 */

export const text = {
  rules: 'Project rules',
  newTask: 'New task',
}

export function ProjectBar({
  room,
  onRoom,
  working,
  yours,
  onYours,
  onRules,
  onNewTask,
  newTask = false,
}: {
  /** The view on; null on one of its tasks. */
  room: Room | null
  onRoom: (room: Room) => void
  working: number
  yours: number
  onYours: () => void
  /** Opens the project's rules; without it, no way there. */
  onRules?: () => void
  onNewTask: () => void
  /** A new task is being planned beside the conversation. */
  newTask?: boolean
}) {
  return (
    <TitleBar
      lights="none"
      end={
        <>
          <WorkStatus running={working} yours={yours} onYours={onYours} />
          {onRules && <ChromeButton icon="gear" label={text.rules} compact onClick={onRules} />}
          <ChromeButton icon="plus" label={text.newTask} expanded={newTask} onClick={onNewTask} />
        </>
      }
    >
      <RoomSwitch value={room} onChange={onRoom} yours={yours} text={{ key: () => '' }} />
    </TitleBar>
  )
}

/** The views in the order b steps through them. */
export const ROOMS: readonly Room[] = [Room.Talk, Room.Board, Room.Both]

/** The view after this one, round the end. */
export const nextRoom = (room: Room): Room => ROOMS[(ROOMS.indexOf(room) + 1) % ROOMS.length] ?? Room.Talk
