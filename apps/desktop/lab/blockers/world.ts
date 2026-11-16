/*
 * The blockers lab's made-up day (README.md): seven of Althar Cloud's tasks
 * in the althar project, some of them waiting for others, and how they run.
 *
 * The rules are DEV-228's. A task waits until every task it names as a
 * blocker has merged, then starts by itself. The person's hold is kept apart
 * from that wait: a task they held stays held when its blockers merge. A
 * cleared blocker stays cleared. Only an abandoned blocker asks the person,
 * and the ask is read from where things stand (`asksOf`), never kept: it goes
 * by itself where the blocker is reopened or what waited is decided.
 */

export type Lead = 'claude-code' | 'codex'

export interface Spec {
  readonly key: string
  readonly title: string
  /** Its name in a line about another task: Pairing. */
  readonly short: string
  readonly slug: string
  /** What it waits for when the day starts. */
  readonly blockers: ReadonlyArray<string>
  readonly lead: Lead
  readonly model: string
  readonly pr: number
  /** What it does, as it was asked. */
  readonly brief: string
  /** What its lead said it built, handed to the tasks that waited for it. */
  readonly built: string
  /** Under way when the clock starts: in this phase, with this many minutes of it done, started so long ago. */
  readonly begun?: { readonly phase: 'implement' | 'review'; readonly worked: number; readonly startedAt: number }
  readonly takes: { readonly implement: number; readonly review: number; readonly checks: number; readonly ready: number }
  /** Its checks fail, the once, and Althar stops it: stuck until it's tried again. */
  readonly breaks?: string
  /** Held by the person when the day starts. */
  readonly held?: boolean
}

const opus = 'claude-opus-5-5'
const sonnet = 'claude-sonnet-5-5'
const sol = 'gpt-6.1-sol'

export const TASKS: ReadonlyArray<Spec> = [
  {
    key: 'host',
    title: 'The host service runs on Linux',
    short: 'Host service',
    slug: 'the-host-service-runs-on-linux',
    blockers: [],
    lead: 'claude-code',
    model: opus,
    pr: 610,
    brief: 'apps/host: the runtime as a service on Linux, with versioned RPC over a private socket, started by systemd.',
    built: 'The service listens on /run/althar/host.sock and answers RPC v1; systemd starts it and restarts it.',
    begun: { phase: 'review', worked: 2, startedAt: -46 },
    takes: { implement: 0, review: 4, checks: 3, ready: 3 },
  },
  {
    key: 'seal',
    title: 'Seal secrets on a headless host',
    short: 'Sealing',
    slug: 'seal-secrets-on-a-headless-host',
    blockers: [],
    lead: 'codex',
    model: sol,
    pr: 611,
    brief: 'Keep sign-ins and keys sealed on a host with no keyring, unsealed only by the host service.',
    built: 'Secrets are sealed with a key only the host service can unseal.',
    begun: { phase: 'implement', worked: 6, startedAt: -31 },
    takes: { implement: 12, review: 4, checks: 3, ready: 3 },
    breaks: 'e2e',
  },
  {
    key: 'pair',
    title: 'Pair a device with the host',
    short: 'Pairing',
    slug: 'pair-a-device-with-the-host',
    blockers: ['host'],
    lead: 'codex',
    model: sol,
    pr: 614,
    brief: 'Signed device attachment and revocation: the Mac pairs once and is known from then on.',
    built: 'A Mac pairs with a one-time code and gets a device key; revoking it closes its sessions.',
    takes: { implement: 12, review: 4, checks: 3, ready: 3 },
  },
  {
    key: 'ssh',
    title: 'Set a host up over SSH',
    short: 'SSH setup',
    slug: 'set-a-host-up-over-ssh',
    blockers: ['host', 'seal'],
    lead: 'claude-code',
    model: opus,
    pr: 615,
    brief: 'Install and start the host service on a fresh VPS over SSH, from the app, with its secrets sealed.',
    built: 'Setting a host up over SSH installs the service, seals its keys and checks it answers.',
    takes: { implement: 10, review: 4, checks: 3, ready: 3 },
  },
  {
    key: 'hosts',
    title: 'A Hosts section in Settings',
    short: 'Hosts screen',
    slug: 'a-hosts-section-in-settings',
    blockers: ['pair'],
    lead: 'claude-code',
    model: opus,
    pr: 619,
    brief: 'A Hosts section in Settings to add a host, pair it, and see whether it’s online.',
    built: 'Settings has a Hosts section: add a host, pair it, and its dot shows whether it’s online.',
    takes: { implement: 10, review: 4, checks: 3, ready: 3 },
  },
  {
    key: 'guide',
    title: 'A guide to Althar Cloud',
    short: 'Guide',
    slug: 'a-guide-to-althar-cloud',
    blockers: ['ssh', 'hosts'],
    lead: 'claude-code',
    model: sonnet,
    pr: 624,
    brief: 'A page in the docs: set a host up, pair the Mac with it, and run a task there.',
    built: 'docs/cloud.md walks through setting a host up, pairing and running a task there.',
    takes: { implement: 6, review: 3, checks: 2, ready: 2 },
  },
  {
    key: 'reconnect',
    title: 'Reconnect after the Mac sleeps',
    short: 'Reconnect',
    slug: 'reconnect-after-the-mac-sleeps',
    blockers: [],
    lead: 'codex',
    model: sol,
    pr: 621,
    brief: 'The app picks up where it left off on the host once the Mac wakes, without the person.',
    built: 'The app reconnects to the host when the Mac wakes and catches up on what it missed.',
    takes: { implement: 8, review: 3, checks: 3, ready: 3 },
    held: true,
  },
]

export const specOf = (key: string): Spec => TASKS.find((one) => one.key === key) as Spec

/* ——— the simulation ——— */

export type Phase = 'waits' | 'starting' | 'implement' | 'review' | 'checks' | 'stuck' | 'ready' | 'merged' | 'abandoned'

/** What the person did, and when. */
export type Move =
  | { readonly at: number; readonly kind: 'abandon'; readonly key: string }
  | { readonly at: number; readonly kind: 'reopen'; readonly key: string }
  /** Starts it now, whatever it waits for: what it waited for comes off its list. With words for its lead. */
  | { readonly at: number; readonly kind: 'start'; readonly key: string; readonly word?: string }
  | { readonly at: number; readonly kind: 'block'; readonly key: string; readonly on: string }
  | { readonly at: number; readonly kind: 'unblock'; readonly key: string; readonly on: string }
  | { readonly at: number; readonly kind: 'swap'; readonly key: string; readonly from: string; readonly to: string }
  | { readonly at: number; readonly kind: 'hold'; readonly key: string }
  | { readonly at: number; readonly kind: 'release'; readonly key: string }
  | { readonly at: number; readonly kind: 'merge'; readonly key: string }
  | { readonly at: number; readonly kind: 'retry'; readonly key: string }

/** How a task came to start: its blockers merged, the person started it, or nothing held it. */
export type Started = 'blockers' | 'you' | 'free'

export interface TaskNow {
  readonly key: string
  readonly phase: Phase
  /** When it came into this phase. */
  readonly since: number
  /** What it waits for now, merged ones included: cleared, they stay cleared. */
  readonly blockers: ReadonlyArray<string>
  /** Held by the person: it waits for their word, whatever else it waits for. */
  readonly held: boolean
  readonly startedAt: number | null
  readonly started: Started | null
  readonly mergedAt: number | null
  readonly abandonedAt: number | null
  /** What the person told its lead as they started it. */
  readonly word: string | null
  /** What it no longer waited for when the person started it anyway. */
  readonly without: ReadonlyArray<string>
}

/** Something that changed in the day, at its minute: a task's phase, or what it waits for. */
export type Change =
  | { readonly at: number; readonly key: string; readonly kind: 'phase'; readonly from: Phase; readonly to: Phase }
  | {
      readonly at: number
      readonly key: string
      readonly kind: 'blockers'
      readonly from: ReadonlyArray<string>
      readonly to: ReadonlyArray<string>
    }

export interface WorldNow {
  readonly t: number
  readonly tasks: ReadonlyArray<TaskNow>
  readonly byKey: ReadonlyMap<string, TaskNow>
  /** When anything last changed phase. */
  readonly lastChange: number
  /** Everything that changed by now, in order: what a task's thread tells (task/lines.ts). */
  readonly changes: ReadonlyArray<Change>
}

/** How long a task counts down once nothing holds it, before it starts. */
const STARTING = 1
const STEP = 0.25

interface Mutable {
  key: string
  phase: Phase
  since: number
  blockers: string[]
  held: boolean
  startedAt: number | null
  started: Started | null
  mergedAt: number | null
  abandonedAt: number | null
  word: string | null
  without: string[]
  /** Minutes of implementing done. */
  worked: number
  /** Its checks broke once already: they pass from then on. */
  fixedOnce: boolean
  /** Started by the person, whatever it waits for. */
  forced: boolean
  /** Where it goes back to, reopened. */
  back: Phase
}

/** Whether `key` waiting for `on` would make it wait for itself: `on` waits, through what it waits for, for `key`. */
export const wouldLoop = (blockersOf: (key: string) => ReadonlyArray<string>, key: string, on: string): boolean => {
  const seen = new Set<string>()
  const walk = (at: string): boolean => {
    if (at === key) return true
    if (seen.has(at)) return false
    seen.add(at)
    return blockersOf(at).some(walk)
  }
  return walk(on)
}

export function simulate(moves: ReadonlyArray<Move>, until: number): WorldNow {
  const tasks: Mutable[] = TASKS.map((spec) => ({
    key: spec.key,
    phase: spec.begun?.phase ?? 'waits',
    since: spec.begun === undefined ? 0 : -spec.begun.worked,
    blockers: [...spec.blockers],
    held: spec.held === true,
    startedAt: spec.begun?.startedAt ?? null,
    started: spec.begun === undefined ? null : 'free',
    mergedAt: null,
    abandonedAt: null,
    word: null,
    without: [],
    worked: spec.begun?.worked ?? 0,
    fixedOnce: false,
    forced: false,
    back: 'waits',
  }))
  const byKey = new Map(tasks.map((one) => [one.key, one]))
  const merged = (key: string) => byKey.get(key)?.phase === 'merged'
  const sorted = moves.toSorted((a, b) => a.at - b.at)
  let next = 0
  let lastChange = 0
  const changes: Change[] = []
  const go = (task: Mutable, phase: Phase, t: number) => {
    changes.push({ at: t, key: task.key, kind: 'phase', from: task.phase, to: phase })
    task.phase = phase
    task.since = t
    lastChange = t
  }
  const wait = (task: Mutable, blockers: string[], t: number) => {
    if (blockers.length === task.blockers.length && blockers.every((one, i) => one === task.blockers[i])) return
    changes.push({ at: t, key: task.key, kind: 'blockers', from: task.blockers, to: blockers })
    task.blockers = blockers
  }
  const apply = (move: Move, t: number) => {
    const task = byKey.get(move.key)
    if (task === undefined) return
    const unstarted = task.phase === 'waits' || task.phase === 'starting'
    switch (move.kind) {
      case 'abandon':
        if (task.phase === 'merged' || task.phase === 'abandoned') return
        task.back = unstarted ? 'waits' : 'implement'
        task.abandonedAt = t
        go(task, 'abandoned', t)
        return
      case 'reopen':
        if (task.phase !== 'abandoned') return
        task.abandonedAt = null
        go(task, task.back, t)
        return
      case 'start':
        if (!unstarted) return
        task.forced = true
        task.held = false
        task.without = task.blockers.filter((one) => !merged(one))
        wait(task, task.blockers.filter(merged), t)
        task.word = move.word ?? null
        go(task, 'starting', t)
        return
      case 'block':
        if (unstarted && !task.blockers.includes(move.on) && !wouldLoop((key) => byKey.get(key)?.blockers ?? [], task.key, move.on)) {
          wait(task, [...task.blockers, move.on], t)
          if (task.phase === 'starting' && !merged(move.on)) go(task, 'waits', t)
        }
        return
      case 'unblock':
        wait(
          task,
          task.blockers.filter((one) => one !== move.on),
          t,
        )
        return
      case 'swap':
        if (!unstarted || wouldLoop((key) => byKey.get(key)?.blockers ?? [], task.key, move.to)) return
        wait(task, [...new Set(task.blockers.map((one) => (one === move.from ? move.to : one)))], t)
        return
      case 'hold':
        if (!unstarted) return
        task.held = true
        go(task, 'waits', t)
        return
      case 'release':
        task.held = false
        return
      case 'merge':
        if (task.phase !== 'ready') return
        task.mergedAt = t
        go(task, 'merged', t)
        return
      case 'retry':
        if (task.phase === 'stuck') go(task, 'checks', t)
        return
    }
  }
  for (let t = 0; t <= until + 1e-9; t += STEP) {
    while (next < sorted.length && (sorted[next] as Move).at <= t + 1e-9) {
      apply(sorted[next] as Move, t)
      next += 1
    }
    for (const task of tasks) {
      const spec = specOf(task.key)
      const elapsed = t - task.since
      switch (task.phase) {
        // Ready once nothing holds it: every blocker merged, and not held by the person. Read again every step, so nothing it
        // missed while it was away can leave it waiting.
        case 'waits':
          if (!task.held && task.blockers.every(merged)) go(task, 'starting', t)
          break
        case 'starting':
          if (elapsed >= STARTING) {
            task.startedAt = t
            task.started = task.forced ? 'you' : task.blockers.length > 0 ? 'blockers' : 'free'
            task.worked = 0
            go(task, 'implement', t)
          }
          break
        case 'implement':
          task.worked += STEP
          if (task.worked >= spec.takes.implement) go(task, 'review', t)
          break
        case 'review':
          if (elapsed >= spec.takes.review) go(task, 'checks', t)
          break
        case 'checks':
          if (elapsed >= spec.takes.checks) {
            if (spec.breaks !== undefined && !task.fixedOnce) {
              task.fixedOnce = true
              go(task, 'stuck', t)
            } else go(task, 'ready', t)
          }
          break
        case 'ready':
          if (elapsed >= spec.takes.ready) {
            task.mergedAt = t
            go(task, 'merged', t)
          }
          break
        case 'stuck':
        case 'merged':
        case 'abandoned':
          break
      }
    }
  }
  const now: TaskNow[] = tasks.map((one) => ({
    key: one.key,
    phase: one.phase,
    since: one.since,
    blockers: one.blockers,
    held: one.held,
    startedAt: one.startedAt,
    started: one.started,
    mergedAt: one.mergedAt,
    abandonedAt: one.abandonedAt,
    word: one.word,
    without: one.without,
  }))
  return { t: until, tasks: now, byKey: new Map(now.map((one) => [one.key, one])), lastChange, changes }
}

/** When the last thing changes where nobody does anything more. */
export function endOf(moves: ReadonlyArray<Move>): number {
  const last = Math.max(0, ...moves.map((one) => one.at))
  return simulate(moves, last + 200).lastChange
}

/** What happens in the day by itself: the person abandons Sealing, stuck on its checks, a few minutes after it stuck. */
export const STORY: ReadonlyArray<Move> = [{ at: 20, kind: 'abandon', key: 'seal' }]

/* ——— reading it ——— */

/** Not started yet: waiting for its blockers or the person, or counting down. */
export const unstarted = (task: TaskNow): boolean => task.phase === 'waits' || task.phase === 'starting'

/** What it still waits for: its blockers not merged. */
export const openBlockers = (world: WorldNow, task: TaskNow): ReadonlyArray<TaskNow> =>
  task.blockers.map((key) => world.byKey.get(key)).filter((one): one is TaskNow => one !== undefined && one.phase !== 'merged')

/** Waiting for other tasks, not for the person: not started, with a blocker not merged. */
export const blocked = (world: WorldNow, task: TaskNow): boolean => task.phase === 'waits' && openBlockers(world, task).length > 0

/** The tasks that wait for this one now, not started yet. */
export const waitingOn = (world: WorldNow, key: string): ReadonlyArray<TaskNow> =>
  world.tasks.filter((one) => unstarted(one) && one.blockers.includes(key) && world.byKey.get(key)?.phase !== 'merged')

/** Everything after it, through what waits for what waits for it, in order. */
export const allAfter = (world: WorldNow, key: string): ReadonlyArray<TaskNow> => {
  const found: TaskNow[] = []
  const walk = (at: string) => {
    for (const one of waitingOn(world, at)) {
      if (found.includes(one)) continue
      found.push(one)
      walk(one.key)
    }
  }
  walk(key)
  return found
}

/** A blocker that was abandoned, and what waits on it: put to the person. */
export interface Ask {
  readonly blocker: TaskNow
  readonly waiting: ReadonlyArray<TaskNow>
  readonly at: number
}

/** Each abandoned task something still waits for: read from where things stand, so it goes once it's answered or reopened. */
export const asksOf = (world: WorldNow): ReadonlyArray<Ask> =>
  world.tasks
    .filter((one) => one.phase === 'abandoned')
    .map((blocker) => ({ blocker, waiting: waitingOn(world, blocker.key), at: blocker.abandonedAt ?? 0 }))
    .filter((one) => one.waiting.length > 0)

/** The tasks it could wait for: not itself, not settled, and not one that would have it wait for itself, which says why. */
export const choicesFor = (world: WorldNow, key: string): ReadonlyArray<{ readonly task: TaskNow; readonly loops: boolean }> => {
  const task = world.byKey.get(key)
  if (task === undefined) return []
  return world.tasks
    .filter((one) => one.key !== key && one.phase !== 'merged' && one.phase !== 'abandoned' && !task.blockers.includes(one.key))
    .map((one) => ({ task: one, loops: wouldLoop((at) => world.byKey.get(at)?.blockers ?? [], key, one.key) }))
}

/** The tasks that could wait for it: not started, not itself, and not one it waits for; those that would loop say why. */
export const followersFor = (world: WorldNow, key: string): ReadonlyArray<{ readonly task: TaskNow; readonly loops: boolean }> =>
  world.tasks
    .filter((one) => one.key !== key && unstarted(one) && !one.blockers.includes(key))
    .map((one) => ({ task: one, loops: wouldLoop((at) => world.byKey.get(at)?.blockers ?? [], one.key, key) }))

/** Where it stands, in a word or two, as its card would say it. */
export const stateWord = (task: TaskNow): string => {
  switch (task.phase) {
    case 'waits':
      return task.held ? 'Held' : 'Waiting'
    case 'starting':
      return 'Starting'
    case 'implement':
      return 'Implementing'
    case 'review':
      return 'In review'
    case 'checks':
      return 'Checks running'
    case 'stuck':
      return 'Stuck'
    case 'ready':
      return 'Ready to merge'
    case 'merged':
      return 'Merged'
    case 'abandoned':
      return 'Abandoned'
  }
}

/** Names in a list: A, B and C. */
export const listed = (names: ReadonlyArray<string>): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) as string}`

export const shortOf = (key: string): string => specOf(key).short
