import { useSyncExternalStore } from 'react'

import { type Artifact, type BoardDef, GIFT, type Home, type Kept, type Reach } from './artifacts'

/*
 * What happens on the lab's artifacts as the person points and says: what
 * is said in Gift a class's conversation, the lead at work, each change that
 * lands on a board (a part's new look, as a hot reload would bring it), the
 * takes it draws beside a board, and the pins on the boards (D). The lab's
 * fake runtime reads the conversation from here; a new moment starts it
 * afresh, or from where that moment begins.
 */

export interface Line {
  readonly who: 'you' | 'lead'
  readonly text: string
  /** A new version of the artifact the lead published with it. */
  readonly version?: number
  /** When it was said, for what is said live. */
  readonly at?: number
}

/** What a person pointed at: a part of a board, as the design names it, or the words in it. */
export interface Spot {
  readonly artifactId: string
  readonly boardId: string
  /** Where it is in the board's page, to find it again: a selector. Null for the whole board. */
  readonly selector: string | null
  /** In a few words: “The amounts”, ““Send the gift””. */
  readonly label: string
  /** Its box on the board, in the board's own pixels, as it was pointed at. */
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  /** The design's own name for it, where it has one (data-part). */
  readonly part: string | null
}

/** A change to a part: in Kiln's own looks where it has one, else a style laid on the element. */
export interface Change {
  readonly look?: Readonly<Record<string, string>>
  readonly style?: { readonly selector: string; readonly css: Readonly<Record<string, string>> }
}

/** A board's changes so far, newest last, with the version each made. */
export interface Landed extends Change {
  readonly version: number
  readonly note: string
}

/** A pin on a board (D): who said what about a part, and what came of it. */
export interface Pin {
  readonly id: string
  readonly spot: Spot
  readonly who: 'you' | 'Sam' | 'Lee' | 'Ana'
  readonly lines: ReadonlyArray<Line>
  /** Asked and at work; answered with a change (its version); a person's comment nobody has taken on yet. */
  readonly state: 'working' | 'changed' | 'comment' | 'resolved'
  readonly version?: number
}

interface World {
  readonly lines: ReadonlyArray<Line>
  readonly working: boolean
  /** The spot the lead is at work on, marked on its board. */
  readonly at: Spot | null
  readonly versions: Readonly<Record<string, number>>
  /** Changes by board: `artifactId/boardId`. */
  readonly landed: Readonly<Record<string, ReadonlyArray<Landed>>>
  /** Boards drawn since, by page: `artifactId/pageId`. */
  readonly added: Readonly<Record<string, ReadonlyArray<BoardDef>>>
  readonly pins: ReadonlyArray<Pin>
  /** Where artifacts are kept in git, as changed here; null for kept in Althar only. */
  readonly kept: Readonly<Record<string, Kept | null>>
  /** Artifacts whose commit is on its way. */
  readonly committing: ReadonlyArray<string>
  /** Who sees each artifact, as changed here. */
  readonly reach: Readonly<Record<string, Reach>>
  /** The project's place for artifacts; null until the first save sets it. */
  readonly home: Home | null
}

/** kiln's, as its first save set it: with its designs, in a pull request of its own, each version a commit on it. */
export const KILN_HOME: Home = { repo: 'kiln', folder: 'design/', how: 'pr', follow: true }

const EMPTY: World = {
  lines: [],
  working: false,
  at: null,
  versions: {},
  landed: {},
  added: {},
  pins: [],
  kept: {},
  committing: [],
  reach: {},
  home: KILN_HOME,
}

/** A made-up commit for a version of an artifact in git: the same each time. */
export const commitOf = (artifactId: string, version: number) => {
  let hash = 2166136261
  for (const c of `${artifactId}:${version}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 7)
}

let world: World = EMPTY
const listeners = new Set<() => void>()
const told = () => {
  for (const listener of listeners) listener()
}
const put = (change: Partial<World>) => {
  world = { ...world, ...change }
  told()
}

export const boardKey = (artifactId: string, boardId: string) => `${artifactId}/${boardId}`
export const pageKey = (artifactId: string, pageId: string) => `${artifactId}/${pageId}`

export const live = {
  get: () => world,
  /** A new moment: nothing said yet, or what that moment starts from. */
  reset: (start: Partial<World> = {}) => {
    world = { ...EMPTY, ...start }
    told()
  },
  say: (line: Line) => put({ lines: [...world.lines, { at: Date.now(), ...line }] }),
  work: (at: Spot | null) => put({ working: at !== null, at }),
  version: (artifact: Artifact) => world.versions[artifact.id] ?? artifact.version,
  /** Where it is kept in git, if anywhere; one that follows has every version in. */
  keptOf: (artifact: Artifact): Kept | null => {
    const kept = artifact.id in world.kept ? (world.kept[artifact.id] ?? null) : (artifact.kept ?? null)
    return kept === null ? null : kept.follow ? { ...kept, version: live.version(artifact) } : kept
  },
  /** The project's place for artifacts, as set in its settings or by a save. */
  setHome: (home: Home | null) => put({ home }),
  /** Saved to a folder in a repository, or kept in Althar only: shown at once, its commit following. */
  save: (artifact: Artifact, kept: Kept | null) => {
    put({ kept: { ...world.kept, [artifact.id]: kept }, committing: kept === null ? world.committing : [...world.committing, artifact.id] })
    if (kept !== null) window.setTimeout(() => put({ committing: world.committing.filter((one) => one !== artifact.id) }), 1400)
  },
  /** A change lands on a board: the artifact's next version. */
  land: (artifact: Artifact, boardId: string, change: Change, note: string) => {
    const version = live.version(artifact) + 1
    const key = boardKey(artifact.id, boardId)
    put({
      versions: { ...world.versions, [artifact.id]: version },
      landed: { ...world.landed, [key]: [...(world.landed[key] ?? []), { ...change, version, note }] },
    })
    return version
  },
  /** Takes the last change off a board, and the version it made. */
  undo: (artifact: Artifact, boardId: string) => {
    const key = boardKey(artifact.id, boardId)
    const was = world.landed[key] ?? []
    if (was.length === 0) return
    put({
      versions: { ...world.versions, [artifact.id]: live.version(artifact) - 1 },
      landed: { ...world.landed, [key]: was.slice(0, -1) },
    })
  },
  /** Boards the lead drew on a page, after the boards it had; or one of them taken off. */
  add: (artifactId: string, pageId: string, boards: ReadonlyArray<BoardDef>) => {
    const key = pageKey(artifactId, pageId)
    put({ added: { ...world.added, [key]: [...(world.added[key] ?? []), ...boards] } })
  },
  remove: (artifactId: string, pageId: string, boardIds: ReadonlyArray<string>) => {
    const key = pageKey(artifactId, pageId)
    put({ added: { ...world.added, [key]: (world.added[key] ?? []).filter((one) => !boardIds.includes(one.id)) } })
  },
  /** A take kept: fresh no longer, the others gone. */
  keep: (artifactId: string, pageId: string, boardId: string) => {
    const key = pageKey(artifactId, pageId)
    put({
      added: {
        ...world.added,
        [key]: (world.added[key] ?? []).flatMap((one) =>
          one.id === boardId ? [{ ...one, fresh: false, tried: undefined }] : one.tried === undefined ? [one] : [],
        ),
      },
    })
  },
  pin: (pin: Pin) => put({ pins: [...world.pins.filter((one) => one.id !== pin.id), pin] }),
  reachOf: (artifact: Artifact): Reach => world.reach[artifact.id] ?? artifact.reach ?? 'draft',
  /** Shared or published at once, or back to a draft: its link stops opening. */
  reach: (artifact: Artifact, reach: Reach) => put({ reach: { ...world.reach, [artifact.id]: reach } }),
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useLive = () => useSyncExternalStore(live.subscribe, live.get)

/** The boards on a page now: its own, then those drawn since. */
export const boardsOf = (w: World, artifact: Artifact, pageId: string): ReadonlyArray<BoardDef> => {
  const page = artifact.pages.find((one) => one.id === pageId) ?? artifact.pages[0]
  const added = w.added[pageKey(artifact.id, pageId)] ?? []
  // Takes sit right after the board they were drawn from; anything else new, at the end.
  const own = (page?.boards ?? []).flatMap((one) => [one, ...added.filter((take) => take.from === one.id)])
  return [...own, ...added.filter((one) => !own.includes(one))]
}

/* ——— The lead, made up: what it does with what the person says about a part ——— */

const SERIF = "'Iowan Old Style', Georgia, serif"

/** Three ways a part might be off, for when the person can't say why. */
export const TAKES = [
  {
    key: 'quiet',
    name: 'Quieter',
    tried: 'Fewer sizes and weights, so one thing leads',
    css: { fontWeight: '400', color: '#6b645b', letterSpacing: '0' },
  },
  {
    key: 'warm',
    name: 'Warmer',
    tried: 'On the studio’s paper, in its serif',
    css: { fontFamily: SERIF, background: '#f6f1ea', borderRadius: '14px' },
  },
  { key: 'bold', name: 'Bolder', tried: 'One strong line in the studio’s clay', css: { fontWeight: '700', color: '#b8532b' } },
] as const

/** Starters, for when the person can't say why yet. */
export const STARTERS = ['Something’s off', 'Too busy', 'Too plain', 'Show me a few'] as const
const ASKS_FOR_TAKES = /something’s off|something's off|show me a few|a few|options|can’t say|can't say|not sure/i

export interface Answer {
  /** A change to the board pointed at. */
  readonly change?: Change
  /** Or takes, drawn beside it, one thing each. */
  readonly takes?: ReadonlyArray<BoardDef>
  /** What the lead says it did. */
  readonly note: string
}

/** What the lead does with words said about a spot: the amounts and the card in Kiln's own looks, anything else by a style on it. */
export const answerTo = (spot: Spot, words: string, board: BoardDef): Answer => {
  const takes = ASKS_FOR_TAKES.test(words)
  const name = spot.label.replace(/^The /, 'the ')
  if (takes) {
    const card = spot.part === 'card'
    return {
      takes: TAKES.map((take) => ({
        id: `${board.id}-${take.key}-${Date.now().toString(36)}`,
        from: board.id,
        name: take.name,
        shows: board.shows ?? '',
        size: board.size ?? 'laptop',
        tried: take.tried,
        fresh: true,
        ...(card
          ? { look: { ...board.look, card: take.key } }
          : spot.selector === null
            ? {}
            : { look: { ...board.look, [`style:${spot.selector}`]: JSON.stringify(take.css) } }),
      })),
      note: `Three takes on ${name}, beside it: each tries one thing that might be off. Keep the one that's right.`,
    }
  }
  // Said of a whole board: what the words name on it, where the design names a part.
  if (spot.selector === null && spot.part === null && /amount|price/i.test(words))
    return answerTo({ ...spot, part: 'amounts', label: 'The amounts', selector: '[data-part="amounts"]' }, words, board)
  if (spot.selector === null && spot.part === null && /card|voucher/i.test(words))
    return answerTo({ ...spot, part: 'card', label: 'The card', selector: '[data-part="card"]' }, words, board)
  if (spot.part === 'amounts')
    return {
      change: { look: { amounts: 'presents' } },
      note: 'the amounts are presents now: each on a card of its own, with a pot in its class’s colour and what it buys in a line.',
    }
  if (spot.part === 'card')
    return {
      change: { look: { card: 'warm' } },
      note: 'the card is on the studio’s paper, in its clay, with Sam’s note in their own hand.',
    }
  if (spot.selector === null) return { note: `noted for the next pass on ${board.name}.` }
  const busy = /busy|loud|much|heavy|calm|quiet/i.test(words)
  const plain = /plain|flat|dull|bold|stronger|pop/i.test(words)
  const take = busy ? TAKES[0] : plain ? TAKES[2] : TAKES[1]
  return {
    change: { style: { selector: spot.selector, css: take.css } },
    note: `${name} is ${busy ? 'quieter: one weight, in Kiln’s soft ink' : plain ? 'bolder: one strong line in the studio’s clay' : 'warmer: on the studio’s paper, in its serif'}.`,
  }
}

/** Gift a class's lead, made up: it works for a moment, then the change lands on the board, with a line in the conversation. */
export const ask = (
  artifact: Artifact,
  board: BoardDef,
  pageId: string,
  spot: Spot,
  words: string,
  then?: (answer: Answer, version: number | null) => void,
) => {
  live.say({ who: 'you', text: spot.selector === null ? words : `On ${spot.label.replace(/^The /, 'the ')}: ${words}` })
  live.work(spot)
  window.setTimeout(() => {
    const answer = answerTo(spot, words, board)
    let version: number | null = null
    if (answer.takes !== undefined) live.add(artifact.id, pageId, answer.takes)
    if (answer.change !== undefined) version = live.land(artifact, board.id, answer.change, answer.note)
    live.work(null)
    live.say(
      version === null
        ? { who: 'lead', text: answer.note }
        : { who: 'lead', text: `**v${version}** of ${artifact.title}: ${answer.note}`, version },
    )
    then?.(answer, version)
  }, 2200)
}

/** Whether a canvas is Gift a class, the artifact the lab's conversation is about. */
export const isGift = (artifactId: string) => artifactId === GIFT
