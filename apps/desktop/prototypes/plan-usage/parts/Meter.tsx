// Scrappy: one window of an account as a slim bar, the share left in words, and until when: A's popover and C's accounts draw it.
import type { AccountUsage } from '@althar/contracts'
import { usageTone } from '@althar/ui'

import { type Room, roomOf, whenShort, windowLabel } from '../usage'
import s from './parts.module.css'

/** A bar, filled to the share left, in the ink its tone says. */
export function Bar({ left }: { left: number }) {
  return (
    <span className={s.bar} aria-hidden="true">
      <i style={{ width: `${Math.max(left, left > 0 ? 3 : 0)}%` }} />
    </span>
  )
}

export function Meter({ room }: { room: Room }) {
  const until = room.resetsAt === null ? '' : `until ${whenShort(room.resetsAt)}`
  return (
    <div className={s.meter} data-tone={usageTone(room.left)} role="group" aria-label={`${windowLabel(room)}: ${room.left}% left ${until}`}>
      <span className={s.meterName}>{windowLabel(room)}</span>
      <Bar left={room.left} />
      <span className={s.left}>{room.left === 0 ? 'Out' : `${room.left}%`}</span>
      <span className={s.until}>{until}</span>
    </div>
  )
}

export function Meters({ account }: { account: AccountUsage }) {
  return (
    <div className={s.meters}>
      {account.windows.map((window) => (
        <Meter key={`${window.kind}:${window.label ?? ''}`} room={roomOf(window)} />
      ))}
    </div>
  )
}
