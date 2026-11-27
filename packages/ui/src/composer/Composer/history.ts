/*
 * What Undo and Redo do in a composer: one history of its words and of what
 * is taken off it (an image, a file, a comment), in the order they happened.
 * The browser keeps a field's word steps itself, but never says how many it
 * has, so it can't say whether the next one is older than an attachment taken
 * off; the composer keeps them here instead, beside the attachments', and the
 * field's own Undo and Redo are this history's. Words typed on in one run are
 * one step, as the field has them; words put in otherwise (dictated, a
 * suggestion taken, a message given back) are a step each.
 *
 * The steps hold what they put back (the words, and the image itself with its
 * bytes and its crop), in the window's memory only, for as long as its draft
 * is kept.
 */

/** The words in a composer's field, and where its caret or selection was. */
export interface ComposerWords {
  readonly text: string
  readonly start: number
  readonly end: number
}

/** A step a composer can take back and do again, beside its words': an attachment taken off, and how to put it back. */
export interface ComposerStep {
  /** Puts it back where it was, as it was. False where there was nothing left to put back, as an image whose reading failed since. */
  readonly undo: () => boolean | void
  /** Takes it off again. */
  readonly redo: () => boolean | void
}

/** How words were changed: typed or deleted in a run that is one step, or otherwise (null): a step of its own. */
export type ComposerTyping = 'insert' | 'delete' | null

/** A composer's history of its words and attachments (`Composer`'s `history`). */
export interface ComposerHistory {
  /** An attachment taken off: a step of its own, after which nothing is left to redo. */
  push: (step: ComposerStep) => void
  /** The words changed, from `before`: a step, or the last one gone on, where it is typing that goes on. */
  wrote: (before: ComposerWords, after: ComposerWords, typing?: ComposerTyping) => void
  /** The words as this history last knew them; undefined where it knows none yet, as before its composer first shows, or once sent. */
  known: () => ComposerWords | undefined
  /** Takes back the last step: an attachment's itself, the words' by `put`. False where there was none. */
  undo: (put: (words: ComposerWords) => void) => boolean
  /** Does again the step last taken back, as Undo does. */
  redo: (put: (words: ComposerWords) => void) => boolean
  /** Forgets every step, and the words, as its message is sent. */
  clear: () => void
}

/** How many steps are kept, each way. */
const KEPT = 100
/** How long a pause ends a run of typing, in ms. */
const PAUSE = 1000

type Entry =
  | { readonly kind: 'attachment'; readonly step: ComposerStep }
  | { readonly kind: 'words'; readonly before: ComposerWords; after: ComposerWords; readonly typing: ComposerTyping; at: number }

export const createComposerHistory = (now: () => number = Date.now): ComposerHistory => {
  const undoing: Entry[] = []
  const redoing: Entry[] = []
  let words: ComposerWords | undefined
  /* Whether typing on joins the last step: not once something else was done, or taken back, since. */
  let joinable = false
  const keep = (stack: Entry[], entry: Entry) => {
    stack.push(entry)
    if (stack.length > KEPT) stack.shift()
  }
  /* Takes the top of one stack onto the other: an attachment's step, or the words as they were on its side. */
  const move = (from: Entry[], to: Entry[], back: boolean, put: (words: ComposerWords) => void): boolean => {
    joinable = false
    for (let entry = from.pop(); entry !== undefined; entry = from.pop()) {
      if (entry.kind === 'words') {
        words = back ? entry.before : entry.after
        keep(to, entry)
        put(words)
        return true
      }
      // An attachment with nothing left to put back is skipped, so the key does the next step.
      if ((back ? entry.step.undo() : entry.step.redo()) === false) continue
      keep(to, entry)
      return true
    }
    return false
  }
  return {
    push: (step) => {
      keep(undoing, { kind: 'attachment', step })
      redoing.length = 0
      joinable = false
    },
    wrote: (before, after, typing = null) => {
      words = after
      if (before.text === after.text) return
      redoing.length = 0
      const top = undoing.at(-1)
      const at = now()
      // Typing on, in the same run: one step, as the field has it. A new line starts another.
      const joins =
        joinable &&
        typing !== null &&
        top?.kind === 'words' &&
        top.typing === typing &&
        top.after.text === before.text &&
        at - top.at < PAUSE &&
        !after.text.slice(before.start, after.start).includes('\n')
      joinable = typing !== null
      if (joins) {
        top.after = after
        top.at = at
        return
      }
      keep(undoing, { kind: 'words', before, after, typing, at })
    },
    known: () => words,
    undo: (put) => move(undoing, redoing, true, put),
    redo: (put) => move(redoing, undoing, false, put),
    clear: () => {
      undoing.length = 0
      redoing.length = 0
      words = undefined
      joinable = false
    },
  }
}

/**
 * Puts one taken off back in a list, after the nearest of those that were before it and are still there, so a change
 * to the list since (one added, or one whose reading failed) doesn't move it among the rest.
 */
export const putBack = <T extends { readonly id: string }>(now: ReadonlyArray<T>, one: T, before: ReadonlyArray<string>): T[] => {
  if (now.some((x) => x.id === one.id)) return [...now]
  const after = before.findLast((id) => now.some((x) => x.id === id))
  const at = after === undefined ? 0 : now.findIndex((x) => x.id === after) + 1
  return [...now.slice(0, at), one, ...now.slice(at)]
}
