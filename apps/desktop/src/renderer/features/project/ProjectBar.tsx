import { ChromeButton, Room, RoomSwitch, type TASK, TitleBar, WorkStatus } from '@althar/ui'

/*
 * A project's bar, under the window's tabs: its views, how much runs and
 * what waits on the person, its rules, and a new task. The project's own
 * screen and each of its tasks have it, so the way around a project is the
 * same wherever in it the person is; on a task, no view is on, and choosing
 * one goes back to the project in it. The task last opened sits after the
 * views, by its title, so going back to it from the board is one press. The
 * views have no shortcut of their own: ⌘ and a number belongs to the tabs,
 * and b steps through the views.
 */

export const text = {
  rules: 'Project rules',
  newTask: 'New task',
}

export function ProjectBar({
  room,
  onRoom,
  task,
  working,
  yours,
  onYours,
  onRules,
  onNewTask,
  newTask = false,
}: {
  /** The view on, or the task last opened while it has the window. */
  room: Room | typeof TASK | null
  onRoom: (room: Room) => void
  /** The task last opened in the project, for going back to it. */
  task?: { readonly title: string; readonly onOpen: () => void } | null
  /** How many run and wait; null until the board is read, when nothing is said. */
  working: number | null
  yours: number | null
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
          {working !== null && yours !== null && <WorkStatus running={working} yours={yours} onYours={onYours} />}
          {onRules && <ChromeButton icon="gear" label={text.rules} compact onClick={onRules} />}
          <ChromeButton icon="plus" label={text.newTask} expanded={newTask} onClick={onNewTask} />
        </>
      }
    >
      <RoomSwitch value={room} onChange={onRoom} {...(task == null ? {} : { task })} yours={yours ?? 0} text={{ key: () => '' }} />
    </TitleBar>
  )
}

/** The views in the order b steps through them. */
export const ROOMS: readonly Room[] = [Room.Talk, Room.Board, Room.Both]

/** The view after this one, round the end. */
export const nextRoom = (room: Room): Room => ROOMS[(ROOMS.indexOf(room) + 1) % ROOMS.length] ?? Room.Talk
