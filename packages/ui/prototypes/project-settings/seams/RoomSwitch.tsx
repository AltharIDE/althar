// Scrappy: the project's views; in B, its settings are the fourth.
import { Room, RoomSwitch as Real, type RoomSwitchProps, roomSwitchText, Segmented } from '../../../src/index'
import { proto, useProto } from '../state'

type View = Room | 'settings'

export function RoomSwitch(props: RoomSwitchProps) {
  const p = useProto()
  if (p.direction !== 'B') return <Real {...props} />
  const shown: View = p.showing === 'closed' ? props.value : 'settings'
  return (
    <Segmented<View>
      label={roomSwitchText.label}
      value={shown}
      onChange={(view) => {
        if (view === 'settings') return proto.set({ showing: 'open' })
        proto.set({ showing: 'closed' })
        props.onChange(view)
      }}
      options={[
        ...[Room.Talk, Room.Board, Room.Both].map((room) => ({ value: room, label: roomSwitchText.room[room] })),
        { value: 'settings' as const, label: 'Settings' },
      ]}
    />
  )
}
