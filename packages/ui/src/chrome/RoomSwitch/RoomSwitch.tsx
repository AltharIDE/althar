import { Room } from '../../foundations/vocabulary'
import { Segmented, type SegmentedOption } from '../../primitives/Segmented/Segmented'

/*
 * The project window's only navigation: the conversation, the board, or
 * both side by side. A dot says the conversation has news while you are on
 * the board. What waits on you isn't the board's: the bar's WorkStatus says
 * it, whichever view is on. A task has no place here: it takes the window,
 * and its bar goes back with a BackCrumb. The shortcuts are the consumer's
 * to bind; the switch names them.
 */

export interface RoomSwitchText {
  label: string
  room: Record<Room, string>
  /** The shortcut, as the tooltip shows it: ⌘1; empty where there is none. */
  key: (n: number) => string
  news: string
}

export const roomSwitchText: RoomSwitchText = {
  label: 'View',
  room: { [Room.Talk]: 'Conversation', [Room.Board]: 'Board', [Room.Both]: 'Both' },
  key: (n) => `⌘${n}`,
  news: 'new messages',
}

const ROOMS = [Room.Talk, Room.Board, Room.Both] as const

/* news on the conversation */
const dotOf = (room: Room, news: boolean | undefined): 'new' | undefined => (room === Room.Talk && news ? 'new' : undefined)

export interface RoomSwitchProps {
  value: Room
  onChange: (room: Room) => void
  /** The conversation has something you haven't seen. */
  news?: boolean
  className?: string
  text?: Partial<RoomSwitchText>
}

export function RoomSwitch({ value, onChange, news, className, text }: RoomSwitchProps) {
  const t = { ...roomSwitchText, ...text }
  const options: SegmentedOption<Room>[] = ROOMS.map((room, i) => {
    const dot = dotOf(room, news)
    return {
      value: room,
      label: t.room[room],
      tooltip: { label: t.room[room], ...(t.key(i + 1) === '' ? {} : { kbd: t.key(i + 1) }) },
      dot,
      dotLabel: dot === undefined ? undefined : t.news,
    }
  })
  return <Segmented label={t.label} value={value} onChange={onChange} className={className} options={options} />
}
