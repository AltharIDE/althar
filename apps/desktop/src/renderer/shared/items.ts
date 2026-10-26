import type { AttachedFile, Picture, ThreadItem } from '@althar/contracts'

import { text as imagesText } from './images'
import type { Streamed } from './thread'

/* A thread's items as a window holds them: read a page at a time, and changed one by one. */

/** What went with a queued message, in words: "2 images", "1 file", "1 image, 2 files". */
const attachedText = (images: number, files: number) =>
  [...(images === 0 ? [] : [imagesText.attached(images)]), ...(files === 0 ? [] : [files === 1 ? '1 file' : `${files} files`])].join(', ')

/** The ids the window gives what the person sent until the store's copy arrives. */
const SENDING = 'sending:'
let sent = 0

/** One of the window's own copies of what the person sent. */
export const isSending = (id: string) => id.startsWith(SENDING)

/** A message the window shows the moment it is sent, after what it holds, until the store's copy arrives. */
export const sending = (
  items: ReadonlyArray<ThreadItem>,
  message: {
    readonly text: string
    readonly queued: boolean
    readonly interrupting: boolean
    /** Some of its words were dictated. */
    readonly dictated?: boolean
    /** The images sent with it. */
    readonly pictures?: ReadonlyArray<Picture>
    /** The files and folders sent with it. */
    readonly files?: ReadonlyArray<AttachedFile>
  },
): { readonly id: string; readonly items: ReadonlyArray<ThreadItem> } => {
  sent += 1
  const id = `${SENDING}${sent}`
  const item: ThreadItem = {
    id,
    kind: 'user_message',
    sequence: (items.at(-1)?.sequence ?? 0) + 0.5,
    agentId: null,
    createdAt: new Date().toISOString(),
    content: { text: message.text, links: [], pictures: message.pictures ?? [], files: message.files ?? [] },
    input: {
      state: message.queued ? 'queued' : 'delivered',
      interrupting: message.interrupting,
      ...(message.dictated === true ? { dictated: true } : {}),
    },
  }
  return { id, items: [...items, item] }
}

/**
 * A send that failed: its copy goes. Where the store's copy of another send
 * with the same words took its place already, that other one's copy goes
 * instead, so what shows is what was sent.
 */
export const unsent = (items: ReadonlyArray<ThreadItem>, id: string, text: string): ReadonlyArray<ThreadItem> => {
  if (items.some((item) => item.id === id)) return items.filter((item) => item.id !== id)
  const other = items.find((item) => isSending(item.id) && item.kind === 'user_message' && item.content.text === text)
  return other === undefined ? items : items.filter((item) => item.id !== other.id)
}

/** Items by id, oldest first: what arrives replaces what was there, and the store's copy of a message, the window's. */
export const mergeItems = (current: ReadonlyArray<ThreadItem>, incoming: ReadonlyArray<ThreadItem>): ReadonlyArray<ThreadItem> => {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) {
    // A message new to the window, said since the copy was made (not an older page read), takes the copy's place.
    if (item.kind === 'user_message' && !byId.has(item.id)) {
      const copy = [...byId.values()].find(
        (held) =>
          isSending(held.id) &&
          held.kind === 'user_message' &&
          held.content.text === item.content.text &&
          item.sequence > held.sequence - 1,
      )
      if (copy !== undefined) byId.delete(copy.id)
    }
    byId.set(item.id, item)
  }
  return [...byId.values()].toSorted((a, b) => a.sequence - b.sequence)
}

/**
 * An item that can't change any more: a tool call that completed or failed,
 * a message delivered (or never queued), a plan with every entry done, a
 * task settled, a question answered or withdrawn, a run or a setup ended, an issue
 * draft filed or discarded, changes to issues applied or discarded, a review draft posted or discarded, a push the lead asked for pushed, asked again
 * or closed. What an agent
 * said, a notice, a step's result and what arrived from outside are settled
 * once written.
 */
export const settled = (item: ThreadItem): boolean => {
  switch (item.kind) {
    case 'tool_call':
      return item.content.status === 'completed' || item.content.status === 'failed'
    case 'user_message':
      return item.input?.state !== 'queued'
    case 'plan':
      return item.content.entries.every((entry) => entry.status === 'completed')
    case 'task':
      return item.content.phase === 'settled'
    case 'question':
      return item.content.state !== 'open'
    case 'run':
    case 'setup':
      return item.content.ended !== null
    case 'issue_draft':
      return item.content.state === 'filed' || item.content.state === 'discarded'
    case 'issue_changes':
      return item.content.state === 'applied' || item.content.state === 'discarded'
    case 'review_draft':
      return item.content.state === 'posted' || item.content.state === 'discarded'
    case 'push_request':
      return item.content.state !== 'open'
    case 'agent_message':
    case 'agent_thought':
    case 'notice':
    case 'step_result':
    case 'arrival':
      return true
  }
}

/** Streamed text the store now holds in full needs no streamed copy. */
export const caughtUp = (streaming: ReadonlyMap<string, Streamed>, items: ReadonlyArray<ThreadItem>): ReadonlyMap<string, Streamed> => {
  const kept = new Map(streaming)
  for (const item of items) {
    const live = kept.get(item.id)
    if (
      live !== undefined &&
      'text' in item.content &&
      typeof item.content.text === 'string' &&
      item.content.text.length >= live.text.length
    )
      kept.delete(item.id)
  }
  return kept.size === streaming.size ? streaming : kept
}

/** What the person said that still waits: a change to what they said moves it on, so these are read again. */
export const waiting = (items: ReadonlyArray<ThreadItem>): ReadonlyArray<string> =>
  items.flatMap((item) => (item.kind === 'user_message' && item.input?.state === 'queued' && !isSending(item.id) ? [item.id] : []))

/**
 * Whether what waits its turn shows in the composer's queue: behind a turn
 * running, or with no agent on the thread to take it, where it could wait
 * for long. With an agent idle there is nothing to wait behind, and while the
 * person's own send is on its way (which may start the agent), what they just
 * sent is about to be read: it goes straight to the thread, rather than
 * flashing in the queue.
 */
export const queueShown = (session: { readonly turnRunning: boolean } | null, sending: boolean): boolean =>
  session === null ? !sending : session.turnRunning

/**
 * Whether what waits after the agent's last reply is being read now, with
 * nothing to wait behind: no turn runs, and the person's own send is on its
 * way (which may start the agent), or the agent holds the thread, idle or
 * starting, with nothing keeping it from reading (`kept`, as a task waiting
 * for a place or for its agent's usage). What it reads is the reply the
 * person waits for, not a queue, while the agent starts as much as after.
 */
export const readingNow = (
  session: { readonly turnRunning: boolean; readonly held: boolean; readonly state: string } | null,
  sending: boolean,
  kept = false,
): boolean => !kept && session?.turnRunning !== true && (sending || session?.held === true || session?.state === 'starting')

/**
 * What waits its turn, oldest first, in the composer where the person can
 * edit it or take it back, when the queue shows, with the images that went
 * with it. A message sent now isn't there: it goes first, as soon as the
 * turn stops.
 */
export const queuedOf = (
  items: ReadonlyArray<ThreadItem>,
  shown: boolean,
): ReadonlyArray<{
  readonly id: string
  readonly text: string
  readonly attached?: string
  readonly pictures: ReadonlyArray<Picture>
  readonly files: ReadonlyArray<AttachedFile>
  readonly dictated?: boolean
}> =>
  !shown
    ? []
    : items.flatMap((item) =>
        item.kind === 'user_message' && item.input?.state === 'queued' && !item.input.interrupting
          ? [
              {
                id: item.id,
                text: item.content.text,
                ...(item.content.pictures.length + item.content.files.length === 0
                  ? {}
                  : { attached: attachedText(item.content.pictures.length, item.content.files.length) }),
                pictures: item.content.pictures,
                files: item.content.files,
                ...(item.input.dictated === true ? { dictated: true } : {}),
              },
            ]
          : [],
      )

/** A message taken back, as the window holds it until the runtime's word of it arrives. */
export const takenBack = (items: ReadonlyArray<ThreadItem>, itemId: string): ReadonlyArray<ThreadItem> =>
  items.flatMap((item) =>
    item.id === itemId && item.kind === 'user_message' && item.input !== null
      ? [{ ...item, input: { ...item.input, state: 'withdrawn' as const } }]
      : [],
  )

/** A queued message back in the composer: in place of nothing, or after what is already written. */
export const withQueued = (draft: string, text: string): string => (draft.trim() === '' ? text : `${draft.trimEnd()}\n\n${text}`)

/**
 * Reads that can come back out of order, as the runtime answers each on its
 * own: an answer is kept only if no read of the same thing began after it,
 * so an earlier answer never puts back what a later one replaced. `landed`
 * waits for the newest read of a thing, whichever began last: the one kept.
 */
export const newestReads = () => {
  const begun = new Map<string, { readonly read: number; readonly landed: Promise<void> }>()
  let reads = 0
  const newest = <A>(key: string, read: Promise<A>, keep: (value: A) => void, fail: (failure: unknown) => void): Promise<void> => {
    reads += 1
    const mine = reads
    const landed = read.then((value) => {
      if (begun.get(key)?.read === mine) keep(value)
    }, fail)
    begun.set(key, { read: mine, landed })
    return landed
  }
  const landed = async (key: string) => {
    for (let now = begun.get(key); now !== undefined; now = begun.get(key)) {
      await now.landed
      if (begun.get(key) === now) return
    }
  }
  return Object.assign(newest, { landed })
}
