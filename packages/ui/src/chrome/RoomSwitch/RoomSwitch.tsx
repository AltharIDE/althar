import { Room } from '../../foundations/vocabulary'
import { Segmented, type SegmentedOption } from '../../primitives/Segmented/Segmented'

/*
 * The project window's only navigation: the conversation, the board, both
 * side by side, or the project's settings in their place. A dot says the
 * conversation has news while you are elsewhere, and a violet one that
 * something in the settings waits on you, such as a connection to sign in
 * again. What waits on you in the work isn't the board's: the bar's
 * WorkStatus says it, whichever view is on. A task has no place here: it
 * takes the window, and its bar goes back with a BackCrumb. The shortcuts
 * are the consumer's to bind; the switch names them.
 */

export interface RoomSwitchText {
  label: string
  room: Record<Room, string>
  /** The shortcut, as the tooltip shows it: ⌘1; empty where there is none. */
  key: (n: number) => string
  news: string
  yours: string
}

export const roomSwitchText: RoomSwitchText = {
  label: 'View',
  room: { [Room.Talk]: 'Conversation', [Room.Board]: 'Board', [Room.Both]: 'Both', [Room.Settings]: 'Settings' },
  key: (n) => `⌘${n}`,
  news: 'new messages',
  yours: 'needs you',
}

const ROOMS = [Room.Talk, Room.Board, Room.Both, Room.Settings] as const

export interface RoomSwitchProps {
  value: Room
  onChange: (room: Room) => void
  /** The conversation has something you haven't seen. */
  news?: boolean
  /** Something in the project's settings waits on you. */
  needsYou?: boolean
  className?: string
  text?: Partial<RoomSwitchText>
}

export function RoomSwitch({ value, onChange, news, needsYou, className, text }: RoomSwitchProps) {
  const t = { ...roomSwitchText, ...text }
  const dotOf = (room: Room): Pick<SegmentedOption<Room>, 'dot' | 'dotLabel'> =>
    room === Room.Talk && news === true
      ? { dot: 'new', dotLabel: t.news }
      : room === Room.Settings && needsYou === true
        ? { dot: 'yours', dotLabel: t.yours }
        : {}
  const options: SegmentedOption<Room>[] = ROOMS.map((room, i) => {
    const key = t.key(i + 1)
    return {
      value: room,
      label: t.room[room],
      // Its name is on it; a tooltip only says its shortcut, where it has one.
      ...(key === '' ? {} : { tooltip: { label: t.room[room], kbd: key } }),
      ...dotOf(room),
    }
  })
  return <Segmented label={t.label} value={value} onChange={onChange} className={className} options={options} />
}
