import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * How the desktop app's windows follow the runtime's change feed, as a table,
 * so the responsiveness run's windows (window.ts) read what the app's would:
 * the one place to change as the app changes. Each line names where it is
 * from. What the app's sources say of the sets and the gathers is read from
 * them as the run starts, where they still say it the same way; the rest is
 * the table's, and the run prints which of each it ran with.
 */

const renderer = join(import.meta.dirname, '../../../../apps/desktop/src/renderer')

export interface Follows {
  /** feed.ts `GATHER`: how long a window gathers changes before it reads again what they touched. */
  readonly gather: number
  /** feed.ts `BOARD`: what reads a project's board again, every board the window holds. */
  readonly board: ReadonlyArray<string>
  /** feed.ts `HOME`: what reads the home again. */
  readonly home: ReadonlyArray<string>
  /** feed.ts `HOME_SHOWN`: what reads the home again only while it shows. */
  readonly homeShown: ReadonlyArray<string>
  /** feed.ts `PROJECTS`: what reads the projects again. */
  readonly projects: ReadonlyArray<string>
  /** feed.ts `CONNECTIONS`: what reads the connections again. */
  readonly connections: ReadonlyArray<string>
  /** feed.ts `wholeReads`: what reads a project's rules again, while its screen shows them. */
  readonly rules: ReadonlyArray<string>
  /** feed.ts `CARDS`: what, of its project, reads the task cards in a coordinator's thread on screen again, item by item. */
  readonly cards: ReadonlyArray<string>
  /** feed.ts `AUTOMATIONS`: what reads a project's automations again while its screen shows, and their cards in its coordinator's thread. */
  readonly automations: ReadonlyArray<string>
  /** useTask.ts and useProject.ts `GATHER`: how long a thread on screen gathers its changes before it reads them. */
  readonly threadGather: number
  /** useEdge.ts `GATHER`: how long the edge gathers changes before it reads the home again. */
  readonly edgeGather: number
  /**
   * useProject.ts: on one of `cards`, a coordinator on screen reads again every task card it holds, one by one
   * (`changed.current.cards`), rather than only the card that changed.
   */
  readonly everyCard: boolean
  /** A whole read under way when a change touches it is let finish, and read once more as it ends (feed.ts `readDue`). */
  readonly oneAtATime: boolean
}

/** The table, as the app follows the feed at 9cde0f5. */
export const BUILT_IN: Follows = {
  gather: 60,
  board: ['card', 'project'],
  home: ['card', 'project', 'decision'],
  homeShown: ['decision'],
  projects: ['project', 'card', 'task', 'run', 'provider_session', 'attention_request'],
  connections: ['connection', 'project'],
  rules: ['policy'],
  cards: ['card', 'provider_session', 'attention_request', 'task_plan', 'run', 'task', 'workspace'],
  automations: ['automation', 'automation_occurrence', 'attention_request'],
  threadGather: 25,
  edgeGather: 120,
  everyCard: true,
  oneAtATime: true,
}

const read = (file: string) => {
  const path = join(renderer, file)
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/** The words of a `new Set([...])` named `name` in `source`, its spreads of sets read before it followed. */
const setIn = (source: string, name: string, known: Readonly<Record<string, ReadonlyArray<string>>>) => {
  const found = new RegExp(`export const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`).exec(source)
  if (found?.[1] === undefined) return undefined
  const words: Array<string> = []
  for (const part of found[1].split(',').map((one) => one.trim())) {
    if (part === '') continue
    const spread = /^\.\.\.([A-Z_]+)$/.exec(part)
    const word = /^'([a-z_]+)'$/.exec(part)
    if (spread?.[1] !== undefined && known[spread[1]] !== undefined) words.push(...(known[spread[1]] ?? []))
    else if (word?.[1] !== undefined) words.push(word[1])
    else return undefined
  }
  return words
}

const numberIn = (source: string | undefined, name: string) => {
  const found = source === undefined ? null : new RegExp(`(?:export )?const ${name} = (\\d+)`).exec(source)
  return found?.[1] === undefined ? undefined : Number(found[1])
}

/**
 * The table, with what the app's sources say now of each set and gather where they say it as the table expects: so
 * a run on a later commit follows that commit's feed. What it says of each: `source` or `table`.
 */
export const follows = (): { readonly follows: Follows; readonly variant: Record<string, unknown> } => {
  const feed = read('data/feed.ts')
  const task = read('features/task/useTask.ts')
  const project = read('features/project/useProject.ts')
  const edge = read('features/edge/useEdge.ts')
  const from: Record<string, 'source' | 'table'> = {}
  const sets: Record<string, ReadonlyArray<string>> = {}
  const set = (key: keyof Follows, name: string) => {
    const words = feed === undefined ? undefined : setIn(feed, name, sets)
    if (words !== undefined) sets[name] = words
    from[key] = words === undefined ? 'table' : 'source'
    return words ?? (BUILT_IN[key] as ReadonlyArray<string>)
  }
  const gather = (key: keyof Follows, source: string | undefined, name: string) => {
    const found = numberIn(source, name)
    from[key] = found === undefined ? 'table' : 'source'
    return found ?? (BUILT_IN[key] as number)
  }
  const board = set('board', 'BOARD')
  const home = set('home', 'HOME')
  const made: Follows = {
    gather: gather('gather', feed, 'GATHER'),
    board,
    home,
    homeShown: set('homeShown', 'HOME_SHOWN'),
    projects: set('projects', 'PROJECTS'),
    connections: set('connections', 'CONNECTIONS'),
    // Said in `wholeReads` itself, not as a set: the table's.
    rules: BUILT_IN.rules,
    cards: set('cards', 'CARDS'),
    automations: set('automations', 'AUTOMATIONS'),
    threadGather: Math.min(gather('threadGather', task, 'GATHER'), numberIn(project, 'GATHER') ?? BUILT_IN.threadGather),
    edgeGather: gather('edgeGather', edge, 'GATHER'),
    // What the coordinator on screen reads on a card's change: every task card it holds, as at 9cde0f5, while its source
    // still says so; else the table's, which says what to change here.
    everyCard:
      project === undefined ? BUILT_IN.everyCard : /if \(cards\) for \(const item of held\(\)\) if \(item\.kind === 'task'\)/.test(project),
    oneAtATime: feed === undefined ? BUILT_IN.oneAtATime : feed.includes('cancelRefetch: false'),
  }
  from.rules = 'table'
  from.everyCard = project === undefined ? 'table' : 'source'
  from.oneAtATime = feed === undefined ? 'table' : 'source'
  const digest = (source: string | undefined) =>
    source === undefined ? null : createHash('sha1').update(source).digest('hex').slice(0, 10)
  return {
    follows: made,
    variant: {
      feed: digest(feed),
      useTask: digest(task),
      useProject: digest(project),
      useEdge: digest(edge),
      // Where the run differs from the table at 9cde0f5: what the app's sources say now.
      changed: Object.fromEntries(
        Object.entries(made).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(BUILT_IN[key as keyof Follows])),
      ),
      from,
    },
  }
}
