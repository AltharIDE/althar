import { BackCrumb, ChromeButton, Room, RoomSwitch, TitleBar, type WorkNeed, WorkStatus } from '@althar/ui'

/*
 * A project's bar, under the window's tabs: its views, how much runs and
 * what waits on the person (pointed at, what it is; clicked, the first of
 * it), its rules, and a new task. The project's own screen and each of its
 * tasks have it. On a task, the views give way to the way back, as in the
 * prototype: the project, with Escape, then which task this is; back goes
 * to the view the person was on. The views have no shortcut of their own:
 * ⌘ and a number belongs to the tabs, and b steps through the views.
 */

export const text = {
  rules: 'Project rules',
  newTask: 'New task',
  backKey: 'esc',
}

/** What the bar starts with: the project's views, or, on a task, the way back to them. */
export type BarPlace =
  | { readonly room: Room; readonly onRoom: (room: Room) => void }
  | { readonly back: { readonly project: string; readonly task: string; readonly onBack: () => void } }

export function ProjectBar({
  place,
  working,
  yours,
  needs,
  onYours,
  onRules,
  onNewTask,
  newTask = false,
}: {
  place: BarPlace
  /** How many run and wait; null until the board is read, when nothing is said. */
  working: number | null
  yours: number | null
  /** What waits on the person, each opening its task, for the count's preview. */
  needs?: ReadonlyArray<WorkNeed>
  /** Opens the first thing that needs the person; without it, the count only says how many. */
  onYours?: () => void
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
          {working !== null && yours !== null && (
            <WorkStatus
              running={working}
              yours={yours}
              {...(onYours === undefined ? {} : { onYours })}
              {...(needs === undefined ? {} : { needs })}
            />
          )}
          {onRules && <ChromeButton icon="gear" label={text.rules} compact onClick={onRules} />}
          <ChromeButton icon="plus" label={text.newTask} expanded={newTask} onClick={onNewTask} />
        </>
      }
    >
      {'back' in place ? (
        <BackCrumb to={place.back.project} kbd={text.backKey} title={place.back.task} onBack={place.back.onBack} />
      ) : (
        <RoomSwitch value={place.room} onChange={place.onRoom} text={{ key: () => '' }} />
      )}
    </TitleBar>
  )
}

/** The views in the order b steps through them. */
export const ROOMS: readonly Room[] = [Room.Talk, Room.Board, Room.Both]

/** The view after this one, round the end. */
export const nextRoom = (room: Room): Room => ROOMS[(ROOMS.indexOf(room) + 1) % ROOMS.length] ?? Room.Talk
