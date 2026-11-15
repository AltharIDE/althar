import type { IconName } from '@althar/ui'
import { fold, type Hit, matchWord, type Part, partsOf, passageOf, type Ranges, wordsOf } from './match'
export interface Use {
  readonly at: number
  readonly n: number
}
export type Kind = 'task' | 'pull' | 'issue' | 'conversation' | 'said' | 'note' | 'file' | 'place' | 'action'

/** Where the person is as search opens: the project whose tab has the window, and the task on screen. */
export interface Context {
  readonly project: string | null
  readonly task: string | null
  readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly usage: Readonly<Record<string, Use>>
}

/** What choosing something does. */
export type Go =
  | { readonly to: 'home' }
  | { readonly to: 'task'; readonly slug: string; readonly at?: string }
  | {
      readonly to: 'project'
      readonly project: string
      readonly room?: string
      readonly section?: string
      readonly at?: string
      readonly threadId?: string
    }
  | { readonly to: 'settings'; readonly section: string }
  | { readonly to: 'ask'; readonly project: string; readonly text: string }
  | { readonly to: 'external'; readonly url: string }
  | { readonly to: 'allow'; readonly attentionId: string }
  | { readonly to: 'merge'; readonly taskId: string; readonly head: string; readonly url: string }
  | { readonly to: 'copy'; readonly text: string }
  | { readonly to: 'file'; readonly threadId: string; readonly path: string }
  | { readonly to: 'command'; readonly command: 'stop' | 'resume' | 'new-project' | 'usage'; readonly taskId?: string }

/** A thing a chosen entry can do, beyond opening. */
export interface Act {
  readonly id: string
  readonly title: string
  readonly icon: IconName
  readonly go: Go
  readonly shortcut?: string
  readonly danger?: boolean
}

/** Where it stands, in a word, and how loud. */
export interface Stand {
  readonly word: string
  readonly tone: 'live' | 'signal' | 'quiet' | 'bad'
}

export interface Entry {
  readonly id: string
  readonly kind: Kind
  readonly title: string
  readonly icon: IconName
  /** Exact keys it is found by on their own: #845, 845, DEV-58. */
  readonly keys?: ReadonlyArray<string>
  /** Words it is found by that it doesn't show: a branch, a slug, what it's also called. */
  readonly also?: string
  /** What is inside it, for passages: what was said, a note, a summary, an issue's body. */
  readonly body?: string
  readonly project?: string
  readonly projectName?: string
  readonly stand?: Stand
  /** Quiet facts after its title: a number, a path, who said it. */
  readonly facts?: ReadonlyArray<string>
  /** Minutes since it last changed. */
  readonly ago?: number
  /** Where what was said was said, for grouping by place: a task's slug, or `conversation:<project>`. */
  readonly place?: string
  readonly who?: 'you' | 'lead' | 'coordinator'
  /** An action's own key, drawn beside it. */
  readonly shortcut?: string
  /** What an action belongs to: this task, this project, or Althar. */
  readonly scope?: 'task' | 'project' | 'app'
  readonly go: Go
  readonly acts?: ReadonlyArray<Act>
  readonly danger?: boolean
}

/** A question's words that say nothing of what it asks about. */
const FILLER = new Set(
  'what why how where when who which did do does is are was were can could should would we i you it the a an to of in on about for and or our my me us there that this with any from been be have has had'.split(
    ' ',
  ),
)

export interface Found {
  readonly entry: Entry
  readonly score: number
  /** The letters of its title that matched. */
  readonly ranges: Ranges
  /** Where it matched inside, a few words either side, where it did. */
  readonly passage: ReadonlyArray<Part> | null
  /** A key typed exactly: it is the one meant. */
  readonly exact: boolean
}

const KIND_WEIGHT: Readonly<Record<Kind, number>> = {
  task: 1,
  place: 0.95,
  action: 0.95,
  pull: 0.9,
  issue: 0.9,
  conversation: 0.85,
  note: 0.8,
  said: 0.7,
  file: 0.6,
}

/** The habit: opened often and lately counts most, fading over a few days. */
const habitOf = (use: Use | undefined) => {
  if (use === undefined) return 0
  const days = (Date.now() - use.at) / 86_400_000
  return Math.min(8, 2 * Math.log2(1 + use.n / (1 + Math.max(0, days))))
}

const standWeight = (entry: Entry) => {
  switch (entry.stand?.tone) {
    case 'signal':
      return 3
    case 'live':
      return 2
    case 'bad':
      return 2
    default:
      return entry.stand?.word === 'Merged' || entry.stand?.word === 'Done' || entry.stand?.word === 'Abandoned' ? -1 : 0
  }
}

export interface Ask {
  /** The kinds to look at. */
  readonly kinds?: ReadonlyArray<Kind>
  /** Only this project's. */
  readonly project?: string | null
  /** Whether what is inside things (what was said, a note's body) counts, and how much. */
  readonly inside?: number
  /** Whether letters in order with gaps count. */
  readonly fuzzy?: boolean
  /** Any of the words will do, the more the better, and a question's filler words don't count: for words asked as a question. */
  readonly any?: boolean
}

const keyOf = (word: string) => fold(word).replace(/^#/, '')

/** Scores every entry against the words, best first. */
export const search = (entries: ReadonlyArray<Entry>, query: string, context: Context, ask: Ask = {}): ReadonlyArray<Found> => {
  const words = ask.any === true ? wordsOf(query).filter((word) => !FILLER.has(word)) : wordsOf(query)
  const inside = ask.inside ?? 0.35
  const out: Array<Found> = []
  for (const entry of entries) {
    if (ask.kinds !== undefined && !ask.kinds.includes(entry.kind)) continue
    if (ask.project != null && entry.project !== undefined && entry.project !== ask.project) continue
    let score = 0
    let exact = false
    const ranges: Array<readonly [number, number]> = []
    let ok = true
    let matched = 0
    for (const word of words) {
      const key = entry.keys?.some((one) => keyOf(one) === keyOf(word)) === true
      if (key) {
        exact = true
        score += 40
        continue
      }
      // The start of a number or a key: #84 finds #840 to #849.
      if (/\d/.test(word) && entry.keys?.some((one) => keyOf(one).startsWith(keyOf(word))) === true) {
        score += 14
        continue
      }
      const loose = (ask.fuzzy ?? true) && entry.kind !== 'said' && entry.kind !== 'note' && entry.title.length <= 80
      const title = matchWord(entry.title, word, loose)
      const also = entry.also === undefined ? null : matchWord(entry.also, word, false)
      const body = inside > 0 && entry.body !== undefined ? matchWord(entry.body, word, false) : null
      const best = Math.max(title?.score ?? 0, (also?.score ?? 0) * 0.6, (body?.score ?? 0) * inside)
      if (best === 0) {
        if (ask.any === true) continue
        ok = false
        break
      }
      matched += 1
      if (title !== null && title.score >= best) ranges.push(...title.ranges)
      score += best
    }
    if (!ok || (ask.any === true && matched === 0 && words.length > 0)) continue
    // Of words asked, each one more that matched counts, and all of them most.
    if (ask.any === true) score += matched * 3 + (matched === words.length ? 4 : 0)
    if (words.length === 0) score = 0
    // A phrase typed whole, in order, counts for more than its words apart.
    if (words.length > 1 && fold(entry.title).includes(words.join(' '))) score += 6
    score *= KIND_WEIGHT[entry.kind]
    score += habitOf(context.usage[entry.id]) + standWeight(entry)
    if (context.project !== null && entry.project === context.project) score += 2
    if (entry.scope === 'task') score += 5
    if (entry.place !== undefined && entry.place === context.task) score += 3
    if (entry.ago !== undefined) score += 1.5 / (1 + entry.ago / 1440)
    // What was said and a note are long: they show the words around where they matched, wherever that is.
    out.push({ entry, score, ranges: mergeRanges(ranges), passage: null, exact })
  }
  return out
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, 150)
    .map((one) => ({
      ...one,
      passage:
        one.entry.kind === 'said' || one.entry.kind === 'note'
          ? passageOf(one.entry.title, words, 60)
          : one.entry.body === undefined
            ? null
            : passageOf(one.entry.body, words),
    }))
}

const mergeRanges = (ranges: ReadonlyArray<readonly [number, number]>): Ranges => {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  for (const [from, to] of sorted) {
    const last = out.at(-1)
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to)
    else out.push([from, to])
  }
  return out
}

/** The title of what was found, the letters that matched marked. */
export const titleParts = (found: Found) => partsOf(found.entry.title, found.ranges)

/** Whether the words read as a question: a question mark, or a question's first word. */
export const asksSomething = (query: string) =>
  /\?\s*$/.test(query) || /^(what|why|how|where|when|who|which|did|do|does|is|are|can|should|could|would)\b/i.test(query.trim())

export const needsYou = (entries: ReadonlyArray<Entry>, context: Context) =>
  entries.filter(
    (one) => one.kind === 'task' && one.stand?.tone === 'signal' && (context.project === null || one.project === context.project),
  )
/** What was opened from search lately, most-used first; then the tasks changed last, each by its latest word. */
export const recent = (entries: ReadonlyArray<Entry>, context: Context, most = 6): ReadonlyArray<Entry> => {
  const uses = context.usage
  return entries
    .filter(
      (entry) =>
        (uses[entry.id] !== undefined || entry.kind === 'task') &&
        (context.project === null || entry.project === undefined || entry.project === context.project),
    )
    .sort((a, b) => habitOf(uses[b.id]) - habitOf(uses[a.id]) || (a.ago ?? Infinity) - (b.ago ?? Infinity))
    .slice(0, most)
}

/** The actions of where the person is: this task's, then this project's. */
export const actionsHere = (entries: ReadonlyArray<Entry>, _context: Context): ReadonlyArray<Entry> => {
  const task = entries.filter((entry) => entry.scope === 'task')
  if (task.length > 0) return task
  return entries.filter((entry) => entry.kind === 'action' && (entry.scope === 'project' || entry.scope === 'app'))
}

export const KINDS_NAMED: Readonly<Record<Kind, string>> = {
  task: 'Tasks',
  pull: 'Pull requests',
  issue: 'Issues',
  conversation: 'Conversations',
  said: 'What was said',
  note: 'Notes',
  file: 'Files',
  place: 'Places',
  action: 'Actions',
}

export type { Hit }
