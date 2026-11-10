import type { TaskTime, ThreadItem, TurnTime } from '@althar/contracts'

/*
 * Where a turn's time went (a task is a conversation plus parts, "Where a
 * turn's time goes"), as its line says it: the total, and, where one part
 * took most of it and wasn't the agent's own work, that part after it,
 * "Worked for 4m · 3m 10s waiting for a place". Opening the line says every
 * part. A block of the thread may hold several of the runtime's turns, as a
 * step's report and the words that close it: their times add up.
 */

/** Where a block's time went, its turns added up, in milliseconds. */
export interface Spent {
  readonly total: number
  readonly place: number
  readonly session: number
  /** A session's first turn that handed it over to a fresh one, rather than starting it for the work. */
  readonly handover: boolean
  readonly work: number
  readonly tools: number
}

/** A part names itself on the line only where it took at least this long, and at least a quarter of the whole. */
const NAMED_FROM = 10_000

/** How long, as a turn's line says it: "12s", "3m 5s", "1h 4m". */
export const duration = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** The runtime's turns, by id, as a snapshot carries them. */
export const turnsById = (turns: ReadonlyArray<TurnTime> | undefined): ReadonlyMap<string, TurnTime> =>
  new Map((turns ?? []).map((turn) => [turn.id, turn]))

/** Each item's turn, by the item's id. */
export const turnOfItems = (items: ReadonlyArray<ThreadItem>): ReadonlyMap<string, string> =>
  new Map(items.flatMap((item) => (item.turn === undefined ? [] : [[item.id, item.turn] as const])))

/** Where the time went of the turns its items came in, added up; null where none of them kept it. */
export const spentOf = (turns: Iterable<string>, kept: ReadonlyMap<string, TurnTime>): Spent | null => {
  let found = false
  const sum = { total: 0, place: 0, session: 0, handover: false, work: 0, tools: 0 }
  for (const id of new Set(turns)) {
    const turn = kept.get(id)
    if (turn === undefined) continue
    found = true
    sum.place += turn.place
    sum.session += turn.session
    sum.handover ||= turn.starting === 'handover'
    sum.work += turn.work
    sum.tools += turn.tools
  }
  if (!found) return null
  return { ...sum, total: sum.place + sum.session + sum.work }
}

/** A task's turns added up, as `Spent`: what its Usage says it took. */
export const spentOfTask = (time: TaskTime | undefined): Spent | null =>
  time === undefined || time.turns === 0
    ? null
    : {
        total: time.place + time.session + time.work,
        place: time.place,
        session: time.session,
        handover: false,
        work: time.work,
        tools: time.tools,
      }

/** Where the time went, a few words each part that took a second or more, in the order the turn spent it. */
export const spentWords = (spent: Spent): ReadonlyArray<string> => {
  const parts: Array<readonly [number, string]> = [
    [spent.place, 'waiting for a place'],
    [spent.session, spent.handover ? 'handing over' : 'starting'],
    [spent.work - spent.tools, 'thinking and writing'],
    [spent.tools, 'running tools'],
  ]
  return parts.filter(([ms]) => ms >= 1000).map(([ms, words]) => `${duration(ms)} ${words}`)
}

/** The part that took most, where one did and it wasn't the agent's thinking and writing: what its line names after the total. */
export const mostOf = (spent: Spent): string | undefined => {
  const parts: Array<readonly [number, string]> = [
    [spent.place, 'waiting for a place'],
    [spent.session, spent.handover ? 'handing over' : 'starting'],
    [spent.tools, 'running tools'],
    [spent.work - spent.tools, ''],
  ]
  const [ms, words] = parts.reduce((most, part) => (part[0] > most[0] ? part : most))
  if (words === '' || ms < NAMED_FROM || ms * 4 < spent.total) return undefined
  return `${duration(ms)} ${words}`
}
