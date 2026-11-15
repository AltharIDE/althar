import type { FieldAnswer } from '@althar/contracts'

import { again, clock, move, type Moving, store, worldNow } from './state'
import {
  choicesFor,
  listed,
  type Move,
  openBlockers,
  shortOf,
  simulate,
  TASKS,
  type TaskNow,
  unstarted,
  waitingOn,
  wouldLoop,
  type WorldNow,
} from './world'

/*
 * The coordinator's side: the conversation where the day's tasks were set
 * waiting for each other, what the person tells it after, read into moves
 * with its answer (C sets blockers this way), and, in C, the question it
 * puts to the person for each abandoned blocker, with what it would do.
 */

/** Something said to the coordinator, and its answer, at a minute. */
export interface Exchange {
  readonly you: string
  readonly answer: string
  readonly at: number
}

export const talk = store<ReadonlyArray<Exchange>>([])

/** The tasks a message names, in the order it names them: by their name, or a long word of it, as whole words. */
const named = (text: string): Array<{ key: string; at: number }> => {
  const lower = text.toLowerCase()
  const found: Array<{ key: string; at: number }> = []
  for (const spec of TASKS) {
    const words = [
      spec.short.toLowerCase(),
      ...spec.short
        .toLowerCase()
        .split(/\s+/)
        .filter((one) => one.length > 4),
    ]
    const extra = spec.key === 'ssh' ? ['ssh'] : spec.key === 'hosts' ? ['hosts screen', 'hosts section'] : []
    const at = Math.min(...[...words, ...extra].map((one) => new RegExp(`\\b${one}\\b`).exec(lower)?.index ?? Infinity))
    if (at !== Infinity) found.push({ key: spec.key, at })
  }
  return found.toSorted((a, b) => a.at - b.at)
}

/** What the coordinator makes of a message: the moves it means, and what it answers. */
export const read = (text: string, world: WorldNow): { moves: ReadonlyArray<Moving>; answer: string } => {
  const lower = text.toLowerCase()
  const found = named(text)
  const task = (key: string) => world.byKey.get(key) as TaskNow
  if (found.length === 0) return { moves: [], answer: 'Which task do you mean?' }
  const first = found[0] as { key: string; at: number }
  if (/\b(don.t|doesn.t|needn.t|no need to|stop)\b[^.]*\bwait/.test(lower) || /\bwithout\b/.test(lower)) {
    const [dep, ...from] = found.map((one) => one.key)
    const off = from.filter((one) => task(dep as string).blockers.includes(one))
    if (dep === undefined || off.length === 0) return { moves: [], answer: `${shortOf(first.key)} doesn’t wait for that.` }
    const left = openBlockers(world, task(dep)).filter((one) => !off.includes(one.key))
    return {
      moves: off.map((on) => ({ kind: 'unblock' as const, key: dep, on })),
      answer: `${shortOf(dep)} no longer waits for ${listed(off.map(shortOf))}.${left.length === 0 ? (task(dep).held ? ' It’s held, so it waits for your word.' : ' It starts now.') : ` It still waits for ${listed(left.map((one) => shortOf(one.key)))}.`}`,
    }
  }
  if (/\babandon\b/.test(lower)) return { moves: [{ kind: 'abandon', key: first.key }], answer: `Abandoned ${shortOf(first.key)}.` }
  if (/\breopen\b/.test(lower)) return { moves: [{ kind: 'reopen', key: first.key }], answer: `Opened ${shortOf(first.key)} again.` }
  const after = /\b(after|once|when|until|waits? for|blocked by)\b/.exec(lower)
  if (after === null) {
    if (/\bstart\b/.test(lower)) {
      if (!unstarted(task(first.key))) return { moves: [], answer: `${shortOf(first.key)} has started already.` }
      return { moves: [{ kind: 'start', key: first.key }], answer: `Starting ${shortOf(first.key)} now.` }
    }
    return { moves: [], answer: `What should ${shortOf(first.key)} wait for?` }
  }
  // The tasks named after the word are what's waited for, up to a comma; the rest are what waits.
  const end = lower.indexOf(',', after.index)
  const blockers = found.filter((one) => one.at > after.index && (end === -1 || one.at < end)).map((one) => one.key)
  const deps = found.map((one) => one.key).filter((one) => !blockers.includes(one))
  if (blockers.length === 0 || deps.length === 0) return { moves: [], answer: 'Which task should wait, and for what?' }
  const out: Array<Moving> = []
  const said: string[] = []
  for (const dep of deps) {
    const one = task(dep)
    if (!unstarted(one)) {
      said.push(`${shortOf(dep)} has started already, so it can’t wait now.`)
      continue
    }
    const fresh = blockers.filter((on) => !one.blockers.includes(on))
    const loops = fresh.filter((on) => wouldLoop((key) => world.byKey.get(key)?.blockers ?? [], dep, on))
    if (loops.length > 0) {
      said.push(`${shortOf(dep)} can’t wait for ${listed(loops.map(shortOf))}: ${listed(loops.map(shortOf))} already waits for it.`)
      continue
    }
    for (const on of fresh) out.push({ kind: 'block', key: dep, on })
    const all = [...new Set([...one.blockers.filter((on) => world.byKey.get(on)?.phase !== 'merged'), ...fresh])]
    const once = all.length === 1 ? 'once it’s merged' : 'once they’ve merged'
    said.push(
      `${shortOf(dep)} waits for ${listed(all.map(shortOf))}${one.held ? `. It’s held too, so ${once} it still waits for your word` : ` and starts by itself ${once}`}.`,
    )
  }
  return { moves: out, answer: out.length > 0 ? `Done. ${said.join(' ')}` : said.join(' ') }
}

/** The person tells the coordinator something: it does what it means, and answers. */
export const tell = (text: string) => {
  const world = worldNow()
  const meant = read(text, world)
  for (const one of meant.moves) move(one)
  talk.set((was) => [...was, { you: text, answer: meant.answer, at: clock.get() }])
}

/* ——— the coordinator's question, for each abandoned blocker (C) ——— */

/** What the coordinator would do about one task that waited for an abandoned one, and why, in a line. */
const SUGGESTED: Readonly<Record<string, { readonly pick: 'start' | 'only' | 'reopen' | 'abandon'; readonly why: string }>> = {
  'seal>ssh': {
    pick: 'start',
    why: 'it needs Sealing only to keep the host’s key, and its lead can keep that in the host service until sealing comes back.',
  },
  'ssh>guide': { pick: 'only', why: 'the guide can leave setting up over SSH out, and say how to add a host by hand.' },
}

export interface QuestionOption {
  readonly value: string
  readonly label: string
  readonly note?: string
}

/** The choices for one task that waited for an abandoned one, the coordinator's first. */
export const optionsFor = (world: WorldNow, blocker: string, dep: TaskNow): ReadonlyArray<QuestionOption> => {
  const others = openBlockers(world, dep).filter((one) => one.key !== blocker)
  const after = waitingOn(world, dep.key)
  const pick = SUGGESTED[`${blocker}>${dep.key}`]?.pick ?? (others.length > 0 ? 'only' : 'start')
  const all: QuestionOption[] = [
    others.length > 0
      ? { value: `only:${dep.key}`, label: `Wait only for ${listed(others.map((one) => shortOf(one.key)))}` }
      : { value: `start:${dep.key}`, label: `Start ${shortOf(dep.key)} anyway` },
    { value: `reopen:${blocker}`, label: `Reopen ${shortOf(blocker)}`, note: 'it goes on where it stopped' },
    ...choicesFor(world, dep.key)
      .filter((one) => !one.loops && one.task.key !== blocker && !others.includes(one.task))
      .slice(0, 2)
      .map((one) => ({ value: `swap:${dep.key}:${one.task.key}`, label: `Wait for ${shortOf(one.task.key)} instead` })),
    {
      value: `abandon:${dep.key}`,
      label:
        after.length === 0
          ? `Abandon ${shortOf(dep.key)} too`
          : `Abandon ${shortOf(dep.key)} and ${listed(after.map((one) => shortOf(one.key)))}`,
    },
  ]
  const first = all.find((one) => one.value.startsWith(`${pick}:`)) ?? all[0]
  return [{ ...(first as QuestionOption), note: 'what I’d do' }, ...all.filter((one) => one !== first)]
}

/** What the coordinator says before it asks: what happened, and what it would do. */
export const askWords = (world: WorldNow, blocker: string, waiting: ReadonlyArray<TaskNow>): string => {
  const one = waiting[0]
  const opening = `${shortOf(blocker)} was abandoned, and ${listed(waiting.map((dep) => shortOf(dep.key)))} ${waiting.length === 1 ? 'waits' : 'wait'} for it.`
  if (one === undefined) return opening
  const tip = SUGGESTED[`${blocker}>${one.key}`]
  const others = openBlockers(world, one).filter((dep) => dep.key !== blocker)
  const would =
    tip?.pick === 'only' || others.length > 0
      ? `have ${shortOf(one.key)} wait only for ${listed(others.map((dep) => shortOf(dep.key)))}`
      : `start ${shortOf(one.key)} anyway`
  const later = waitingOn(world, one.key)
  return `${opening} I’d ${would}: ${tip?.why ?? 'nothing else it needs is missing.'}${later.length === 0 ? '' : ` ${listed(later.map((dep) => shortOf(dep.key)))} waits for ${shortOf(one.key)}, so this decides it too.`}`
}

/** An abandoned blocker put to the person, as it stood when it was abandoned. */
export interface Raised {
  readonly id: string
  readonly blocker: string
  readonly at: number
  /** Where things stood as it was asked, for its words and choices. */
  readonly world: WorldNow
  readonly waiting: ReadonlyArray<TaskNow>
}

/** Every abandonment so far that left something waiting, from the moves: asked as it happened, whether it's answered since or not. */
export const raisedOf = (all: ReadonlyArray<Move>): ReadonlyArray<Raised> =>
  all
    .filter((one) => one.kind === 'abandon' && one.at <= clock.get())
    .map((one) => {
      const world = simulate(all, one.at + 0.25)
      return { id: `ask_${one.key}_${one.at}`, blocker: one.key, at: one.at, world, waiting: waitingOn(world, one.key) }
    })
    .filter((one) => one.waiting.length > 0)

/** What the person answered each question, by its id. */
export const answered = store<ReadonlyMap<string, { readonly answers: Readonly<Record<string, FieldAnswer>>; readonly at: number }>>(
  new Map(),
)

/** Does what a choice says, for one task that waited. */
export const choose = (value: string, words?: string) => {
  const [kind, key, other] = value.split(':')
  if (key === undefined) return
  const world = worldNow()
  const word = words === undefined || words.trim() === '' ? undefined : words.trim()
  switch (kind) {
    case 'start':
      move({ kind: 'start', key, ...(word === undefined ? {} : { word }) })
      return
    case 'only': {
      const dep = world.byKey.get(key)
      if (dep === undefined) return
      for (const blocker of dep.blockers) if (world.byKey.get(blocker)?.phase === 'abandoned') move({ kind: 'unblock', key, on: blocker })
      return
    }
    case 'reopen':
      move({ kind: 'reopen', key })
      return
    case 'swap': {
      const dep = world.byKey.get(key)
      const from = dep?.blockers.find((one) => world.byKey.get(one)?.phase === 'abandoned')
      if (from !== undefined && other !== undefined) move({ kind: 'swap', key, from, to: other })
      return
    }
    case 'abandon':
      move({ kind: 'abandon', key })
      return
  }
}

/** The person answers the coordinator's question: each field a task that waited, its choice and any words of their own. */
export const answer = (id: string, answers: Readonly<Record<string, FieldAnswer>>) => {
  for (const one of Object.values(answers)) {
    const value = one.values[0]
    if (value !== undefined) choose(value, one.words)
    else if (one.words !== undefined && one.words.trim() !== '') tell(one.words)
  }
  answered.set((was) => new Map(was).set(id, { answers, at: clock.get() }))
}

/** The day again, from the start: nothing the person did or said, but the day's own. */
export const restart = () => {
  talk.set([])
  answered.set(new Map())
  again()
}
