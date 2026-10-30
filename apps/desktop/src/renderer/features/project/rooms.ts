import { Room } from '@althar/ui'

/*
 * A project's views, as b steps through those of its work. They are its
 * header's faces (the kit's ProjectHeader), all five, as a task's bar has
 * its own; the window's bar keeps only the tabs. The views have no shortcut
 * of their own: ⌘ and a number belongs to the tabs.
 */

/** The views of its work, in the order b steps through them; from its automations or its settings, b goes to the first. */
export const ROOMS: readonly Room[] = [Room.Both, Room.Talk, Room.Board]

/** The view after this one, round the end. */
export const nextRoom = (room: Room): Room => ROOMS[(ROOMS.indexOf(room) + 1) % ROOMS.length] ?? Room.Talk
