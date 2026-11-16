import type { Raised } from '../talk'
import { type Change, listed, shortOf, specOf, TASKS, type TaskNow, type WorldNow } from '../world'

/*
 * B · In the thread: what Althar says in a task's thread of the tasks around
 * it, a plain line at the minute each thing happened, read from the day's
 * changes, so scrubbing the clock plays them. In a task that waits: what it
 * waits for, as it's set; each of those merging (where something else still
 * holds it), getting stuck, tried again, abandoned (with the question, where
 * the coordinator asks it) or reopened; and what the person adds or lets go.
 * In a task others wait for: who waits, who starts as it merges, and who
 * waited, as it's abandoned. Starting is said as it was (data.ts).
 *
 * In place of an errand held over a wait Althar can't watch: nothing
 * internal, only what happened and what it means for this task.
 */

export type Line =
  | { readonly id: string; readonly at: number; readonly text: string }
  | { readonly id: string; readonly at: number; readonly text: string; readonly ask: Raised }

const names = (keys: ReadonlyArray<string>) => listed(keys.map(shortOf))
const merges = (keys: ReadonlyArray<string>) => (keys.length === 1 ? 'it’s merged' : 'they’ve merged')

/** What a task waited for at a minute: as it began, then each change to that. */
const blockersAt = (changes: ReadonlyArray<Change>, key: string, at: number): ReadonlyArray<string> => {
  let now: ReadonlyArray<string> = specOf(key).blockers
  for (const one of changes) {
    if (one.at > at) break
    if (one.kind === 'blockers' && one.key === key) now = one.to
  }
  return now
}

/** Merged by a minute. */
const mergedBy = (changes: ReadonlyArray<Change>, key: string, at: number): boolean =>
  changes.some((one) => one.kind === 'phase' && one.key === key && one.to === 'merged' && one.at <= at)

/** Not started by a minute: it hadn't gone into its work yet. */
const unstartedAt = (changes: ReadonlyArray<Change>, task: TaskNow, at: number): boolean =>
  specOf(task.key).begun === undefined &&
  !changes.some((one) => one.kind === 'phase' && one.key === task.key && one.to === 'implement' && one.at <= at)

/** Starting at that minute, by the person: their start says it. */
const startedThen = (changes: ReadonlyArray<Change>, key: string, at: number): boolean =>
  changes.some((one) => one.kind === 'phase' && one.key === key && one.to === 'starting' && Math.abs(one.at - at) < 1e-6)

export function linesOf(world: WorldNow, task: TaskNow, raised: ReadonlyArray<Raised>, from: number): Line[] {
  const spec = specOf(task.key)
  const id = `th_${task.key}`
  const { changes } = world
  const out: Line[] = []

  // ——— what it waits for ———
  if (spec.blockers.length > 0)
    out.push({
      id: `${id}_set`,
      at: from + 0.01,
      text: spec.held
        ? `Waits for ${names(spec.blockers)}, and for your word once ${merges(spec.blockers)}.`
        : `Waits for ${names(spec.blockers)}, and starts by itself once ${merges(spec.blockers)}.`,
    })
  // ——— what waits for it ———
  const first = TASKS.filter((one) => one.blockers.includes(task.key)).map((one) => one.key)
  if (first.length > 0)
    out.push({ id: `${id}_after`, at: from + 0.01, text: `${names(first)} ${first.length === 1 ? 'waits' : 'wait'} for this.` })

  for (const [n, one] of changes.entries()) {
    const at = one.at
    const lineId = `${id}_${n}`
    // What the person added to what it waits for, or let go; starting it anyway is said as it starts.
    if (one.kind === 'blockers') {
      if (one.key === task.key && !startedThen(changes, task.key, at)) {
        const added = one.to.filter((key) => !one.from.includes(key))
        const gone = one.from.filter((key) => !one.to.includes(key))
        const text =
          added.length > 0 && gone.length > 0
            ? `Waits for ${names(added)} instead of ${names(gone)}.`
            : added.length > 0
              ? `Now waits for ${names(added)} too.`
              : `No longer waits for ${names(gone)}.`
        out.push({ id: lineId, at, text })
      }
      // Another task now waits for this one, or no longer.
      if (one.key !== task.key && !startedThen(changes, one.key, at)) {
        if (one.to.includes(task.key) && !one.from.includes(task.key))
          out.push({ id: lineId, at, text: `${shortOf(one.key)} now waits for this.` })
        if (one.from.includes(task.key) && !one.to.includes(task.key))
          out.push({ id: lineId, at, text: `${shortOf(one.key)} no longer waits for this.` })
      }
      continue
    }

    // This task merged, or was abandoned: what waited for it.
    if (one.key === task.key) {
      const waiters = world.tasks.filter(
        (other) =>
          other.key !== task.key && unstartedAt(changes, other, at - 1e-6) && blockersAt(changes, other.key, at - 1e-6).includes(task.key),
      )
      if (one.to === 'merged') {
        const free = waiters.filter(
          (other) => !other.held && blockersAt(changes, other.key, at).every((key) => key === task.key || mergedBy(changes, key, at)),
        )
        if (free.length > 0)
          out.push({
            id: lineId,
            at,
            text: `Merged as #${spec.pr}, so ${names(free.map((other) => other.key))} ${free.length === 1 ? 'starts' : 'start'}.`,
          })
      }
      if (one.to === 'abandoned' && waiters.length > 0) {
        const text = `Abandoned. ${names(waiters.map((other) => other.key))} ${waiters.length === 1 ? 'was' : 'were'} waiting for this.`
        const ask = raised.find((r) => r.blocker === task.key && Math.abs(r.at - at) < 0.26)
        out.push(ask === undefined ? { id: lineId, at, text } : { id: lineId, at, text, ask })
      }
      continue
    }

    // A task this one waits for moved, while this one hadn't started.
    if (!blockersAt(changes, task.key, at).includes(one.key) || !unstartedAt(changes, task, at)) continue
    const other = shortOf(one.key)
    const pr = specOf(one.key).pr
    const breaks = specOf(one.key).breaks ?? 'a'
    switch (one.to) {
      case 'merged': {
        const rest = blockersAt(changes, task.key, at).filter((key) => key !== one.key && !mergedBy(changes, key, at))
        // The last of them: its start says it ("… merged as #610, so this started"), unless the person holds it.
        if (rest.length > 0) out.push({ id: lineId, at, text: `${other} merged as #${pr}. Still waits for ${names(rest)}.` })
        else if (task.held) out.push({ id: lineId, at, text: `${other} merged as #${pr}. It’s held, so it starts when you say.` })
        break
      }
      case 'stuck':
        out.push({ id: lineId, at, text: `${other} is stuck: its ${breaks} check failed twice. This keeps waiting for it.` })
        break
      case 'checks':
        if (one.from === 'stuck') out.push({ id: lineId, at, text: `${other} is being tried again.` })
        break
      case 'abandoned': {
        const ask = raised.find((r) => r.blocker === one.key && Math.abs(r.at - at) < 0.26)
        const text = `${other} was abandoned.`
        out.push(ask === undefined ? { id: lineId, at, text } : { id: lineId, at, text, ask })
        break
      }
      default:
        if (one.from === 'abandoned') out.push({ id: lineId, at, text: `${other} was reopened. This waits for it again.` })
    }
  }
  return out
}
