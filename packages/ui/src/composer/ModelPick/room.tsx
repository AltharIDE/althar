import { cx } from '../../lib/cx'
import { SAY_UNDER, usageTone } from '../../chrome/PlanGauge/plan'
import s from './room.module.css'

/*
 * How much room a model has where work on it would start, beside it in a
 * picker: the share left of the tightest window of the account the work
 * would go to, that account named where the agent has several, and from a
 * quarter down, until when. A model whose plan Althar reads nothing for says
 * so in faint ink. Ink only, deeper as it runs down.
 */

export interface ModelRoom {
  /** 0 to 100. */
  left: number
  /** When that window resets, as the consumer words a time: 14:00, Mon 09:00. */
  until: string | null
  /** The account, where the agent has several. */
  account: string | null
}

export interface ModelRoomText {
  share: (percent: number) => string
  out: string
  until: (at: string) => string
  /** Side · 79%. */
  account: (name: string, share: string) => string
  /** Beside the chip once nearly out: 3% left, Out. */
  chipLeft: (percent: number) => string
  chipOut: string
}

export const modelRoomText: ModelRoomText = {
  share: (n) => `${n}%`,
  out: 'out',
  until: (at) => `until ${at}`,
  account: (name, share) => `${name} · ${share}`,
  chipLeft: (n) => `${n}% left`,
  chipOut: 'Out',
}

/** From a quarter down, a row says until when too. */
const UNTIL_UNDER = 25

/** A model's room in a row's words: 62%, Side · 79%, 3% · until 14:00. */
export const roomWords = (room: ModelRoom, t: ModelRoomText, compact = false): string => {
  const share = room.left === 0 ? t.out : t.share(room.left)
  const figure = room.account === null ? share : t.account(room.account, share)
  return !compact && room.until !== null && room.left <= UNTIL_UNDER ? `${figure} · ${t.until(room.until)}` : figure
}

/**
 * A model's room at the end of a picker's row, nothing where `room`
 * is null (no reading). Compact, where the model's name needs the room, as in All models:
 * the figure alone, the rest on hover.
 */
export function RoomNote({
  room,
  compact = false,
  text,
  className,
}: {
  room: ModelRoom | null
  compact?: boolean
  text?: Partial<ModelRoomText>
  className?: string
}) {
  const t = { ...modelRoomText, ...text }
  // No reading is the common case, and says nothing a row could act on: the row stays quiet.
  if (room === null) return null
  const full = roomWords(room, t)
  const words = roomWords(room, t, compact)
  return (
    <span className={cx(s.room, className)} data-tone={usageTone(room.left)} title={words === full ? undefined : full}>
      {words}
    </span>
  )
}

/**
 * Beside a picker's chip, once its model is nearly out: 3% left · until 14:00,
 * Out · until 14:00. One run at the chip's size, in the chip's ink, a step
 * deeper as it runs down. Nothing before.
 */
export function RoomSaid({ room, text }: { room: ModelRoom | null | undefined; text?: Partial<ModelRoomText> }) {
  const t = { ...modelRoomText, ...text }
  if (room == null || room.left > SAY_UNDER) return null
  const said = room.left === 0 ? t.chipOut : t.chipLeft(room.left)
  const words = room.until === null ? said : `${said} · ${t.until(room.until)}`
  return (
    <span className={s.said} data-tone={usageTone(room.left)} title={words}>
      {words}
    </span>
  )
}
