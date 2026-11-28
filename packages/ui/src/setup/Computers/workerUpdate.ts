/*
 * A worker's update, as the window offers and runs it, and the whole fleet's
 * in a line: what the bar's Updates and Settings › Computers both say. The
 * consumer works out where each worker's update stands (its release against
 * the newest, and what its home says of an update asked for); this says it.
 */

/** Where a worker's update stands, as the window shows it. */
export type WorkerUpdateView =
  /** A newer release is out, and its home can ask it to update now. */
  | { readonly state: 'offer'; readonly to: string; readonly from?: string | undefined }
  /** A newer release is out, and it can't be asked (an older worker, or one set up by hand): it updates on its own timer. */
  | { readonly state: 'byItself'; readonly to: string }
  /** Asked while it runs a task: it updates once that ends, before its next. */
  | { readonly state: 'afterTask'; readonly to: string }
  /** Asked while it's offline: it updates once it connects. */
  | { readonly state: 'whenOnline'; readonly to: string }
  /** Its updater runs: getting the release while it's connected, restarting once it drops. */
  | { readonly state: 'running'; readonly to: string; readonly step: 'getting' | 'restarting' }
  | { readonly state: 'done'; readonly version: string }
  | { readonly state: 'failed'; readonly to: string; readonly message: string }

/** A worker, as its update needs it: its name, the task it runs, and where its update stands. */
export interface UpdatingWorker {
  readonly id: string
  readonly name: string
  readonly task?: { readonly title: string } | null | undefined
  readonly update?: WorkerUpdateView | undefined
}

/** The command that runs a worker's update now, on it, as its own login: what its timer starts. */
export const WORKER_UPDATE_COMMAND = 'systemctl --user start althar-worker-update.service'

export interface WorkerUpdateText {
  /** What a worker's update is now, in a few words: under where it stands, and in the load popover. */
  short: Record<Exclude<WorkerUpdateView['state'], 'running'>, (to: string) => string>
  step: { getting: (to: string) => string; restarting: (name: string) => string }
  /** Its big word while its updater runs, where Free or At work would be. */
  updating: string
  release: string
  out: (version: string) => string
  offer: { one: (name: string, to: string) => string; many: (count: number, to: string) => string }
  offerLine: {
    free: (from: string | undefined) => string
    atWork: (task: string) => string
    many: (atWork: number) => string
  }
  byItself: { one: (name: string, to: string) => string; line: string; also: (count: number) => string }
  press: { one: string; atWork: string; all: string; tryAgain: string; cancel: string }
  afterTask: { one: (name: string) => string; many: (count: number) => string; line: (task: string | undefined) => string }
  whenOnline: { one: (name: string) => string; many: (count: number) => string; line: string }
  running: { one: (name: string) => string; many: (count: number) => string; of: (done: number, all: number) => string }
  done: { one: (name: string, version: string) => string; many: (version: string) => string; line: string }
  failed: { one: (name: string) => string; many: (count: number) => string; line: string }
  /** The rest of the fleet, after what leads: joined by a dot. */
  rest: {
    on: (count: number, version: string) => string
    afterTask: (count: number) => string
    whenOnline: (count: number) => string
    failed: (names: string) => string
  }
  /** Run on the worker itself, by hand. */
  byHand: { one: (name: string) => string; many: string; note: string }
}

const names = (all: readonly string[]) =>
  all.length <= 1 ? (all[0] ?? '') : `${all.slice(0, -1).join(', ')} and ${all[all.length - 1] ?? ''}`
const workers = (count: number) => (count === 1 ? '1 worker' : `${count} workers`)

export const workerUpdateText: WorkerUpdateText = {
  short: {
    offer: (to) => `Can update to ${to}`,
    byItself: (to) => `Updates to ${to} on its own`,
    afterTask: () => 'Updates after its task',
    whenOnline: () => 'Updates when it connects',
    done: (to) => `Updated to ${to}`,
    failed: () => 'Couldn’t update',
  },
  step: { getting: (to) => `Getting ${to}`, restarting: (name) => `Restarting ${name}` },
  updating: 'Updating',
  release: 'Release',
  out: (version) => `${version} is out`,
  offer: { one: (name, to) => `${name} can update to ${to}`, many: (count, to) => `${workers(count)} can update to ${to}` },
  offerLine: {
    free: (from) => (from === undefined ? 'It restarts once, in about a minute.' : `From ${from}. It restarts once, in about a minute.`),
    atWork: (task) => `It’s at work on ${task}. It updates once that’s done, before its next task.`,
    many: (atWork) =>
      atWork === 0
        ? 'Each restarts once, between its tasks.'
        : `Each restarts once, between its tasks: ${atWork === 1 ? 'the one at work once it’s' : `the ${atWork} at work once they’re`} done.`,
  },
  byItself: {
    one: (name, to) => `${name} can update to ${to}`,
    line: 'It updates on its own within the hour, between its tasks.',
    also: (count) => (count === 1 ? '1 more updates on its own within the hour.' : `${count} more update on their own within the hour.`),
  },
  press: { one: 'Update', atWork: 'Update after its task', all: 'Update all', tryAgain: 'Try again', cancel: 'Cancel' },
  afterTask: {
    one: (name) => `${name} updates after its task`,
    many: (count) => `${workers(count)} update after their tasks`,
    line: (task) => (task === undefined ? 'Before its next task.' : `Once ${task} is done, before its next task.`),
  },
  whenOnline: {
    one: (name) => `${name} updates when it connects`,
    many: (count) => `${workers(count)} update when they connect`,
    line: 'It’s offline now.',
  },
  running: {
    one: (name) => `Updating ${name}`,
    many: (count) => `Updating ${workers(count)}`,
    of: (done, all) => `${done} of ${all}`,
  },
  done: {
    one: (name, version) => `${name} is on ${version}`,
    many: (version) => `Your workers are on ${version}`,
    line: 'Updated just now.',
  },
  failed: {
    one: (name) => `Couldn’t update ${name}`,
    many: (count) => `Couldn’t update ${workers(count)}`,
    line: 'Each takes tasks on its release as before.',
  },
  rest: {
    on: (count, version) => `${count} on ${version}`,
    afterTask: (count) => (count === 1 ? '1 after its task' : `${count} after their tasks`),
    whenOnline: (count) => (count === 1 ? '1 when it connects' : `${count} when they connect`),
    failed: (who) => `${who} couldn’t`,
  },
  byHand: {
    one: (name) => `Update it on ${name} yourself`,
    many: 'Update them yourself',
    note: 'Run it on the worker, as its own login.',
  },
}

export type FleetState = 'offer' | 'byItself' | 'waiting' | 'running' | 'failed' | 'done'

/** The fleet's update, in a line: what leads (what failed, what runs, what can update, what waits, what's done) and the rest. */
export interface FleetUpdate {
  readonly state: FleetState
  readonly title: string
  readonly line: string
  /** Where it's about one worker alone: that one. */
  readonly one: UpdatingWorker | null
  /** Where one runs: its step; where several, how many are done of all. */
  readonly step?: { readonly at: number; readonly names: readonly string[] }
  readonly done?: number
  readonly of?: number
  /** What the press says, where there is one, and the workers it asks. */
  readonly press?: string
  readonly ids: readonly string[]
  /** One asked and not started, that can be taken back. */
  readonly cancel?: string
  /** The command to run by hand: where it can't be asked, or failed. */
  readonly byHand: boolean
}

const of = <S extends WorkerUpdateView['state']>(all: readonly UpdatingWorker[], state: S) =>
  all.filter((one) => one.update?.state === state)

/** The fleet's update, said; null where no worker has one. */
export function fleetUpdate(list: readonly UpdatingWorker[], text: Partial<WorkerUpdateText> = {}): FleetUpdate | null {
  const t = { ...workerUpdateText, ...text }
  const all = list.filter((one) => one.update !== undefined)
  if (all.length === 0) return null
  const offer = of(all, 'offer')
  const byItself = of(all, 'byItself')
  const afterTask = of(all, 'afterTask')
  const whenOnline = of(all, 'whenOnline')
  const running = of(all, 'running')
  const done = of(all, 'done')
  const failed = of(all, 'failed')
  const to = (one: UpdatingWorker | undefined) => {
    const update = one?.update
    return update === undefined ? '' : update.state === 'done' ? update.version : update.to
  }
  const newest = to(offer[0] ?? byItself[0] ?? running[0] ?? afterTask[0] ?? failed[0] ?? done[0] ?? all[0])
  const rest = [
    ...(done.length > 0 ? [t.rest.on(done.length, to(done[0]))] : []),
    ...(afterTask.length > 0 ? [t.rest.afterTask(afterTask.length)] : []),
    ...(whenOnline.length > 0 ? [t.rest.whenOnline(whenOnline.length)] : []),
  ].join(' · ')
  const single = all.length === 1 ? (all[0] ?? null) : null
  const ids = (some: readonly UpdatingWorker[]) => some.map((one) => one.id)
  const steps = (name: string) => [t.step.getting(newest), t.step.restarting(name)]

  if (single !== null) {
    const update = single.update!
    const { name } = single
    switch (update.state) {
      case 'offer':
        return {
          state: 'offer',
          one: single,
          title: t.offer.one(name, update.to),
          line: single.task == null ? t.offerLine.free(update.from) : t.offerLine.atWork(single.task.title),
          press: single.task == null ? t.press.one : t.press.atWork,
          ids: [single.id],
          byHand: false,
        }
      case 'byItself':
        return { state: 'byItself', one: single, title: t.byItself.one(name, update.to), line: t.byItself.line, ids: [], byHand: true }
      case 'afterTask':
        return {
          state: 'waiting',
          one: single,
          title: t.afterTask.one(name),
          line: t.afterTask.line(single.task?.title),
          ids: [],
          cancel: single.id,
          byHand: false,
        }
      case 'whenOnline':
        return {
          state: 'waiting',
          one: single,
          title: t.whenOnline.one(name),
          line: t.whenOnline.line,
          ids: [],
          cancel: single.id,
          byHand: false,
        }
      case 'running':
        return {
          state: 'running',
          one: single,
          title: t.running.one(name),
          line: update.step === 'getting' ? t.step.getting(update.to) : t.step.restarting(name),
          step: { at: update.step === 'getting' ? 0 : 1, names: steps(name) },
          ids: [],
          byHand: false,
        }
      case 'done':
        return { state: 'done', one: single, title: t.done.one(name, update.version), line: t.done.line, ids: [], byHand: false }
      case 'failed':
        return {
          state: 'failed',
          one: single,
          title: t.failed.one(name),
          line: update.message,
          press: t.press.tryAgain,
          ids: [single.id],
          byHand: true,
        }
    }
  }

  if (failed.length > 0 && running.length === 0) {
    const first = failed[0]
    const lone = failed.length === 1 && first !== undefined
    return {
      state: 'failed',
      one: lone ? first : null,
      title: lone ? t.failed.one(first.name) : t.failed.many(failed.length),
      line: [lone && first.update?.state === 'failed' ? first.update.message : t.failed.line, rest].filter((part) => part !== '').join(' '),
      press: t.press.tryAgain,
      ids: ids(failed),
      byHand: true,
    }
  }
  if (running.length > 0) {
    const asked = running.length + done.length + afterTask.length + whenOnline.length + failed.length
    return {
      state: 'running',
      one: null,
      title: t.running.many(asked),
      line: [rest, ...(failed.length > 0 ? [t.rest.failed(names(failed.map((one) => one.name)))] : [])]
        .filter((part) => part !== '')
        .join(' · '),
      done: done.length,
      of: asked,
      ids: [],
      byHand: false,
    }
  }
  if (offer.length > 0) {
    const atWork = offer.filter((one) => one.task != null).length
    return {
      state: 'offer',
      one: offer.length === 1 ? (offer[0] ?? null) : null,
      title: offer.length === 1 ? t.offer.one(offer[0]?.name ?? '', newest) : t.offer.many(offer.length, newest),
      line: [
        offer.length === 1
          ? offer[0]?.task == null
            ? t.offerLine.free(undefined)
            : t.offerLine.atWork(offer[0].task.title)
          : t.offerLine.many(atWork),
        ...(byItself.length > 0 ? [t.byItself.also(byItself.length)] : []),
      ].join(' '),
      press: offer.length === 1 ? t.press.one : t.press.all,
      ids: ids(offer),
      byHand: false,
    }
  }
  if (byItself.length > 0)
    return {
      state: 'byItself',
      one: byItself.length === 1 ? (byItself[0] ?? null) : null,
      title: byItself.length === 1 ? t.byItself.one(byItself[0]?.name ?? '', newest) : t.offer.many(byItself.length, newest),
      line: t.byItself.line,
      ids: [],
      byHand: true,
    }
  const waiting = [...afterTask, ...whenOnline]
  if (waiting.length > 0)
    return {
      state: 'waiting',
      one: waiting.length === 1 ? (waiting[0] ?? null) : null,
      title:
        waiting.length === 1
          ? afterTask.length === 1
            ? t.afterTask.one(waiting[0]?.name ?? '')
            : t.whenOnline.one(waiting[0]?.name ?? '')
          : afterTask.length > 0
            ? t.afterTask.many(waiting.length)
            : t.whenOnline.many(waiting.length),
      line: done.length > 0 ? t.rest.on(done.length, to(done[0])) : t.afterTask.line(undefined),
      ids: [],
      ...(waiting.length === 1 && waiting[0] !== undefined ? { cancel: waiting[0].id } : {}),
      byHand: false,
    }
  return { state: 'done', one: null, title: t.done.many(to(done[0])), line: t.done.line, ids: [], byHand: false }
}

/** A worker's update in a few words, under where it stands; none while it's on the newest. */
export const shortUpdate = (update: WorkerUpdateView | undefined, name: string, text: Partial<WorkerUpdateText> = {}) => {
  const t = { ...workerUpdateText, ...text }
  if (update === undefined) return null
  if (update.state === 'running') return update.step === 'getting' ? t.step.getting(update.to) : t.step.restarting(name)
  return t.short[update.state](update.state === 'done' ? update.version : update.to)
}
