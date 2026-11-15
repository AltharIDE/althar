/*
 * The lab's world: requests the coordinator split into tasks, each task with
 * what it depends on, and a simulation of the work as it would run. A task
 * waits until every task it depends on has merged, starts by itself, works,
 * is reviewed, opens its pull request, runs its checks, and waits for the
 * person to merge it. Some ask the person something on the way; one fails a
 * check and fixes it; one fails for good and leaves what depends on it
 * stuck. The person's moves (start now, stop waiting for one, hold, answer,
 * merge, try again) are kept with the time they were made, so the whole
 * thing is a pure function of the time: scrubbing back replays it.
 *
 * Time is in minutes of work. The page plays it at a minute a second, times
 * its speed.
 */

export type ScenarioKey = 'two' | 'six' | 'cloud'

export interface TaskSpec {
  readonly key: string
  readonly title: string
  /** A word or two, where the graph is drawn small. */
  readonly short: string
  readonly deps: ReadonlyArray<string>
  /** What the step does, in a sentence: what the coordinator tells its lead. */
  readonly what: string
  /** Why it's this step, here, with this lead: the coordinator's reason, in a sentence. */
  readonly why: string
  /** A step whose work is mostly how something looks and reads. */
  readonly design?: boolean
  readonly lead: 'claude-code' | 'codex'
  readonly model: string
  readonly effort?: 'medium' | 'high' | 'xhigh'
  /** What the person said about this step, for its lead to keep to. */
  readonly notes?: ReadonlyArray<string>
  readonly pr: number
  /** Minutes each part takes. `ready` is how long the person takes to merge, where they don't press Merge. */
  readonly takes: { readonly implement: number; readonly review: number; readonly checks: number; readonly ready: number }
  /** Asks the person something, this far into implementing, and is answered after `for` where nobody presses. */
  readonly asks?: { readonly after: number; readonly for: number; readonly what: string; readonly command: string }
  /** A check fails once, and the lead fixes it in this long. */
  readonly flaky?: { readonly fix: number; readonly check: string }
  /** A check fails and the lead can't fix it: it stops, and waits for the person. */
  readonly breaks?: { readonly check: string }
}

export interface Scenario {
  readonly key: ScenarioKey
  /** The request, in a few words: what the graph is called. */
  readonly name: string
  /** What the person asked, in their words. */
  readonly asked: string
  /** What the coordinator answered, splitting it: a line. */
  readonly answer: string
  /** Why the plan is shaped as it is, a point each: order, what runs together, who leads. */
  readonly reasons: ReadonlyArray<string>
  readonly tasks: ReadonlyArray<TaskSpec>
}

const opus = 'claude-opus-5-5'
const sol = 'gpt-6.1-sol'

export const SCENARIOS: Readonly<Record<ScenarioKey, Scenario>> = {
  two: {
    key: 'two',
    name: 'Plans become tiers',
    asked: 'Rename plans to tiers everywhere, the API first and then the dashboard.',
    answer: 'Two tasks, one after the other.',
    reasons: ['The dashboard waits for the API to merge, so it builds on the new names rather than guessing them.'],
    tasks: [
      {
        key: 'api',
        title: 'Rename plans to tiers in the API',
        short: 'API',
        deps: [],
        what: 'Renames plans to tiers in the schema, the API and its clients, keeping the old routes as aliases for a release.',
        why: 'Everything else reads these names, so it goes first.',
        lead: 'claude-code',
        model: opus,
        pr: 431,
        takes: { implement: 11, review: 5, checks: 4, ready: 3 },
      },
      {
        key: 'dashboard',
        title: 'Rename plans to tiers in the dashboard',
        short: 'Dashboard',
        deps: ['api'],
        what: 'Renames plans to tiers on every screen of the dashboard, and the words around them.',
        why: 'Waits for the API, so its types come from what merged.',
        design: true,
        lead: 'claude-code',
        model: opus,
        pr: 434,
        takes: { implement: 9, review: 4, checks: 4, ready: 3 },
      },
    ],
  },
  six: {
    key: 'six',
    name: 'Pay in instalments',
    asked:
      'Let customers pay in instalments: plans in the schema, an API for them, charging each one when it’s due, checkout offering them, receipts listing them, and a guide in the docs.',
    answer: 'Six tasks, in four waves.',
    reasons: [
      'The schema goes first: everything else reads it.',
      'The API and charging start together once it merges; neither needs the other.',
      'Receipts wait for both, since they list what was charged against each plan.',
      'Charging goes to Codex on GPT-6.1 Sol: it’s mostly queue plumbing. The rest is Claude Opus 5.5.',
    ],
    tasks: [
      {
        key: 'schema',
        title: 'Instalment plans in the schema',
        short: 'Schema',
        deps: [],
        what: 'Adds instalment plans and their schedule to the schema, with a migration.',
        why: 'Everything else reads these tables.',
        lead: 'claude-code',
        model: opus,
        pr: 412,
        takes: { implement: 7, review: 4, checks: 3, ready: 3 },
      },
      {
        key: 'api',
        title: 'API for instalment plans',
        short: 'API',
        deps: ['schema'],
        what: 'Endpoints to offer, create and cancel an instalment plan.',
        why: 'Checkout and receipts both call it.',
        lead: 'claude-code',
        model: opus,
        pr: 415,
        takes: { implement: 12, review: 5, checks: 4, ready: 3 },
      },
      {
        key: 'charges',
        title: 'Charge each instalment when it’s due',
        short: 'Charges',
        deps: ['schema'],
        what: 'A job that charges each instalment on its day, and retries a declined one.',
        why: 'Only needs the schema, so it runs beside the API.',
        lead: 'codex',
        model: sol,
        pr: 416,
        takes: { implement: 10, review: 5, checks: 4, ready: 4 },
        asks: { after: 4, for: 9, what: 'Asks to run docker compose up', command: 'docker compose up -d queue' },
      },
      {
        key: 'checkout',
        title: 'Offer instalments at checkout',
        short: 'Checkout',
        deps: ['api'],
        what: 'Checkout offers instalments where a basket qualifies, and shows the schedule.',
        why: 'Builds on the API’s endpoints rather than mocking them.',
        design: true,
        lead: 'claude-code',
        model: opus,
        pr: 419,
        takes: { implement: 13, review: 5, checks: 4, ready: 3 },
        flaky: { fix: 5, check: 'e2e' },
      },
      {
        key: 'receipts',
        title: 'Receipts list each instalment',
        short: 'Receipts',
        deps: ['api', 'charges'],
        what: 'Receipts list each instalment, paid and to come.',
        why: 'Needs both what was offered and what was charged.',
        lead: 'codex',
        model: sol,
        pr: 421,
        takes: { implement: 8, review: 4, checks: 4, ready: 3 },
      },
      {
        key: 'docs',
        title: 'A guide to instalments in the docs',
        short: 'Docs',
        deps: ['checkout', 'receipts'],
        what: 'A guide to instalments for merchants, with screenshots of checkout and a receipt.',
        why: 'Last, so it describes what shipped.',
        lead: 'claude-code',
        model: opus,
        pr: 424,
        takes: { implement: 6, review: 3, checks: 3, ready: 3 },
      },
    ],
  },
  cloud: {
    key: 'cloud',
    name: 'Althar Cloud',
    asked:
      'Let’s ship Althar Cloud’s first slice: a project that lives on my own Linux host, its tasks running there while my Mac sleeps, and the app picking up where it left off. Work out the pieces and run them as a graph; I’ll check back tonight.',
    answer: 'Twelve tasks, in five waves. ADR-103’s first slice, end to end.',
    reasons: [
      'The host service and sealing start at once: nothing works without the service, and sealing secrets doesn’t need it.',
      'Pairing comes next. The remote project, the Hosts screen and reconnecting all need a paired device.',
      'Files, runs and agent sign-in start together once a project lives on the host; they don’t touch each other.',
      'The VPS proof waits for everything it exercises, and the guide comes last, from what actually shipped.',
      'Codex on GPT-6.1 Sol takes the protocol work. Claude Opus 5.5 takes the service, what you’ll see, and the proof.',
    ],
    tasks: [
      {
        key: 'host',
        title: 'The host service',
        short: 'Host service',
        deps: [],
        what: 'apps/host: the runtime as a service on Linux, with versioned RPC over a private socket, started by systemd.',
        why: 'Every other step talks to it.',
        lead: 'claude-code',
        model: opus,
        effort: 'xhigh',
        pr: 610,
        takes: { implement: 14, review: 5, checks: 4, ready: 3 },
      },
      {
        key: 'sealing',
        title: 'Seal secrets on a headless host',
        short: 'Sealing',
        deps: [],
        what: 'Keeps sign-ins and keys sealed on a host with no keyring, unsealed only by the service.',
        why: 'Needs nothing else, so it runs beside the service from the start.',
        lead: 'codex',
        model: sol,
        pr: 611,
        takes: { implement: 11, review: 4, checks: 4, ready: 3 },
      },
      {
        key: 'pairing',
        title: 'Pair a device with the host',
        short: 'Pairing',
        deps: ['host'],
        what: 'Signed device attachment and revocation: the Mac pairs once and is known from then on.',
        why: 'The project, the Hosts screen and reconnecting all need a paired device.',
        lead: 'codex',
        model: sol,
        pr: 614,
        takes: { implement: 10, review: 4, checks: 3, ready: 3 },
      },
      {
        key: 'ssh',
        title: 'Set a host up over SSH',
        short: 'SSH setup',
        deps: ['host', 'sealing'],
        what: 'Installs and starts the host service on a fresh VPS over SSH, from the app.',
        why: 'Installs the service with its sealing, so it waits for both.',
        lead: 'claude-code',
        model: opus,
        pr: 615,
        takes: { implement: 9, review: 4, checks: 3, ready: 3 },
        asks: { after: 4, for: 9, what: 'Asks to reach your VPS', command: 'ssh althar@vps-1.example.net' },
      },
      {
        key: 'project',
        title: 'A project that lives on the host',
        short: 'Remote project',
        deps: ['pairing'],
        what: 'Creates a project on the host and clones its repositories there, rather than moving a local one.',
        why: 'Files, runs and sign-in all act on a project that lives there.',
        lead: 'claude-code',
        model: opus,
        pr: 618,
        takes: { implement: 11, review: 4, checks: 4, ready: 3 },
      },
      {
        key: 'hosts',
        title: 'Hosts in Settings',
        short: 'Hosts screen',
        deps: ['pairing'],
        what: 'A Hosts section in Settings to add a host, pair it, and see whether it’s online.',
        why: 'Only needs pairing, so it runs while the project work goes on.',
        design: true,
        lead: 'claude-code',
        model: opus,
        pr: 619,
        takes: { implement: 12, review: 5, checks: 3, ready: 4 },
      },
      {
        key: 'files',
        title: 'Files, diffs and outputs from the host',
        short: 'Files & diffs',
        deps: ['project'],
        what: 'The app reads a task’s files, diffs and outputs from the host as it does locally.',
        why: 'Starts once a project lives on the host; touches nothing the others do.',
        lead: 'codex',
        model: sol,
        pr: 622,
        takes: { implement: 10, review: 4, checks: 3, ready: 3 },
      },
      {
        key: 'runs',
        title: 'Forward runs and previews',
        short: 'Runs',
        deps: ['project'],
        what: 'A dev server on the host shows in the app’s page as if it ran here.',
        why: 'Starts with files, beside it.',
        lead: 'codex',
        model: sol,
        pr: 623,
        takes: { implement: 12, review: 4, checks: 4, ready: 3 },
        breaks: { check: 'e2e' },
      },
      {
        key: 'signin',
        title: 'Agents sign in on the host',
        short: 'Agent sign-in',
        deps: ['sealing', 'project'],
        what: 'Claude Code and Codex sign in on the host with the person’s plans, refresh, and report usage.',
        why: 'Keeps its tokens sealed, on a project that lives there.',
        lead: 'claude-code',
        model: opus,
        pr: 624,
        takes: { implement: 10, review: 4, checks: 4, ready: 3 },
        flaky: { fix: 4, check: 'integration' },
      },
      {
        key: 'reconnect',
        title: 'Reconnect, and answer from another device',
        short: 'Reconnect',
        deps: ['pairing', 'files'],
        what: 'The app picks up where it left off after sleep, and an ask can be answered from another paired device.',
        why: 'Replays what changed, files included.',
        lead: 'claude-code',
        model: opus,
        pr: 627,
        takes: { implement: 11, review: 4, checks: 3, ready: 3 },
      },
      {
        key: 'proof',
        title: 'Prove it on a real VPS',
        short: 'VPS proof',
        deps: ['ssh', 'runs', 'signin', 'reconnect'],
        what: 'On a real VPS with the Mac asleep: a task builds, records its result, and an ask is answered on waking.',
        why: 'Waits for everything it exercises.',
        lead: 'claude-code',
        model: opus,
        effort: 'xhigh',
        pr: 630,
        takes: { implement: 9, review: 3, checks: 3, ready: 3 },
      },
      {
        key: 'guide',
        title: 'A guide to Althar Cloud',
        short: 'Guide',
        deps: ['hosts', 'proof'],
        what: 'A guide on the site: set up a host, pair, move work there.',
        why: 'Last, so it describes what shipped.',
        lead: 'claude-code',
        model: opus,
        pr: 632,
        takes: { implement: 6, review: 3, checks: 2, ready: 3 },
      },
    ],
  },
}

/* ——— the simulation ——— */

export type Phase = 'waits' | 'starting' | 'implement' | 'asks' | 'review' | 'checks' | 'fixing' | 'failed' | 'ready' | 'merged'

/** What the person did, and when. */
export type Move =
  | { readonly at: number; readonly kind: 'start'; readonly key: string }
  | { readonly at: number; readonly kind: 'unlink'; readonly key: string; readonly dep: string }
  | { readonly at: number; readonly kind: 'hold'; readonly key: string }
  | { readonly at: number; readonly kind: 'release'; readonly key: string }
  | { readonly at: number; readonly kind: 'answer'; readonly key: string }
  | { readonly at: number; readonly kind: 'merge'; readonly key: string }
  | { readonly at: number; readonly kind: 'retry'; readonly key: string }

export interface TaskNow {
  readonly key: string
  readonly phase: Phase
  /** When it came into this phase. */
  readonly since: number
  /** What it depends on now: the person may have taken one away. */
  readonly deps: ReadonlyArray<string>
  /** Held by the person: it won't start until they say. */
  readonly held: boolean
  /** When it started work; null before. */
  readonly startedAt: number | null
  readonly mergedAt: number | null
  /** It failed a check once already and fixed it. */
  readonly fixedOnce: boolean
  /** The pull request is open: after its review. */
  readonly prOpen: boolean
}

export interface WorldNow {
  readonly t: number
  readonly tasks: ReadonlyArray<TaskNow>
  /** Every task merged. */
  readonly done: boolean
  /** When anything last changed phase. */
  readonly lastChange: number
}

/** How long a task counts down before it starts by itself, once nothing holds it. */
const STARTING = 1.5
/** The simulation's step. */
const STEP = 0.25

interface Mutable {
  key: string
  phase: Phase
  since: number
  deps: string[]
  held: boolean
  startedAt: number | null
  mergedAt: number | null
  fixedOnce: boolean
  asked: boolean
  prOpen: boolean
  /** Minutes worked in the current phase; asking pauses implementing. */
  worked: number
  /** Started by the person, whatever it waits for. */
  forced: boolean
}

export function simulate(scenario: Scenario, moves: ReadonlyArray<Move>, until: number): WorldNow {
  const specs = new Map(scenario.tasks.map((one) => [one.key, one]))
  const tasks: Mutable[] = scenario.tasks.map((one) => ({
    key: one.key,
    phase: 'waits',
    since: 0,
    deps: [...one.deps],
    held: false,
    startedAt: null,
    mergedAt: null,
    fixedOnce: false,
    asked: false,
    prOpen: false,
    worked: 0,
    forced: false,
  }))
  const byKey = new Map(tasks.map((one) => [one.key, one]))
  const sorted = moves.toSorted((a, b) => a.at - b.at)
  let next = 0
  let lastChange = 0
  const go = (task: Mutable, phase: Phase, t: number) => {
    task.phase = phase
    task.since = t
    task.worked = 0
    lastChange = t
  }
  const apply = (move: Move, t: number) => {
    const task = byKey.get(move.key)
    if (task === undefined) return
    switch (move.kind) {
      case 'start':
        if (task.phase === 'waits') {
          task.forced = true
          task.held = false
          go(task, 'implement', t)
          task.startedAt = t
        }
        return
      case 'unlink':
        task.deps = task.deps.filter((one) => one !== move.dep)
        return
      case 'hold':
        if (task.phase === 'waits' || task.phase === 'starting') {
          task.held = true
          go(task, 'waits', t)
        }
        return
      case 'release':
        task.held = false
        return
      case 'answer':
        if (task.phase === 'asks') {
          task.asked = true
          task.phase = 'implement'
          task.since = t
        }
        return
      case 'merge':
        if (task.phase === 'ready') {
          go(task, 'merged', t)
          task.mergedAt = t
        }
        return
      case 'retry':
        if (task.phase === 'failed') go(task, 'fixing', t)
        return
    }
  }
  for (let t = 0; t <= until + 1e-9; t += STEP) {
    while (next < sorted.length && (sorted[next] as Move).at <= t + 1e-9) {
      apply(sorted[next] as Move, t)
      next += 1
    }
    for (const task of tasks) {
      const spec = specs.get(task.key) as TaskSpec
      const elapsed = t - task.since
      switch (task.phase) {
        case 'waits': {
          if (task.held) break
          const ready = task.deps.every((dep) => byKey.get(dep)?.phase === 'merged')
          if (ready) go(task, 'starting', t)
          break
        }
        case 'starting':
          if (elapsed >= STARTING) {
            go(task, 'implement', t)
            task.startedAt = t
          }
          break
        case 'implement':
          task.worked += STEP
          if (spec.asks !== undefined && !task.asked && task.worked >= spec.asks.after) {
            task.phase = 'asks'
            task.since = t
            break
          }
          if (task.worked >= spec.takes.implement) go(task, 'review', t)
          break
        case 'asks':
          if (spec.asks !== undefined && elapsed >= spec.asks.for) {
            task.asked = true
            task.phase = 'implement'
            task.since = t
          }
          break
        case 'review':
          if (elapsed >= spec.takes.review) {
            go(task, 'checks', t)
            task.prOpen = true
          }
          break
        case 'checks':
          if (elapsed >= spec.takes.checks) {
            if (spec.flaky !== undefined && !task.fixedOnce) {
              go(task, 'fixing', t)
              task.fixedOnce = true
            } else if (spec.breaks !== undefined && !task.fixedOnce) {
              go(task, 'failed', t)
              task.fixedOnce = true
            } else go(task, 'ready', t)
          }
          break
        case 'fixing':
          if (elapsed >= (spec.flaky?.fix ?? 5)) go(task, 'checks', t)
          break
        case 'failed':
          break
        case 'ready':
          if (elapsed >= spec.takes.ready) {
            go(task, 'merged', t)
            task.mergedAt = t
          }
          break
        case 'merged':
          break
      }
    }
  }
  return {
    t: until,
    tasks: tasks.map((one) => ({
      key: one.key,
      phase: one.phase,
      since: one.since,
      deps: one.deps,
      held: one.held,
      startedAt: one.startedAt,
      mergedAt: one.mergedAt,
      fixedOnce: one.fixedOnce,
      prOpen: one.prOpen,
    })),
    done: tasks.every((one) => one.phase === 'merged'),
    lastChange,
  }
}

/** When the last thing changes where nobody does anything more: every task merged, or what's left waits on the person. */
export function endOf(scenario: Scenario, moves: ReadonlyArray<Move>): number {
  const last = Math.max(0, ...moves.map((one) => one.at))
  return simulate(scenario, moves, last + 300).lastChange
}
