import type { Scenario, TaskNow, TaskSpec, WorldNow } from './world'

/*
 * What the graph says about each task, from where the simulation has it:
 * where it stands in a word the board would use, what it waits for, what
 * merging it starts, and how each line between two tasks looks. Every
 * direction reads this, so the words are the same wherever the graph is.
 */

/** Where a task stands, as the graph draws it. */
export type Stand = 'waits' | 'stuck' | 'held' | 'starting' | 'running' | 'yours' | 'failed' | 'done'

export type Tone = 'quiet' | 'live' | 'signal' | 'danger'

export interface NodeView {
  readonly key: string
  readonly spec: TaskSpec
  readonly now: TaskNow
  readonly stand: Stand
  readonly tone: Tone
  /** Where it stands, in a few words: Waits for API and Charges, Implementing, Ready to merge. */
  readonly word: string
  /** Its pull request, once open: #415. */
  readonly pr: string | null
  /** What it still waits for, by key: its dependencies that haven't merged. */
  readonly waitsFor: ReadonlyArray<string>
  /** What waits only for this one: merging it starts them. */
  readonly starts: ReadonlyArray<string>
  /** Minutes it has worked, while it works. */
  readonly worked: number | null
  /** How far along its own steps it is: implement, review, checks, merge; for a small track. */
  readonly step: 0 | 1 | 2 | 3 | 4
  /** The task's slug, for opening it. */
  readonly slug: string
  readonly threadId: string
}

/** A line from what a task depends on into it. */
export type EdgeLook =
  /** What it depended on has merged. */
  | 'met'
  /** It still waits for it, and it's on its way. */
  | 'waits'
  /** It waits for it, and that waits on the person: their merge or answer starts it. */
  | 'you'
  /** It waits for it, and that failed. */
  | 'stuck'

export interface EdgeView {
  readonly from: string
  readonly to: string
  readonly look: EdgeLook
}

export interface GraphView {
  readonly scenario: Scenario
  readonly nodes: ReadonlyArray<NodeView>
  readonly edges: ReadonlyArray<EdgeView>
  readonly byKey: ReadonlyMap<string, NodeView>
  /** The request as a whole, in a word, and how loud. */
  readonly stand: { readonly word: string; readonly tone: Tone }
  readonly merged: number
}

export const slugOf = (scenario: Scenario, key: string) => `${scenario.key}-${key}`
export const threadIdOf = (scenario: Scenario, key: string) => `th_${slugOf(scenario, key)}`
export const taskIdOf = (scenario: Scenario, key: string) => `t_${slugOf(scenario, key)}`

/** Names in a run: API; API and Charges; API, Charges and Import. */
export const listed = (names: ReadonlyArray<string>): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

export function graphOf(scenario: Scenario, world: WorldNow): GraphView {
  const specs = new Map(scenario.tasks.map((one) => [one.key, one]))
  const nows = new Map(world.tasks.map((one) => [one.key, one]))
  const short = (key: string) => specs.get(key)?.short ?? key
  const phaseOf = (key: string) => nows.get(key)?.phase

  const nodes = scenario.tasks.map((spec): NodeView => {
    const now = nows.get(spec.key) as TaskNow
    const waitsFor = now.deps.filter((dep) => phaseOf(dep) !== 'merged')
    const failed = waitsFor.filter((dep) => phaseOf(dep) === 'failed')
    const starts = scenario.tasks
      .filter((other) => {
        const its = nows.get(other.key) as TaskNow
        if (its.phase !== 'waits' || its.held) return false
        const left = its.deps.filter((dep) => phaseOf(dep) !== 'merged')
        return left.length === 1 && left[0] === spec.key
      })
      .map((other) => other.key)
    const pr = now.prOpen ? `#${spec.pr}` : null
    const worked = now.startedAt === null || now.phase === 'merged' ? null : Math.max(1, Math.round(world.t - now.startedAt))
    const base = {
      key: spec.key,
      spec,
      now,
      pr,
      waitsFor,
      starts,
      worked,
      slug: slugOf(scenario, spec.key),
      threadId: threadIdOf(scenario, spec.key),
    }
    switch (now.phase) {
      case 'waits':
        if (now.held) return { ...base, stand: 'held', tone: 'quiet', word: 'Held', step: 0 }
        if (failed.length > 0)
          return { ...base, stand: 'stuck', tone: 'danger', word: `Can’t start: ${listed(failed.map(short))} failed`, step: 0 }
        return { ...base, stand: 'waits', tone: 'quiet', word: `Waits for ${listed(waitsFor.map(short))}`, step: 0 }
      case 'starting':
        return { ...base, stand: 'starting', tone: 'live', word: 'Starting', step: 0 }
      case 'implement':
        return { ...base, stand: 'running', tone: 'live', word: 'Implementing', step: 1 }
      case 'asks':
        return { ...base, stand: 'yours', tone: 'signal', word: spec.asks?.what ?? 'Asks you', step: 1 }
      case 'review':
        return { ...base, stand: 'running', tone: 'live', word: 'In review', step: 2 }
      case 'checks':
        return { ...base, stand: 'running', tone: 'live', word: 'Checks running', step: 3 }
      case 'fixing':
        return { ...base, stand: 'running', tone: 'live', word: `Fixing ${spec.flaky?.check ?? 'a check'}`, step: 3 }
      case 'failed':
        return { ...base, stand: 'failed', tone: 'danger', word: `${spec.breaks?.check ?? 'A check'} failed`, step: 3 }
      case 'ready':
        return { ...base, stand: 'yours', tone: 'signal', word: 'Ready to merge', step: 4 }
      case 'merged':
        return { ...base, stand: 'done', tone: 'quiet', word: 'Merged', step: 4 }
    }
  })
  const byKey = new Map(nodes.map((one) => [one.key, one]))

  const edges = nodes.flatMap((node) =>
    node.now.deps.map((dep): EdgeView => {
      const from = byKey.get(dep) as NodeView
      const look: EdgeLook =
        from.stand === 'done' ? 'met' : from.stand === 'failed' ? 'stuck' : from.now.phase === 'ready' ? 'you' : 'waits'
      return { from: dep, to: node.key, look }
    }),
  )

  const merged = nodes.filter((one) => one.stand === 'done').length
  const yours = nodes.filter((one) => one.stand === 'yours').length
  const failed = nodes.filter((one) => one.stand === 'failed').length
  const running = nodes.filter((one) => one.stand === 'running' || one.stand === 'starting').length
  const stand: GraphView['stand'] =
    merged === nodes.length
      ? { word: 'Merged', tone: 'quiet' }
      : failed > 0
        ? { word: 'A task failed', tone: 'danger' }
        : yours > 0
          ? { word: 'Needs you', tone: 'signal' }
          : running > 0
            ? { word: 'Running', tone: 'live' }
            : { word: 'Waiting', tone: 'quiet' }
  return { scenario, nodes, edges, byKey, stand, merged }
}

/* ——— where the graph puts things ——— */

/**
 * Each task's column: how many tasks stand before it on its longest line of
 * what it depends on. A task with nothing to wait for is in the first.
 */
export function depthsOf(nodes: ReadonlyArray<{ key: string; deps: ReadonlyArray<string> }>): Map<string, number> {
  const deps = new Map(nodes.map((one) => [one.key, one.deps]))
  const depth = new Map<string, number>()
  const of = (key: string, seen: Set<string>): number => {
    const known = depth.get(key)
    if (known !== undefined) return known
    if (seen.has(key)) return 0
    seen.add(key)
    const before = (deps.get(key) ?? []).filter((dep) => deps.has(dep))
    const d = before.length === 0 ? 0 : 1 + Math.max(...before.map((dep) => of(dep, seen)))
    depth.set(key, d)
    return d
  }
  for (const one of nodes) of(one.key, new Set())
  return depth
}

/**
 * The tasks in columns, each column ordered so lines cross as little as
 * they can: each task sits near the middle of what it depends on, and of
 * what depends on it, a few times over. Ties keep the order the
 * coordinator gave them.
 */
export function columnsOf(nodes: ReadonlyArray<{ key: string; deps: ReadonlyArray<string> }>): string[][] {
  const depth = depthsOf(nodes)
  const order = new Map(nodes.map((one, i) => [one.key, i]))
  const deps = new Map(nodes.map((one) => [one.key, one.deps]))
  const kids = new Map<string, string[]>()
  for (const one of nodes) for (const dep of one.deps) kids.set(dep, [...(kids.get(dep) ?? []), one.key])
  const count = Math.max(0, ...depth.values()) + 1
  const columns: string[][] = Array.from({ length: count }, () => [])
  for (const one of nodes) columns[depth.get(one.key) ?? 0]?.push(one.key)
  const place = new Map<string, number>()
  const mark = () => columns.forEach((column) => column.forEach((key, i) => place.set(key, i - (column.length - 1) / 2)))
  mark()
  const mean = (keys: ReadonlyArray<string>) => {
    const known = keys.map((key) => place.get(key)).filter((one): one is number => one !== undefined)
    return known.length === 0 ? null : known.reduce((a, b) => a + b, 0) / known.length
  }
  const sortBy = (column: string[], near: (key: string) => ReadonlyArray<string>) => {
    const scored = column.map((key) => ({ key, at: mean(near(key)) ?? place.get(key) ?? 0 }))
    scored.sort((a, b) => a.at - b.at || (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0))
    column.splice(0, column.length, ...scored.map((one) => one.key))
  }
  for (let pass = 0; pass < 4; pass += 1) {
    for (let c = 1; c < columns.length; c += 1) {
      sortBy(columns[c] as string[], (key) => deps.get(key) ?? [])
      mark()
    }
    for (let c = columns.length - 2; c >= 0; c -= 1) {
      sortBy(columns[c] as string[], (key) => kids.get(key) ?? [])
      mark()
    }
  }
  return columns
}

export interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface Laid {
  readonly boxes: ReadonlyMap<string, Box>
  readonly w: number
  readonly h: number
  readonly columns: ReadonlyArray<ReadonlyArray<string>>
}

/**
 * Boxes for every task: columns left to right (or rows top to bottom, where
 * `down`), each column centred on the tallest, a task `size` big, `gap`
 * between columns and `pitch` between tasks in one.
 */
export function lay(
  nodes: ReadonlyArray<{ key: string; deps: ReadonlyArray<string> }>,
  size: { readonly w: number; readonly h: number },
  gap: number,
  pitch: number,
  down = false,
): Laid {
  const columns = columnsOf(nodes)
  const tallest = Math.max(1, ...columns.map((one) => one.length))
  const across = down ? size.w : size.h
  const along = down ? size.h : size.w
  const span = tallest * across + (tallest - 1) * pitch
  const boxes = new Map<string, Box>()
  columns.forEach((column, c) => {
    const own = column.length * across + (column.length - 1) * pitch
    const start = (span - own) / 2
    column.forEach((key, i) => {
      const a = c * (along + gap)
      const b = start + i * (across + pitch)
      boxes.set(key, down ? { x: b, y: a, w: size.w, h: size.h } : { x: a, y: b, w: size.w, h: size.h })
    })
  })
  const length = columns.length * along + Math.max(0, columns.length - 1) * gap
  return { boxes, columns, w: down ? span : length, h: down ? length : span }
}

/**
 * A line from one box into another: out of the first's trailing side,
 * straight on, turning with rounded corners in the gap before the second,
 * and into its leading side. Where it would cross a box on the way, it
 * turns in the gap after the first instead.
 */
export function wire(from: Box, to: Box, boxes: Iterable<Box>, gap: number, down = false, turn = 8): string {
  const flip = (b: Box): Box => (down ? { x: b.y, y: b.x, w: b.h, h: b.w } : b)
  const f = flip(from)
  const t = flip(to)
  const x0 = f.x + f.w
  const y0 = f.y + f.h / 2
  const x1 = t.x
  const y1 = t.y + t.h / 2
  const others = [...boxes].map(flip).filter((b) => b !== f && b !== t)
  const hits = (y: number, xa: number, xb: number) => others.some((b) => b.x < xb && b.x + b.w > xa && y > b.y - 4 && y < b.y + b.h + 4)
  // Turn just before the target, unless the straight run at the source's height crosses a box; then just after the source.
  const late = x1 - gap / 2
  const early = x0 + gap / 2
  const xm = hits(y0, x0, late) && !hits(y1, early, x1) ? early : late
  const pt = (x: number, y: number) => (down ? `${y} ${x}` : `${x} ${y}`)
  if (Math.abs(y1 - y0) < 0.5) return `M ${pt(x0, y0)} L ${pt(x1, y1)}`
  const r = Math.min(turn, Math.abs(y1 - y0) / 2, gap / 4)
  const s = Math.sign(y1 - y0)
  // Each corner bends toward where the line goes next: the first from across to along, the second back.
  const sweep1 = s > 0 !== down ? 1 : 0
  const sweep2 = 1 - sweep1
  return [
    `M ${pt(x0, y0)}`,
    `L ${pt(xm - r, y0)}`,
    `A ${r} ${r} 0 0 ${sweep1} ${pt(xm, y0 + s * r)}`,
    `L ${pt(xm, y1 - s * r)}`,
    `A ${r} ${r} 0 0 ${sweep2} ${pt(xm + r, y1)}`,
    `L ${pt(x1, y1)}`,
  ].join(' ')
}
